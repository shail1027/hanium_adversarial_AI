"""HTTP execution races with a blocked native-runtime double, never a camera/model."""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import threading
import time

import pytest

from backend.app.capture_service import CaptureError
from .test_browser_protocol import capture, enrolled, web  # noqa: F401


def blocked_call(function):
    entered, release = threading.Event(), threading.Event()
    def blocked(*args):
        entered.set()
        if not release.wait(3):
            raise RuntimeError("Test release missing")
        return function(*args)
    return blocked, entered, release


@pytest.mark.parametrize("operation", ["enroll", "authenticate"])
def test_result_after_evaluation_deadline_never_publishes_or_approves(web, operation, monkeypatch):
    client, service, runtime, clock = web
    if operation == "authenticate":
        enrolled(web)
        runtime.decision = "ACCEPT"
    session = capture(web, operation)
    original = runtime.enroll if operation == "enroll" else runtime.evaluate
    blocked, entered, release = blocked_call(original)
    setattr(runtime, "enroll" if operation == "enroll" else "evaluate", blocked)
    # Advance the fake clock only after the Future wait budget was calculated.
    # Otherwise this test races the separate INFERENCE_TIMEOUT branch.
    waiting = threading.Event()
    submit = service.executor.submit
    def observed_submit(*args):
        job = submit(*args)
        result = job.result
        def observed_result(timeout=None):
            waiting.set()
            return result(timeout=timeout)
        job.result = observed_result
        return job
    monkeypatch.setattr(service.executor, "submit", observed_submit)
    with ThreadPoolExecutor(max_workers=1) as requests:
        response = requests.submit(client.post, "/api/face/verify", json=session)
        try:
            assert entered.wait(1)
            assert waiting.wait(1)
            clock.now = service.captures[session["session_id"]].evaluation_deadline + 1
        finally:
            release.set()
        body = response.result(timeout=2).json()
    assert body["session"]["final_decision"] == "ERROR"
    assert body["token_id"] is None
    assert service.captures[session["session_id"]].state == "EXPIRED"
    if operation == "enroll":
        assert not service.registry.registered(service.config.user_id)


def test_shutdown_discards_late_enrollment_result(web):
    client, service, runtime, _ = web
    session = capture(web)
    runtime.enroll, entered, release = blocked_call(runtime.enroll)
    with ThreadPoolExecutor(max_workers=1) as requests:
        response = requests.submit(client.post, "/api/face/verify", json=session)
        try:
            assert entered.wait(1)
            service.close()
        finally:
            release.set()
        body = response.result(timeout=2).json()
    assert body["session"]["final_decision"] == "ERROR"
    assert body["token_id"] is None
    assert not service.registry.registered(service.config.user_id)


def test_old_token_consumption_does_not_block_health_or_cancel_during_inference(web):
    client, service, runtime, _ = web
    enrolled(web)
    runtime.decision = "ACCEPT"
    first = capture(web, "authenticate")
    token = client.post("/api/face/verify", json=first).json()["token_id"]
    second = capture(web, "authenticate")
    runtime.evaluate, entered, release = blocked_call(runtime.evaluate)
    # Real HC160Runtime serializes evaluate and consume with the same native lock.
    native_lock = threading.Lock()
    native_lock.acquire()
    original_consume = runtime.consume
    def consume(*args):
        with native_lock:
            return original_consume(*args)
    runtime.consume = consume
    with ThreadPoolExecutor(max_workers=3) as requests:
        verify = requests.submit(client.post, "/api/face/verify", json=second)
        consumed = None
        try:
            assert entered.wait(1)
            consumed = requests.submit(client.post, "/api/face/consume", json={
                "session_id": first["session_id"], "token_id": token})
            denied = consumed.result(timeout=.5)
            assert denied.status_code == 503
            assert denied.json()["detail"]["code"] == "INFERENCE_BUSY"
            assert runtime.consumed is False
            before = time.monotonic()
            assert client.get("/api/health").status_code == 200
            assert client.post("/api/face/cancel", json=second).json() == {"cancelled": True}
            assert time.monotonic() - before < .5
            assert not verify.done(), "native inference is still blocked during health/cancel"
        finally:
            native_lock.release()
            release.set()
        body = verify.result(timeout=2).json()
    assert body["session"]["final_decision"] == "ERROR"
    assert body["token_id"] is None


def test_timeout_keeps_native_slot_until_job_finishes_and_discards_late_accept(web):
    client, service, runtime, _ = web
    enrolled(web)
    runtime.decision = "ACCEPT"
    session = capture(web, "authenticate")
    runtime.evaluate, entered, release = blocked_call(runtime.evaluate)
    service.config = replace(service.config, timeout_seconds=.01)
    try:
        body = client.post("/api/face/verify", json=session).json()
        assert entered.is_set()
        assert body["session"]["audit"]["error_code"] == "INFERENCE_TIMEOUT"
        assert body["token_id"] is None
        assert not service.inference_slot.acquire(blocking=False)
        before = time.monotonic()
        assert client.post("/api/face/start", json={"operation": "authenticate"}).status_code == 503
        assert time.monotonic() - before < .5
    finally:
        release.set()
    assert service.inference_slot.acquire(timeout=1)
    service.inference_slot.release()
    assert service.captures[session["session_id"]].token_id is None
    with pytest.raises(CaptureError):
        service.consume(session["session_id"], service.captures[session["session_id"]].owner, "one-use-test-token")


@pytest.mark.parametrize("cancel", [False, True])
def test_evaluation_retains_existing_inference_budget_after_capture_deadline(web, cancel):
    client, service, runtime, clock = web
    enrolled(web)
    runtime.decision = "ACCEPT"
    session = capture(web, "authenticate")
    runtime.evaluate, entered, release = blocked_call(runtime.evaluate)
    with ThreadPoolExecutor(max_workers=1) as requests:
        response = requests.submit(client.post, "/api/face/verify", json=session)
        try:
            assert entered.wait(1)
            current = service.captures[session["session_id"]]
            clock.now = current.expires + 1
            assert clock.now < current.evaluation_deadline
            if cancel:
                assert client.post("/api/face/cancel", json=session).json() == {"cancelled": True}
        finally:
            release.set()
        body = response.result(timeout=2).json()
    if cancel:
        assert body["session"]["final_decision"] == "ERROR"
        assert body["token_id"] is None
    else:
        # This is a runtime/token double, proving the existing phase budget only.
        assert body["session"]["final_decision"] == "ACCEPT"
        assert body["token_id"] == "one-use-test-token"


def test_artifact_setup_uses_the_same_existing_inference_deadline(web):
    client, service, runtime, clock = web
    session = capture(web)
    service.config = replace(service.config, timeout_seconds=5)
    allocate = service.registry.allocate
    def delayed_allocate(*args):
        clock.now += 6  # Saved artifact setup already exhausted the configured budget.
        return allocate(*args)
    service.registry.allocate = delayed_allocate
    runtime.enroll, _, release = blocked_call(runtime.enroll)
    try:
        before = time.monotonic()
        body = client.post("/api/face/verify", json=session).json()
        assert time.monotonic() - before < .5
        assert body["session"]["audit"]["error_code"] == "INFERENCE_TIMEOUT"
        assert body["token_id"] is None
        assert not service.registry.registered(service.config.user_id)
    finally:
        release.set()
