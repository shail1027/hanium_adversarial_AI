"""Opt-in real SBI/RetinaFace runtime smoke on a public skimage example image.

The actual web runtime, CLI FULL factory, synthetic loader/scorer and policy run.
Baseline/PAD/other security gates are doubles; this does not test camera behavior,
attack detection, calibration quality or successful FULL approval.
"""
import os
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from backend.app.model_adapter import ModelCliConfig
from .test_hc160_runtime import setup_runtime


@pytest.mark.skipif(
    not os.getenv("SYNTHETIC_MODEL") or not os.getenv("SYNTHETIC_DETECTOR_MODEL"),
    reason="set SYNTHETIC_MODEL and SYNTHETIC_DETECTOR_MODEL for real SBI opt-in",
)
def test_actual_sbi_score_reaches_web_runtime_policy_without_reference(setup_runtime):
    from PIL import Image
    from skimage import data
    import torch
    from src.face_auth.inference.pipeline import PipelineObservation

    runtime, cli, _, template_path, calibration_path, _ = setup_runtime
    root = runtime.config.directory
    runtime.config = ModelCliConfig(
        repo_path=str(Path(os.environ["HC160_TEST_REPO"])), storage_root=str(root),
        user_id="alice", device_id="test-device", template_key_id="test-key",
        query_budget_db=str(root / "budget.sqlite"), pad_model=str(root / "unused-pad.onnx"),
        pad_registry=str(Path(os.environ["HC160_TEST_REPO"]) / "configs/models/anti-spoof-mn3.json"),
        synthetic_model=os.environ["SYNTHETIC_MODEL"],
        synthetic_detector_model=os.environ["SYNTHETIC_DETECTOR_MODEL"],
    )
    rgb = data.astronaut()
    frames = [cli.FramePacket(i, i / 10., rgb[:, :, ::-1].copy()) for i in range(6)]
    baseline_gates = tuple(cli.GateResult(name, cli.GateStatus.PASS, score=1., threshold=.6)
                           for name in ("frame_integrity", "quality", "single_face", "identity"))
    evidence = tuple(SimpleNamespace(
        frame=frame, face=SimpleNamespace(bbox=(0, 0, 512, 512), crop=Image.fromarray(rgb)),
        embedding=np.array([1., 0., 0.], dtype=np.float32),
    ) for frame in frames)
    baseline = SimpleNamespace(evaluate=lambda fs: PipelineObservation(
        baseline_gates, len(fs), len(fs), evidence))
    observed = {}
    factory = cli._full_pipeline

    def full_pipeline(*args):
        pipeline = factory(*args)
        evaluate = pipeline.evaluate

        def capture(*a, **kw):
            result = evaluate(*a, **kw)
            observed["full"] = result
            return result

        return SimpleNamespace(evaluate=capture)

    def passing(name):
        return SimpleNamespace(evaluate=lambda *a, **k: cli.GateResult(name, cli.GateStatus.PASS))

    session, challenge = runtime.create("alice", "LOGIN", None)
    illumination = runtime.illumination(challenge.nonce, 0.)
    threads = torch.get_num_threads()
    try:
        torch.set_num_threads(2)
        with ExitStack() as stack:
            stack.enter_context(patch.object(cli, "MTCNNFaceDetector"))
            stack.enter_context(patch.object(cli, "FaceNetEmbedder"))
            stack.enter_context(patch.object(cli, "BaselineEvidencePipeline", return_value=baseline))
            stack.enter_context(patch.object(cli, "create_pad_scorer", return_value=SimpleNamespace(
                score=lambda crops: [.99] * len(crops))))
            stack.enter_context(patch.object(cli, "FivePointHeadPoseEstimator", return_value=SimpleNamespace(
                estimate=lambda *a: None)))
            stack.enter_context(patch.object(cli, "_full_pipeline", side_effect=full_pipeline))
            for constructor, gate in (
                ("CameraMotionGate", "camera_motion"), ("ContentReplayGate", "content_replay"),
                ("IlluminationChallengeGate", "illumination_challenge"),
                ("ActiveLivenessGate", "active_liveness"),
            ):
                stack.enter_context(patch.object(cli, constructor, return_value=passing(gate)))
            result = runtime.evaluate(session.session_id, "alice", None, frames, 1,
                                     illumination, template_path, calibration_path)
    finally:
        torch.set_num_threads(threads)
    signal = next(item for item in observed["full"].score_contributions if item.axis == "synthetic")
    assert signal.evaluated and signal.status is cli.GateStatus.SCORED
    assert np.isfinite(signal.score) and 0. <= signal.score <= 1.
    assert signal.signal_version == "synthetic-frame-mean-v1"
    assert any(setting.startswith("model_sha256=") for setting in signal.settings)
    assert any(setting.startswith("preprocessing_version=sbi-preprocess-v1:") for setting in signal.settings)
    assert all(g.status is cli.GateStatus.PASS for g in observed["full"].gate_results)
    assert result["decision"] == "STEP_UP"
    assert result["token_id"] is None
    assert runtime.store.find_token_by_session(session.session_id) is None
    print(f"real_sbi_web_runtime_smoke frames={len(frames)} synthetic_score={signal.score:.12f}")
