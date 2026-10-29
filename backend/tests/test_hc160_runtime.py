"""Real HC160 policy/storage tests; synthetic inference is explicitly substituted."""
import base64
from datetime import timedelta
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
import pytest

from backend.app.hc160_runtime import HC160Runtime


REPO = Path(os.environ.get("HC160_TEST_REPO", "/nonexistent-hc160-test-repo"))
pytestmark = pytest.mark.skipif(
    not os.environ.get("HC160_TEST_REPO") or not (REPO / "src/face_auth/cli.py").exists(),
    reason="set HC160_TEST_REPO to the baseline model repository",
)


class Config:
    repo_path = str(REPO)

    def __init__(self, directory):
        self.directory = directory

    def enrollment_args(self, user_id, template_path, calibration_path):
        from backend.app.model_adapter import ModelCliConfig
        return ModelCliConfig(repo_path=str(REPO), storage_root=str(self.directory),
                              template_key_id="test-key").enrollment_args(
                                  user_id, template_path, calibration_path)

    def args(self, user_id, template_path, calibration_path, source_ip):
        runtime = HC160Runtime(self)
        cli = runtime._load()
        args = cli.build_parser().parse_args([
            "authenticate", "--video", "unused", "--user-id", user_id, "--template", str(template_path),
            "--threshold", "0.6", "--threshold-version", "test-population",
            "--device", "cpu", "--profile", "FULL", "--query-budget-store", "sqlite",
            "--query-budget-db", str(self.directory / "budget.sqlite"),
            "--pad-runtime", "onnx", "--pad-model", str(self.directory / "model.onnx"),
            "--pad-registry", str(REPO / "configs/models/anti-spoof-mn3.json"),
            "--graded-rule-table", str(REPO / "configs/decision/graded_decision_v1.json"),
            "--query-budget-config", str(REPO / "configs/decision/query_budget_v1.json"),
            "--template-audit-log", str(self.directory / "audit.jsonl"),
        ])
        args.template_key_id = "test-key"
        args.device_id = "server-device"
        args.source_ip = source_ip
        return args


@pytest.fixture
def setup_runtime(tmp_path, monkeypatch):
    monkeypatch.setenv("HC160_TEMPLATE_KEYS", json.dumps({
        "test-key": base64.b64encode(b"x" * 32).decode(),
    }))
    runtime = HC160Runtime(Config(tmp_path))
    cli = runtime._load()
    frames = [cli.FramePacket(i, float(i) / 10, np.full((20, 20, 3), i, dtype=np.uint8))
              for i in range(6)]
    template_path = tmp_path / "template.enc.json"
    calibration_path = tmp_path / "calibration.json"
    detector = SimpleNamespace(detect=lambda image: [SimpleNamespace(bbox=(0, 0, 20, 20), crop=image)])
    quality = SimpleNamespace(config=cli.QualityConfig(), evaluate=lambda *a: SimpleNamespace(
        result=cli.GateResult("quality", cli.GateStatus.PASS)))
    embedder = SimpleNamespace(model_version="test-model", embed=lambda crops: [
        np.array([1., 0., 0.], dtype=np.float32) for _ in crops])
    with patch.object(cli, "MTCNNFaceDetector", return_value=detector), \
            patch.object(cli, "FaceNetEmbedder", return_value=embedder), \
            patch.object(cli, "_quality_gate", return_value=quality):
        enrolled = runtime.enroll("alice", frames, template_path, calibration_path)
    return runtime, cli, frames, template_path, calibration_path, enrolled


def run_evaluation(fixture, *, failed_gate=False, accepted=False):
    runtime, cli, frames, template_path, calibration_path, _ = fixture
    session, challenge = runtime.create("alice", "LOGIN", "context")
    illumination = runtime.illumination(challenge.nonce, 0.)
    names = ("frame_integrity", "quality", "single_face", "camera_motion", "content_replay",
             "illumination_challenge", "passive_pad", "active_liveness", "continuity", "identity")
    gates = [cli.GateResult(name, cli.GateStatus.FAIL if failed_gate and name == "passive_pad"
                           else cli.GateStatus.PASS, score=1., threshold=.6) for name in names]
    contributions = ()
    if accepted:
        from src.face_auth.domain.graded_decision import ScoreContribution
        contributions = (ScoreContribution("synthetic", 0.), ScoreContribution("adversarial", 0.))
        reference_path = runtime.config.directory / "references.json"
        reference_path.write_text(json.dumps({
            "margin": [0., .1, .2], "synthetic": [.1, .2, .3], "adversarial": [.1, .2, .3],
        }))
        original_args = runtime.config.args
        def configured_args(*args):
            result = original_args(*args)
            result.decision_reference_distributions = str(reference_path)
            return result
        runtime.config.args = configured_args
    observation = SimpleNamespace(
        baseline=SimpleNamespace(total_frames=6, valid_face_frames=6),
        gate_results=gates, score_contributions=contributions,
    )
    pipeline = SimpleNamespace(evaluate=lambda *a, **k: observation)
    with patch.object(cli, "MTCNNFaceDetector"), patch.object(cli, "FaceNetEmbedder"), \
            patch.object(cli, "_full_pipeline", return_value=pipeline):
        result = runtime.evaluate(session.session_id, "alice", "127.0.0.1", frames, 1,
                                  illumination, template_path, calibration_path)
    return session, illumination, result


def test_enrollment_persists_bound_encrypted_template(setup_runtime):
    runtime, cli, _, template_path, calibration_path, enrolled = setup_runtime
    args = runtime.config.args("alice", template_path, calibration_path, None)
    template = cli._template_repository(args).read(template_path, user_id="alice")
    assert enrolled["status"] == "ENROLLED"
    artifact = json.loads(calibration_path.read_text())
    assert artifact["subject_reference"] == f"template:{template.template_version}"
    assert artifact["binding"]["runtime"] == {"device": "cpu"}
    with pytest.raises(cli.TemplateStorageError):
        cli._template_repository(args).read(template_path, user_id="bob")
    assert "embedding" not in json.loads(template_path.read_text())


def test_unvalidated_artifact_cannot_bypass_binding(setup_runtime):
    runtime, cli, _, template_path, calibration_path, _ = setup_runtime
    payload = json.loads(calibration_path.read_text())
    payload.update(validated=False, validation_evidence=[])
    payload["subject_reference"] = "template:other-person"
    calibration_path.write_text(json.dumps(payload))
    args = runtime.config.args("alice", template_path, calibration_path, None)
    template = cli._template_repository(args).read(template_path, user_id="alice")
    with pytest.raises(cli.RegistrationCalibrationError, match="binding mismatch"):
        runtime._bound_calibration(cli, args, template, calibration_path)


def test_missing_reference_returns_step_up_without_token_and_duplicate_denied(setup_runtime):
    runtime, _, frames, template_path, calibration_path, _ = setup_runtime
    session, illumination, result = run_evaluation(setup_runtime)
    assert result["decision"] == "STEP_UP"
    assert result["token_id"] is None
    with pytest.raises(ValueError, match="already submitted"):
        runtime.evaluate(session.session_id, "alice", "127.0.0.1", frames, 1,
                         illumination, template_path, calibration_path)


def test_reject_has_no_token(setup_runtime):
    _, _, result = run_evaluation(setup_runtime, failed_gate=True)
    assert result["decision"] == "REJECT"
    assert result["token_id"] is None


def test_requests_share_sqlite_budget(setup_runtime):
    _, _, first = run_evaluation(setup_runtime)
    _, _, second = run_evaluation(setup_runtime)
    assert second["query_budget"]["account"] == first["query_budget"]["account"] + 1


def test_session_owner_expiry_nonce_and_unknown_rejected(setup_runtime):
    runtime, cli, frames, template_path, calibration_path, _ = setup_runtime
    session, challenge = runtime.create("alice", "LOGIN", None)
    illumination = runtime.illumination(challenge.nonce, 0.)
    def evaluate(sid=session.session_id, user="alice", light=illumination):
        return runtime.evaluate(sid, user, None, frames, 1, light, template_path, calibration_path)
    with pytest.raises(KeyError):
        evaluate(sid="unknown")
    with pytest.raises(ValueError, match="user mismatch"):
        evaluate(user="bob")
    with pytest.raises(ValueError, match="nonce mismatch"):
        evaluate(light=runtime.illumination("other-nonce", 0.))
    runtime.sessions.clock = lambda: challenge.expires_at + timedelta(seconds=1)
    with pytest.raises(ValueError, match="expired"):
        evaluate()


def test_pad_or_db_failure_leaves_no_token_and_cannot_retry(setup_runtime):
    runtime, cli, frames, template_path, calibration_path, _ = setup_runtime
    session, challenge = runtime.create("alice", "LOGIN", None)
    illumination = runtime.illumination(challenge.nonce, 0.)
    with patch.object(cli, "_decision_policy_service", side_effect=RuntimeError("DB unavailable")):
        with pytest.raises(RuntimeError, match="DB unavailable"):
            runtime.evaluate(session.session_id, "alice", None, frames, 1,
                             illumination, template_path, calibration_path)
    assert session.state is cli.SessionState.ERROR
    assert runtime.store.find_token_by_session(session.session_id) is None


def test_token_consumed_once_in_same_runtime(setup_runtime):
    runtime, cli, *_ = setup_runtime
    session, _ = runtime.create("alice", "LOGIN", "ctx")
    for state in (cli.SessionState.CAPTURING, cli.SessionState.EVIDENCE_RECEIVED,
                  cli.SessionState.EVALUATING, cli.SessionState.VERIFIED):
        runtime.sessions.move(session.session_id, state)
    token = runtime.tokens.issue(session.session_id)
    with pytest.raises(ValueError):
        runtime.consume(token.token_id, "bob", "LOGIN", "ctx")
    assert runtime.consume(token.token_id, "alice", "LOGIN", "ctx")["consumed"]
    with pytest.raises(ValueError):
        runtime.consume(token.token_id, "alice", "LOGIN", "ctx")


def test_actual_policy_accept_issues_consumable_token(setup_runtime):
    runtime, *_ = setup_runtime
    session, _, result = run_evaluation(setup_runtime, accepted=True)
    assert result["decision"] == "ACCEPT"
    assert result["token_id"]
    assert runtime.consume(result["token_id"], "alice", "LOGIN", "context")["consumed"]
    assert session.state.value == "CONSUMED"


def test_pad_failure_marks_error_without_token(setup_runtime):
    runtime, cli, frames, template_path, calibration_path, _ = setup_runtime
    session, challenge = runtime.create("alice", "LOGIN", None)
    illumination = runtime.illumination(challenge.nonce, 0.)
    with patch.object(cli, "MTCNNFaceDetector"), patch.object(cli, "FaceNetEmbedder"), \
            patch.object(cli, "_full_pipeline", side_effect=RuntimeError("PAD unavailable")):
        with pytest.raises(RuntimeError, match="PAD unavailable"):
            runtime.evaluate(session.session_id, "alice", None, frames, 1,
                             illumination, template_path, calibration_path)
    assert session.state is cli.SessionState.ERROR
    assert runtime.store.find_token_by_session(session.session_id) is None


def test_verified_manifest_rejects_modified_nonce_before_inference(setup_runtime):
    from dataclasses import replace
    runtime, cli, frames, template_path, calibration_path, _ = setup_runtime
    session, challenge = runtime.create("alice", "LOGIN", None)
    illumination = runtime.illumination(challenge.nonce, 0.)
    build = cli.build_capture_manifest
    def wrong_nonce(*args, **kwargs):
        return replace(build(*args, **kwargs), nonce="different-session-nonce")
    with patch.object(cli, "MTCNNFaceDetector"), patch.object(cli, "FaceNetEmbedder"), \
            patch.object(cli, "build_capture_manifest", side_effect=wrong_nonce), \
            patch.object(cli, "_full_pipeline") as pipeline:
        with pytest.raises(ValueError, match="manifest session/nonce/evidence binding"):
            runtime.evaluate(session.session_id, "alice", None, frames, 1,
                             illumination, template_path, calibration_path)
    pipeline.assert_not_called()
    assert session.state is cli.SessionState.ERROR
    assert runtime.store.find_token_by_session(session.session_id) is None


def test_budget_summary_distinguishes_gate_reject_from_exhaustion(setup_runtime):
    runtime, cli, *_ = setup_runtime
    _, _, rejected = run_evaluation(setup_runtime, failed_gate=True)
    assert rejected["decision"] == "REJECT"
    assert rejected["query_budget_summary"]["exceeded"] is False
    assert rejected["query_budget_summary"]["limit"] == cli.load_budget_config(
        REPO / "configs/decision/query_budget_v1.json").max_attempts
    # The configured consecutive STEP_UP policy is reached without changing gates.
    maximum = cli.load_budget_config(REPO / "configs/decision/query_budget_v1.json").max_consecutive_step_up
    for _ in range(maximum):
        _, _, result = run_evaluation(setup_runtime)
    assert result["decision"] == "REJECT"
    assert result["query_budget_summary"]["exceeded"] is True
    assert result["query_budget_summary"]["reason"] == "CONSECUTIVE_STEP_UP"
    assert result["query_budget_summary"]["used"] == result["query_budget"]["account"]


@pytest.mark.skipif(not os.environ.get("HC160_TEST_PAD_MODEL"), reason="real PAD model opt-in")
def test_registered_real_onnx_pad_executes_rgb_roi():
    from PIL import Image
    runtime = HC160Runtime(SimpleNamespace(repo_path=str(REPO)))
    cli = runtime._load()
    registry = REPO / "configs/models/anti-spoof-mn3.json"
    scorer = cli.create_pad_scorer(
        runtime="onnx", model_path=os.environ["HC160_TEST_PAD_MODEL"],
        model_version="open-model-zoo-anti-spoof-mn3-2022.1",
        registry_path=str(registry), device="cpu",
    )
    # Synthetic raw RGB ROI proves model loading/preprocessing/inference only;
    # it is neither a real-camera PAD accuracy claim nor an authentication pass.
    rgb = np.random.default_rng(3).integers(0, 256, (160, 180, 3), dtype=np.uint8)
    scores = scorer.score([Image.fromarray(rgb, "RGB")])
    assert len(scores) == 1 and np.isfinite(scores[0]) and 0. <= scores[0] <= 1.
    assert scorer.metadata()["preprocessing"]["color_order"] == "RGB"
    assert json.loads(registry.read_text())["validation_status"] == "candidate_unvalidated"


def test_frame_factory_preserves_server_time_and_source_metadata(setup_runtime):
    runtime, cli, *_ = setup_runtime
    image = np.zeros((8, 8, 3), dtype=np.uint8)
    frame = runtime.make_frame(12, 123.5, image, 980.)
    assert isinstance(frame, cli.FramePacket)
    assert frame.frame_id == 12
    assert frame.captured_at_monotonic == 123.5
    assert frame.source_time_ms == 980.
    assert frame.image_bgr is image


@pytest.mark.parametrize("mutation", ["none", "unvalidated", "wrong-binding", "malformed", "missing"])
def test_artifact_only_authentication_fails_closed(setup_runtime, mutation):
    runtime, cli, _, template_path, calibration_path, _ = setup_runtime
    args = runtime.config.args("alice", template_path, calibration_path, None)
    args.threshold = args.threshold_version = None
    template = cli._template_repository(args).read(template_path, user_id="alice")
    payload = json.loads(calibration_path.read_text())
    if mutation == "unvalidated":
        payload.update(validated=False, validation_evidence=[], limitations=["test unvalidated"])
    if mutation == "wrong-binding":
        payload["subject_reference"] = "template:other-person"
    calibration_path.write_text("{}" if mutation == "malformed" else json.dumps(payload))
    if mutation == "missing":
        calibration_path.unlink()
    if mutation == "none":
        selection = runtime._bound_calibration(cli, args, template, calibration_path)
        assert selection.provenance.applied is True
        assert selection.provenance.artifact_id == payload["artifact_id"]
    else:
        with pytest.raises((cli.RegistrationCalibrationError, OSError)):
            runtime._bound_calibration(cli, args, template, calibration_path)


@pytest.mark.parametrize("failed", [False, True])
def test_explicit_synthetic_settings_reach_pipeline_and_policy_without_token(setup_runtime, caplog, failed):
    """Real runtime/policy; pipeline result is a test double, never model evidence."""
    from backend.app.model_adapter import ModelCliConfig
    from src.face_auth.domain.graded_decision import ScoreContribution

    runtime, cli, frames, template_path, calibration_path, _ = setup_runtime
    directory = runtime.config.directory
    runtime.config = ModelCliConfig(
        repo_path=str(REPO), storage_root=str(directory), user_id="alice", device_id="fixed",
        query_budget_db=str(directory / "budget.sqlite"),
        pad_model=str(directory / "pad.onnx"),
        pad_registry=str(REPO / "configs/models/anti-spoof-mn3.json"),
        template_key_id="test-key", synthetic_model=str(directory / "FFc23.tar"),
        synthetic_detector_model=str(directory / "retinaface.pth"),
    )
    session, challenge = runtime.create("alice", "LOGIN", None)
    illumination = runtime.illumination(challenge.nonce, 0.)
    names = ("frame_integrity", "quality", "single_face", "camera_motion", "content_replay",
             "illumination_challenge", "passive_pad", "active_liveness", "continuity", "identity")
    gates = tuple(cli.GateResult(name, cli.GateStatus.PASS, score=1., threshold=.6)
                  for name in names)
    signal = ScoreContribution(
        "synthetic", None if failed else .2, evaluated=not failed,
        reason_codes=("MODEL_ERROR",) if failed else (), signal_version="synthetic-frame-mean-v1",
    )
    observation = SimpleNamespace(
        baseline=SimpleNamespace(total_frames=6, valid_face_frames=6),
        gate_results=gates, score_contributions=(signal,),
    )

    def configured_pipeline(args, baseline, embedder, template_embedding):
        assert args.synthetic_model == runtime.config.synthetic_model
        assert args.synthetic_detector_model == runtime.config.synthetic_detector_model
        assert args.synthetic_device == "cpu"
        return SimpleNamespace(evaluate=lambda *a, **k: observation)

    with patch.object(cli, "MTCNNFaceDetector"), patch.object(cli, "FaceNetEmbedder"), \
            patch.object(cli, "_full_pipeline", side_effect=configured_pipeline):
        result = runtime.evaluate(session.session_id, "alice", None, frames, 1,
                                  illumination, template_path, calibration_path)
    assert result["decision"] == "STEP_UP"
    assert result["token_id"] is None
    assert runtime.store.find_token_by_session(session.session_id) is None
    assert "MISSING_REFERENCE:synthetic" in caplog.text
    assert "SCORE_NOT_PROVIDED:synthetic" not in caplog.text
    if failed:
        assert "SCORE_UNAVAILABLE:synthetic:ERROR" in caplog.text
    else:
        assert "SCORE_UNAVAILABLE:synthetic" not in caplog.text
    assert "synthetic" not in [gate["gate"] for gate in result["gates"]]
