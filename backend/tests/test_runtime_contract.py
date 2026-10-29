"""Public metadata must describe the evaluated domain, never manufacture success."""
from types import SimpleNamespace

import pytest

from backend.app.capture_service import _auth_result
from backend.app.models import GateResultDto
from backend.app.services import DashboardService


def result(gates=(), decision="STEP_UP", token=None):
    capture = SimpleNamespace(operation="authenticate", session_id="test", created_at="2026-10-29T00:00:00Z")
    return _auth_result(capture, {"decision": decision, "token_id": token, "gates": list(gates)})


@pytest.mark.parametrize("status", ["SCORED", "PASS", "FAIL", "NOT_EVALUATED", "ERROR"])
def test_domain_status_and_scoring_role_survive(status):
    gate = result([{"gate": "adversarial", "status": status}])["session"]["gates"][0]
    assert gate["gate_id"] == "adversarial"
    assert gate["status"] == status
    assert gate["role"] == "SCORING"
    assert GateResultDto.model_validate(gate).status == status


@pytest.mark.parametrize("name,layer,role", [
    ("frame_integrity", "L0", "BLOCKING"), ("passive_pad", "L1", "BLOCKING"),
    ("identity", "L2", "SCORING"), ("adversarial", "L3", "SCORING"),
    ("query_budget", "L4", "ESCALATION"), ("future_gate", None, "BLOCKING"),
])
def test_display_layer_does_not_replace_gate(name, layer, role):
    gate = result([{"gate": name, "status": "PASS"}])["session"]["gates"][0]
    assert (gate["gate_id"], gate["status"], gate["role"]) == (name, "PASS", role)
    assert gate["display_layer"] == layer


def test_explicit_role_is_preserved():
    gate = result([{"gate": "future_gate", "status": "ERROR", "role": "SCORING"}])["session"]["gates"][0]
    assert gate["role"] == "SCORING"


def test_no_fabricated_version_and_no_internal_raw_scores():
    body = result([{"gate": "identity", "status": "PASS", "raw_scores": [0.1, 0.2]}])
    assert body["session"]["schema_version"] == "1.0"
    assert body["session"]["gates"][0]["provenance"]["artifact_version"] == "unknown"
    assert "raw_scores" not in body["session"]["gates"][0]


@pytest.mark.parametrize("decision,token", [("ACCEPT", "test-token"), ("STEP_UP", None), ("REJECT", None)])
def test_decision_does_not_authorize_before_consume(decision, token):
    body = result(decision=decision, token=token)
    assert body["authorized"] is False
    assert body["account_authenticated"] is False
    assert body["token_id"] == token


@pytest.mark.parametrize("decision,token", [("ACCEPT", None), ("STEP_UP", "bad"), ("REJECT", "bad")])
def test_inconsistent_token_fails_closed(decision, token):
    body = result(decision=decision, token=token)
    assert body["session"]["final_decision"] == "ERROR"
    assert body["token_id"] is None
    assert body["authorized"] is False


def test_static_dashboard_is_separate_from_runtime():
    service = DashboardService()
    before = service.hc160_result()
    live = result()
    assert live["session"]["decision_provenance"]["source"] == "hc160_runtime"
    assert service.hc160_result() == before
    assert before["session_id"] != live["session"]["session_id"]


def test_runtime_identity_is_cached_and_matches_worktree(tmp_path):
    import subprocess
    from unittest.mock import patch
    from backend.app.main import create_app
    from backend.app.model_adapter import ModelCliConfig
    from fastapi.testclient import TestClient
    repo = tmp_path
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "-c", "user.name=Contract Test",
                    "-c", "user.email=contract@example.invalid", "commit",
                    "--allow-empty", "-qm", "runtime fixture"], check=True)
    expected = subprocess.check_output(["git", "-C", str(repo), "rev-parse", "HEAD"], text=True).strip()
    app = create_app(ModelCliConfig(repo_path=str(repo)))
    (repo / "changed.py").write_text("# changed after initialization\n")
    with patch("subprocess.run", side_effect=AssertionError("Git must not run per request")), TestClient(app, base_url="http://127.0.0.1") as client:
        identity = client.get("/api/health").json()["runtime_identity"]
        assert identity["backend_commit"] == expected
        assert identity["backend_dirty"] is False
        assert client.get("/api/health").json()["runtime_identity"] == identity
    from backend.app.runtime_metadata import repository_identity
    assert repository_identity(repo) == {"commit": expected, "dirty": True}


def test_repository_without_own_git_metadata_is_unknown(tmp_path):
    from backend.app.runtime_metadata import repository_identity
    assert repository_identity(tmp_path) == {"commit": "unknown", "dirty": None}
    assert repository_identity("") == {"commit": "unknown", "dirty": None}


def test_git_unavailable_is_unknown(tmp_path):
    from unittest.mock import patch
    from backend.app.runtime_metadata import repository_identity
    (tmp_path / ".git").mkdir()
    with patch("subprocess.run", side_effect=FileNotFoundError):
        assert repository_identity(tmp_path) == {"commit": "unknown", "dirty": None}


def test_gate_runtime_version_uses_cached_commit():
    c = SimpleNamespace(operation="authenticate", session_id="test", created_at="now",
                        runtime_identity={"backend_commit": "a" * 40, "backend_dirty": True})
    body = _auth_result(c, {"decision": "REJECT", "gates": [{"gate": "identity", "status": "FAIL"}]})
    assert body["session"]["gates"][0]["provenance"]["artifact_version"] == "a" * 40 + "-dirty"
    assert body["session"]["decision_provenance"]["runtime_identity"] == c.runtime_identity


def test_repository_identity_handles_filesystem_unicode_normalization(tmp_path, monkeypatch):
    import unicodedata
    from backend.app import runtime_metadata
    root = tmp_path / "caf\u00e9"
    root.mkdir()
    (root / ".git").mkdir()
    git_root = tmp_path / unicodedata.normalize("NFD", root.name)
    if not git_root.exists():
        pytest.skip("filesystem does not alias Unicode normalization forms")
    assert root != git_root and root.samefile(git_root)
    outputs = iter([str(git_root), "a" * 40, ""])
    monkeypatch.setattr(runtime_metadata.subprocess, "run",
                        lambda *a, **kw: SimpleNamespace(stdout=next(outputs)))
    assert runtime_metadata.repository_identity(root) == {"commit": "a" * 40, "dirty": False}
