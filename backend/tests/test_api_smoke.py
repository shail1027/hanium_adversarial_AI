from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.model_adapter import ModelCliConfig


client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["hc160_cli_ready"] is False
    assert "HC160_TEMPLATE_PATH" in response.json()["hc160_cli_missing"]


def test_admin_login_role():
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "demo"},
    )

    assert response.status_code == 200
    assert response.json()["role"] == "admin"


def test_attack_detection_returns_step_up_warning():
    started = client.post(
        "/api/face/start",
        json={"user_id": "demo-user", "purpose": "LOGIN"},
    ).json()
    response = client.post(
        "/api/face/verify",
        json={"session_id": started["session_id"], "scenario": "attack"},
    )
    body = response.json()

    assert response.status_code == 200
    assert body["session"]["final_decision"] == "STEP_UP"
    assert body["attack_detected"] is True
    assert body["next_action"] == "step_up"


def test_normal_face_auth_accepts():
    started = client.post(
        "/api/face/start",
        json={"user_id": "demo-user", "purpose": "LOGIN"},
    ).json()
    response = client.post(
        "/api/face/verify",
        json={"session_id": started["session_id"], "scenario": "normal"},
    )
    body = response.json()

    assert response.status_code == 200
    assert body["session"]["final_decision"] == "ACCEPT"
    assert body["next_action"] == "continue"
    assert body["session"]["audit"]["model_source"] == "fixture"


def test_quality_failure_rejects_without_attack_warning():
    started = client.post(
        "/api/face/start",
        json={"user_id": "demo-user", "purpose": "LOGIN"},
    ).json()
    response = client.post(
        "/api/face/verify",
        json={"session_id": started["session_id"], "scenario": "quality_fail"},
    )
    body = response.json()

    assert response.status_code == 200
    assert body["session"]["final_decision"] == "REJECT"
    assert body["attack_detected"] is False


def test_timeout_returns_error_retry():
    started = client.post(
        "/api/face/start",
        json={"user_id": "demo-user", "purpose": "LOGIN"},
    ).json()
    response = client.post(
        "/api/face/verify",
        json={"session_id": started["session_id"], "scenario": "timeout"},
    )
    body = response.json()

    assert response.status_code == 200
    assert body["session"]["final_decision"] == "ERROR"
    assert body["next_action"] == "retry"


def test_dashboard_static_file_allowlist():
    response = client.get("/api/dashboard/static/forensics/dashboard_overview.json")

    assert response.status_code == 200
    assert response.json()["total_sessions"] == 2000


def test_dashboard_static_file_rejects_unknown_dataset():
    response = client.get("/api/dashboard/static/private/secrets.json")

    assert response.status_code == 404


def test_handoff_dir_supplies_demo_defaults(monkeypatch):
    monkeypatch.setenv("HC160_HANDOFF_DIR", "/tmp/handoff")
    monkeypatch.setenv("HC160_REPO_PATH", "/tmp/hc160")
    monkeypatch.setenv("HC160_DEMO_USER_ID", "api-demo-user")

    config = ModelCliConfig.from_env()

    assert config.template_path == "/tmp/handoff/api-demo-user.enc.json"
    assert config.video_path == "/tmp/handoff/api-demo-genuine.mp4"
    assert config.template_audit_log == "/tmp/handoff/api-demo-audit.jsonl"
    assert config.demo_user_id == "api-demo-user"
    assert config.threshold == 0.60
    assert config.threshold_version == "demo-smoke-v1"


def test_torch_home_can_use_hc160_specific_env(monkeypatch):
    monkeypatch.setenv("HC160_TORCH_HOME", "/tmp/torch-cache")

    config = ModelCliConfig.from_env()

    assert config.torch_home == "/tmp/torch-cache"
