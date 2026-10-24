"""HTTP capture/identity transport with synthetic JPEGs, never a physical camera."""
import base64
from dataclasses import replace
import io
import secrets
import threading
import time
from types import SimpleNamespace

from fastapi.testclient import TestClient
from PIL import Image
import pytest

from backend.app.capture_service import CaptureError, CaptureService
from backend.app.main import create_app
from backend.app.model_adapter import ModelCliConfig


class Clock:
    now = 100.
    def __call__(self):
        return self.now


class Runtime:
    decision = "STEP_UP"
    failure = None
    consumed = False
    received = None
    def create(self, user_id, purpose, context_hash):
        self.user_id = user_id
        return SimpleNamespace(session_id=secrets.token_hex(16)), SimpleNamespace(nonce=secrets.token_hex(24), kind="HEAD_LEFT")
    def illumination(self, nonce, at):
        return SimpleNamespace(nonce=nonce, steps=(SimpleNamespace(display_at_monotonic=at + .5, duration_s=.4, color=(255, 0, 0)),))
    def make_frame(self, frame_id, captured_at_monotonic, image, source_time_ms):
        return SimpleNamespace(frame_id=frame_id, captured_at_monotonic=captured_at_monotonic, image_bgr=image, source_time_ms=source_time_ms)
    def enroll(self, user, frames, template, calibration):
        if self.failure: raise self.failure
        template.write_text("synthetic encrypted test output")
        calibration.write_text("synthetic calibration test output")
        self.received = frames
        return {"status": "ENROLLED"}
    def evaluate(self, session_id, user, ip, frames, boundary, illumination, template, calibration):
        if self.failure: raise self.failure
        self.received = frames
        self.identity = (user, ip)
        self.boundary = boundary
        return {"decision": self.decision, "token_id": "one-use-test-token" if self.decision == "ACCEPT" else None,
                "query_budget_summary": {"used": 1, "limit": 20, "exceeded": False}, "gates": []}
    def consume(self, *args):
        if self.consumed: raise ValueError("already consumed")
        self.consumed = True


@pytest.fixture
def web(tmp_path, monkeypatch):
    monkeypatch.setenv("HC160_TEMPLATE_KEYS", "test-only-not-a-key")
    (tmp_path / "pad.onnx").touch(); (tmp_path / "pad.json").touch()
    config = ModelCliConfig(repo_path=str(tmp_path), storage_root=str(tmp_path), user_id="server-alice",
                            device_id="server-device", query_budget_db=str(tmp_path / "budget.sqlite"),
                            pad_model=str(tmp_path / "pad.onnx"), pad_registry=str(tmp_path / "pad.json"),
                            threshold="0.6", threshold_version="test-only", template_key_id="key")
    clock, runtime = Clock(), Runtime()
    app = create_app(config, runtime, clock)
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 41000)) as client:
        ctx = client.get("/api/face/context").json()
        client.headers["X-CSRF-Token"] = ctx["csrf_token"]
        yield client, app.state.capture_service, runtime, clock


def jpeg():
    output = io.BytesIO()
    Image.new("RGB", (160, 120), (123, 77, 31)).save(output, format="JPEG")
    return base64.b64encode(output.getvalue()).decode()


def capture(web, operation="enroll"):
    client, service, runtime, clock = web
    start = client.post("/api/face/start", json={"operation": operation})
    assert start.status_code == 200, start.text
    session = {key: start.json()[key] for key in ("session_id", "nonce")}
    plan = client.post("/api/face/present", json={**session, "displayed_at_ms": 1000}).json()
    origin = clock.now
    for i in range(30):
        clock.now = origin + i * .1
        response = client.post("/api/face/frame", json={**session, "frame_id": i,
                            "timestamp_ms": 1000 + i * 100, "image": jpeg()})
        assert response.status_code == 200, response.text
    return session


def enrolled(web):
    client, _, _, _ = web
    session = capture(web)
    response = client.post("/api/face/verify", json=session)
    assert response.json()["status"] == "ENROLLED", response.text


def test_real_jpeg_transport_and_registration_mapping(web):
    client, service, runtime, _ = web
    session = capture(web)
    result = client.post("/api/face/verify", json=session)
    assert result.json()["registered"] is True
    assert service.registry.registered("server-alice")
    assert not service.registry.registered("other-user")
    assert runtime.received[0].image_bgr.shape == (120, 160, 3)
    assert list(runtime.received[0].image_bgr[0, 0]) == [31, 77, 124]  # JPEG decoding, BGR order.
    assert client.post("/api/face/verify", json=session).status_code == 409
    assert "template_path" not in result.text


@pytest.mark.parametrize("decision", ["ACCEPT", "STEP_UP", "REJECT"])
def test_decision_and_token_consumption_contract(web, decision):
    client, service, runtime, _ = web
    enrolled(web)
    runtime.decision = decision
    session = capture(web, "authenticate")
    body = client.post("/api/face/verify", json=session).json()
    assert body["session"]["final_decision"] == decision
    assert body["authorized"] is False and body["account_authenticated"] is False
    assert runtime.identity == ("server-alice", "127.0.0.1")
    assert runtime.boundary == 0  # Derived after present; no client marker input.
    if decision == "ACCEPT":
        payload = {"session_id": session["session_id"], "token_id": body["token_id"]}
        consumed = client.post("/api/face/consume", json=payload)
        assert consumed.json() == {"consumed": True, "account_authenticated": False}
        assert client.post("/api/face/consume", json=payload).status_code == 409
    else:
        assert body["token_id"] is None and body["next_action"] != "continue"
        if decision == "STEP_UP": assert "추가 인증 수단이 없어" in body["user_message"]


def test_untrusted_fields_and_fixtures_cannot_select_identity_or_paths(web):
    client, *_ = web
    for field in ("user_id", "device_id", "source_ip", "template", "registration_calibration_artifact"):
        assert client.post("/api/face/start", json={"operation": "enroll", field: "attacker"}).status_code == 422
    assert client.post("/api/face/verify", json={"session_id": "unknown", "scenario": "normal"}).status_code == 422
    assert client.post("/api/face/verify", json={"session_id": "unknown", "nonce": "unknown"}).status_code == 404


def test_nonce_owner_csrf_origin_and_local_only_boundaries(web):
    client, *_ = web
    start = client.post("/api/face/start", json={"operation": "enroll"}).json()
    payload = {"session_id": start["session_id"], "nonce": "wrong", "displayed_at_ms": 1000}
    assert client.post("/api/face/present", json=payload).status_code == 409
    payload["nonce"] = start["nonce"]
    assert client.post("/api/face/present", json=payload, headers={"X-CSRF-Token": "wrong"}).status_code == 403
    assert client.post("/api/face/present", json=payload, headers={"Origin": "https://evil.example"}).status_code == 403
    with TestClient(client.app, base_url="http://127.0.0.1", client=("192.0.2.9", 4400)) as remote:
        assert remote.get("/api/face/context").status_code == 403


@pytest.mark.parametrize("offset", [-1, 600])
def test_frame_before_presentation_or_outside_clock_window_rejected(web, offset):
    client, _, _, clock = web
    start = client.post("/api/face/start", json={"operation": "enroll"}).json()
    session = {k: start[k] for k in ("session_id", "nonce")}
    frame = {**session, "frame_id": 0, "timestamp_ms": 1000 + offset, "image": jpeg()}
    assert client.post("/api/face/frame", json=frame).status_code == 409
    client.post("/api/face/present", json={**session, "displayed_at_ms": 1000})
    assert client.post("/api/face/frame", json=frame).status_code == 400


def test_client_backdating_cannot_reduce_liveness_time(web):
    client, service, _, clock = web
    start = client.post("/api/face/start", json={"operation": "enroll"}).json()
    session = {k: start[k] for k in ("session_id", "nonce")}
    client.post("/api/face/present", json={**session, "displayed_at_ms": 1000})
    clock.now += .4
    response = client.post("/api/face/frame", json={**session, "frame_id": 0, "timestamp_ms": 1000, "image": jpeg()})
    assert response.status_code == 200
    packet = service.captures[start["session_id"]].frames[0]
    assert packet.captured_at_monotonic == clock.now
    assert packet.source_time_ms == 1000


def test_expired_duplicate_bad_image_and_bounded_body(web):
    client, _, _, clock = web
    start = client.post("/api/face/start", json={"operation": "enroll"}).json()
    session = {k: start[k] for k in ("session_id", "nonce")}
    client.post("/api/face/present", json={**session, "displayed_at_ms": 1000})
    assert client.post("/api/face/present", json={**session, "displayed_at_ms": 1000}).status_code == 409
    assert client.post("/api/face/frame", content=b"x" * 220001).status_code == 413
    clock.now += 31
    assert client.post("/api/face/verify", json=session).status_code == 410


@pytest.mark.parametrize("operation", ["enroll", "authenticate"])
def test_runtime_failure_never_publishes_or_approves(web, operation):
    client, service, runtime, _ = web
    if operation == "authenticate": enrolled(web)
    session = capture(web, operation)
    runtime.failure = OSError("private model/db/key error")
    body = client.post("/api/face/verify", json=session).json()
    assert body["session"]["final_decision"] == "ERROR" and body["token_id"] is None
    assert body["authorized"] is False and "private model" not in str(body)
    if operation == "enroll": assert not service.registry.registered("server-alice")


def test_timeout_does_not_publish_and_new_start_fails_fast(web):
    client, service, runtime, _ = web
    session = capture(web)
    gate = threading.Event()
    original = runtime.enroll
    def blocked(*args):
        gate.wait(2)
        return original(*args)
    runtime.enroll = blocked
    service.config = replace(service.config, timeout_seconds=.01)
    try:
        body = client.post("/api/face/verify", json=session).json()
        assert body["session"]["audit"]["error_code"] == "INFERENCE_TIMEOUT"
        before = time.monotonic()
        retry = client.post("/api/face/start", json={"operation": "enroll"})
        assert retry.status_code == 503
        assert time.monotonic() - before < .5
        assert not service.registry.registered("server-alice")
    finally:
        gate.set()


def test_tampered_registered_artifact_cannot_authenticate(web):
    client, service, _, _ = web
    enrolled(web)
    _, calibration = service.registry.resolve("server-alice")
    calibration.write_text("other-user-artifact")
    assert client.post("/api/face/start", json={"operation": "authenticate"}).status_code == 503


def test_other_browser_context_cannot_submit_known_session(web):
    client, *_ = web
    start = client.post("/api/face/start", json={"operation": "enroll"}).json()
    client.cookies.clear()
    context = client.get("/api/face/context").json()
    client.headers["X-CSRF-Token"] = context["csrf_token"]
    assert client.post("/api/face/present", json={"session_id": start["session_id"],
        "nonce": start["nonce"], "displayed_at_ms": 1000}).status_code == 404


def test_invalid_jpeg_clears_evidence_and_forbids_retry(web):
    client, service, _, _ = web
    start = client.post("/api/face/start", json={"operation": "enroll"}).json()
    session = {k: start[k] for k in ("session_id", "nonce")}
    client.post("/api/face/present", json={**session, "displayed_at_ms": 1000})
    frame = {**session, "frame_id": 0, "timestamp_ms": 1000, "image": "not-base64!"}
    assert client.post("/api/face/frame", json=frame).status_code == 400
    assert service.captures[session["session_id"]].frames == []
    frame["image"] = jpeg()
    assert client.post("/api/face/frame", json=frame).status_code == 409


def test_forwarded_ip_is_not_used_as_trusted_identity(web):
    client, _, runtime, _ = web
    enrolled(web)
    client.headers["X-Forwarded-For"] = "192.0.2.200"
    session = capture(web, "authenticate")
    assert client.post("/api/face/verify", json=session).status_code == 200
    assert runtime.identity == ("server-alice", "127.0.0.1")


def test_registration_context_and_start_do_not_require_auth_configuration(web):
    client, service, _, _ = web
    service.config = replace(service.config, pad_model="", pad_registry="", query_budget_db="",
                             device_id="", threshold="", threshold_version="")
    # create_app retains its immutable config, so test a new app with the same runtime.
    app = create_app(service.config, Runtime(), Clock())
    with TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 41000)) as local:
        context = local.get("/api/face/context").json()
        assert context["ready"] is True
        assert context["registered"] is False
        local.headers["X-CSRF-Token"] = context["csrf_token"]
        start = local.post("/api/face/start", json={"operation": "enroll"})
        assert start.status_code == 200, start.text
        local.post("/api/face/cancel", json={key: start.json()[key] for key in ("session_id", "nonce")})
        registry = app.state.capture_service.registry
        pair = registry.allocate(service.config.user_id)
        pair[0].write_text("synthetic encrypted test output")
        pair[1].write_text("synthetic calibration test output")
        registry.publish(service.config.user_id, *pair)
        assert local.get("/api/face/context").json()["ready"] is False
        assert local.post("/api/face/start", json={"operation": "authenticate"}).status_code == 503


def test_actual_result_includes_runtime_calibration_and_frame_evidence(web):
    client, _, runtime, _ = web
    enrolled(web)
    evaluate = runtime.evaluate
    def with_evidence(*args):
        return {**evaluate(*args), "calibration": {"artifact_id": "bound-test-artifact", "source": "registration_calibration"},
                "total_frames": 30, "valid_face_frames": 24}
    runtime.evaluate = with_evidence
    session = capture(web, "authenticate")
    result = client.post("/api/face/verify", json=session).json()
    assert result["session"]["decision_provenance"]["calibration_artifact_id"] == "bound-test-artifact"
    assert result["session"]["audit"]["total_frames"] == 30
    assert result["session"]["audit"]["valid_face_frames"] == 24


@pytest.mark.parametrize("decision", ["ACCEPT", "STEP_UP", "REJECT", "ERROR"])
def test_private_attempt_logs_preserve_outcome_without_credentials(web, caplog, decision):
    import json
    caplog.set_level("INFO", logger="backend.app.capture_service")
    client, _, runtime, _ = web
    enrolled(web)
    runtime.decision = decision
    if decision == "ERROR":
        runtime.failure = ValueError("private-error-detail")
    session = capture(web, "authenticate")
    body = client.post("/api/face/verify", json=session).json()
    if decision == "ACCEPT":
        client.post("/api/face/consume", json={"session_id": session["session_id"], "token_id": body["token_id"]})
    events = [json.loads(r.message.removeprefix("face_attempt ")) for r in caplog.records
              if r.message.startswith("face_attempt ")]
    assert events[0]["operation"] == "enroll" and events[0]["status"] == "ENROLLED"
    outcome = next(e for e in events if e.get("decision") == decision)
    assert outcome["session_id"] == session["session_id"]
    if decision == "ERROR":
        assert outcome["error_code"] == "AUTHENTICATION_FAILED"
    if decision == "ACCEPT":
        assert events[-1]["status"] == "CONSUMED"
    encoded = json.dumps(events)
    for forbidden in ("one-use-test-token", session["nonce"], "server-alice", "private-error-detail", "image_bgr", "embedding"):
        assert forbidden not in encoded
