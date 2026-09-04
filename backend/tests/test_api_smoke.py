from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


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


def test_dashboard_static_file_allowlist():
    response = client.get("/api/dashboard/static/forensics/dashboard_overview.json")

    assert response.status_code == 200
    assert response.json()["total_sessions"] == 2000


def test_dashboard_static_file_rejects_unknown_dataset():
    response = client.get("/api/dashboard/static/private/secrets.json")

    assert response.status_code == 404
