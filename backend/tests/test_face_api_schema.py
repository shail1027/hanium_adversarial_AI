"""Validate emitted HTTP bodies; fake inference never proves real FULL approval."""
import copy
import json
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
import pytest

from .test_browser_protocol import capture, enrolled, web  # noqa: F401


SCHEMAS = Path(__file__).resolve().parents[2] / "schemas" / "api"


def validator(name):
    schema = json.loads((SCHEMAS / name).read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema, format_checker=FormatChecker())


def validate_face_response(body):
    validator("face-verify-response.schema.json").validate(body)


def test_static_dashboard_still_matches_its_own_schema(web):
    client, *_ = web
    response = client.get("/api/dashboard/hc160/session-result")
    assert response.status_code == 200
    body = response.json()
    validator("session-result.schema.json").validate(body)
    assert not validator("face-verify-response.schema.json").is_valid(body)
    summaries = client.get("/api/dashboard/hc160/session-summaries")
    assert summaries.status_code == 200
    for summary in summaries.json():
        validator("session-summary.schema.json").validate(summary)


def test_unregistered_and_enrolled_http_contract(web):
    client, *_ = web
    assert client.get("/api/face/context").json()["registered"] is False
    denied = client.post("/api/face/start", json={"operation": "authenticate"})
    assert denied.status_code == 409
    assert denied.json()["detail"]["code"] == "ENROLLMENT_REQUIRED"
    response = client.post("/api/face/verify", json=capture(web))
    assert response.status_code == 200
    validate_face_response(response.json())
    assert client.get("/api/face/context").json()["registered"] is True


@pytest.mark.parametrize("decision", ["STEP_UP", "REJECT", "ERROR", "ACCEPT"])
def test_actual_http_authentication_and_consumption_schema(web, decision):
    client, _, runtime, _ = web
    enrolled(web)
    runtime.decision = decision
    if decision == "ERROR":
        runtime.failure = OSError("test model unavailable")
    session = capture(web, "authenticate")
    response = client.post("/api/face/verify", json=session)
    assert response.status_code == 200
    body = response.json()
    validate_face_response(body)
    assert body["session"]["final_decision"] == decision
    assert body["authorized"] is False
    assert body["account_authenticated"] is False
    if decision == "ACCEPT":
        # Existing Runtime is a test double for inference and token storage.
        assert body["token_id"]
        payload = {"session_id": session["session_id"], "token_id": body["token_id"]}
        consumed = client.post("/api/face/consume", json=payload)
        assert consumed.status_code == 200
        validator("face-consume-response.schema.json").validate(consumed.json())
        assert client.post("/api/face/consume", json=payload).status_code == 409
    else:
        assert body["token_id"] is None
        invalid = copy.deepcopy(body)
        invalid["token_id"] = "not-allowed"
        assert not validator("face-verify-response.schema.json").is_valid(invalid)


def test_enrollment_failure_uses_runtime_error_contract(web):
    client, _, runtime, _ = web
    runtime.failure = OSError("test enrollment unavailable")
    response = client.post("/api/face/verify", json=capture(web))
    assert response.status_code == 200
    validate_face_response(response.json())
    assert response.json()["session"]["final_decision"] == "ERROR"
    assert client.get("/api/face/context").json()["registered"] is False
