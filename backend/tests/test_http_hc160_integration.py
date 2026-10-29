"""HTTP JPEGs -> real HC160 sessions/encryption/calibration/policy; fake inference only."""
import base64
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest
from fastapi.testclient import TestClient

from backend.app.main import create_app
from backend.app.model_adapter import ModelCliConfig
from backend.app.hc160_runtime import HC160Runtime
from .test_browser_protocol import Clock, capture


@pytest.mark.skipif(not os.getenv("HC160_TEST_REPO"), reason="HC160_TEST_REPO required")
def test_browser_enrollment_then_full_policy_uses_same_session_and_pair(tmp_path, monkeypatch):
    repo = Path(os.environ["HC160_TEST_REPO"])
    monkeypatch.setenv("HC160_TEMPLATE_KEYS", json.dumps({"test-key": base64.b64encode(b"k" * 32).decode()}))
    pad = tmp_path / "unused-test-pad.onnx"
    pad.touch()  # Full inference is the explicit test seam below, not model validation.
    config = ModelCliConfig(repo_path=str(repo), storage_root=str(tmp_path), user_id="fixed-server-user",
                            device_id="fixed-device", query_budget_db=str(tmp_path / "shared.sqlite"),
                            pad_model=str(pad), pad_registry=str(repo / "configs/models/anti-spoof-mn3.json"),
                            threshold="0.6", threshold_version="test-only", template_key_id="test-key")
    runtime = HC160Runtime(config)
    cli = runtime._load()
    clock = Clock()
    app = create_app(config, runtime, clock)
    detector = SimpleNamespace(detect=lambda image: [SimpleNamespace(bbox=(0, 0, 160, 120), crop=image)])
    quality = SimpleNamespace(config=cli.QualityConfig(), evaluate=lambda *a: SimpleNamespace(
        result=cli.GateResult("quality", cli.GateStatus.PASS)))
    embedder = SimpleNamespace(model_version="synthetic-test", embed=lambda crops: [
        np.array([1., 0., 0.], dtype=np.float32) for _ in crops])
    observed = {}
    def pipeline(frames, **kwargs):
        observed.update(kwargs)
        observed["frames"] = frames
        gates = [cli.GateResult(name, cli.GateStatus.PASS, score=1., threshold=.6)
                 for name in ("frame_integrity", "quality", "single_face", "camera_motion", "content_replay",
                              "illumination_challenge", "passive_pad", "active_liveness", "continuity", "identity")]
        gates.append(cli.GateResult("adversarial", cli.GateStatus.SCORED, score=.25))
        return SimpleNamespace(baseline=SimpleNamespace(total_frames=len(frames), valid_face_frames=len(frames)),
                               gate_results=gates, adversarial=None)
    with patch.object(cli, "MTCNNFaceDetector", return_value=detector), \
         patch.object(cli, "FaceNetEmbedder", return_value=embedder), \
         patch.object(cli, "_quality_gate", return_value=quality), \
         patch.object(cli, "_full_pipeline", return_value=SimpleNamespace(evaluate=pipeline)), \
         TestClient(app, base_url="http://127.0.0.1", client=("127.0.0.1", 41000)) as client:
        client.headers["X-CSRF-Token"] = client.get("/api/face/context").json()["csrf_token"]
        web = (client, app.state.capture_service, runtime, clock)
        registration = capture(web)
        assert client.post("/api/face/verify", json=registration).json()["status"] == "ENROLLED"
        template, calibration = app.state.capture_service.registry.resolve(config.user_id)
        assert json.loads(template.read_text())["algorithm"] == "AES-256-GCM"
        # Keep the actual issued illumination times, but stream for the full random plan.
        started = client.post("/api/face/start", json={"operation": "authenticate"}).json()
        session = {k: started[k] for k in ("session_id", "nonce")}
        plan = client.post("/api/face/present", json={**session, "displayed_at_ms": 1000}).json()
        from .test_browser_protocol import jpeg
        origin = clock.now
        count = int(plan["capture_duration_ms"] / 100) + 1
        for i in range(count):
            clock.now = origin + i * .1
            response = client.post("/api/face/frame", json={**session, "frame_id": i,
                                   "timestamp_ms": 1000 + i * 100, "image": jpeg()})
            assert response.status_code == 200, response.text
        response = client.post("/api/face/verify", json=session)
        body = response.json()
        assert body["session"]["final_decision"] == "STEP_UP", body
        assert body["token_id"] is None
        by_id = {g["gate_id"]: g for g in body["session"]["gates"]}
        assert by_id["adversarial"]["status"] == "SCORED"
        assert by_id["adversarial"]["role"] == "SCORING"
        assert by_id["adversarial"]["display_layer"] == "L3"
        assert by_id["identity"]["role"] == "SCORING"
        identity = client.get("/api/health").json()["runtime_identity"]
        assert body["session"]["decision_provenance"]["runtime_identity"] == identity
        assert by_id["identity"]["provenance"]["artifact_version"] == identity["backend_commit"]
        assert body["session"]["query_budget"]["used"] == 1
        assert body["session"]["query_budget"]["exceeded"] is False
        assert body["session"]["audit"]["evidence_digest"]
        assert observed["expected_nonce"] == session["nonce"]
        assert observed["illumination_challenge"].nonce == session["nonce"]
        assert observed["challenge_start_frame_id"] == observed["frames"][0].frame_id
        assert observed["frames"][0].captured_at_monotonic == origin
        assert client.post("/api/face/verify", json=session).status_code == 409
        assert calibration.is_file()
