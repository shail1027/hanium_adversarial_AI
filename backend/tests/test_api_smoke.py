from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.model_adapter import ModelCliConfig


def client():
    return TestClient(create_app(ModelCliConfig()), base_url="http://127.0.0.1", client=("127.0.0.1", 41000))


def test_health_is_not_authentication_ready_without_config():
    with client() as c:
        body = c.get("/api/health").json()
    assert body["hc160_runtime_ready"] is False
    assert "HC160_LOCAL_USER_ID" in body["hc160_runtime_missing"]
    assert body["account_authentication"] == "not_connected"


def test_demo_login_does_not_verify_account_or_authorize_face_request():
    with client() as c:
        body = c.post("/api/auth/login", json={"username": "admin", "password": "anything"}).json()
        assert body["role"] == "admin"  # Display-only dashboard selection.
        assert body["authenticated"] is False
        assert c.post("/api/face/start", json={"operation": "enroll"},
                      headers={"Authorization": "Bearer " + body["access_token"]}).status_code == 403


def test_missing_model_configuration_never_returns_fixture_accept():
    with client() as c:
        context = c.get("/api/face/context").json()
        result = c.post("/api/face/start", json={"operation": "enroll"},
                        headers={"X-CSRF-Token": context["csrf_token"]})
        assert result.status_code == 503
        assert result.json()["detail"]["code"] == "CONFIGURATION_REQUIRED"


def test_dashboard_static_allowlist_preserved():
    with client() as c:
        assert c.get("/api/dashboard/static/forensics/dashboard_overview.json").json()["total_sessions"] == 2000
        assert c.get("/api/dashboard/static/private/secrets.json").status_code == 404
