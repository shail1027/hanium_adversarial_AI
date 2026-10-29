"""The web adapter must always construct the same fixed FULL contract."""
import os
from pathlib import Path
import sys
from dataclasses import replace

import pytest

from backend.app.model_adapter import ModelCliConfig


def strict_reference_settings(directory):
    """Path-only configuration doubles; never a verified or measured bundle."""
    bundle = directory / "bundle"
    bundle.mkdir(exist_ok=True)
    values = {"reference_bundle": str(bundle), "reference_protocol_id": "test-protocol",
              "l3_defense_score": True}
    for field in ("reference_scores", "reference_contract", "reference_splits"):
        path = directory / f"{field}.json"
        path.touch()
        values[field] = str(path)
    return values


def test_unconfigured_or_relative_paths_are_not_ready(monkeypatch):
    monkeypatch.delenv("HC160_TEMPLATE_KEYS", raising=False)
    assert not ModelCliConfig().ready()
    cfg = ModelCliConfig(query_budget_db="per-request.sqlite", pad_model="relative.onnx")
    assert "query_budget_db: absolute path required" in cfg.blockers()
    assert "pad_model: absolute path required" in cfg.blockers()


def test_full_args_use_shared_db_registered_pad_and_matching_device(tmp_path):
    repo = os.getenv("HC160_TEST_REPO")
    if not repo:
        pytest.skip("HC160_TEST_REPO required")
    sys.path.insert(0, repo)
    config = ModelCliConfig(repo_path=repo, storage_root=str(tmp_path), user_id="alice", device_id="fixed",
                            query_budget_db=str(tmp_path / "shared.sqlite"), pad_model=str(tmp_path / "pad.onnx"),
                            pad_registry=str(Path(repo) / "configs/models/anti-spoof-mn3.json"),
                            threshold="0.73", threshold_version="existing-threshold", template_key_id="key")
    first = config.args("alice", tmp_path / "alice.enc", tmp_path / "alice.calibration.json", "127.0.0.1")
    second = config.args("bob", tmp_path / "bob.enc", tmp_path / "bob.calibration.json", "127.0.0.1")
    assert first.profile == second.profile == "FULL"
    assert first.query_budget_store == second.query_budget_store == "sqlite"
    assert first.query_budget_db == second.query_budget_db == config.query_budget_db
    assert Path(first.query_budget_db).is_absolute()
    assert first.pad_runtime == "onnx"
    assert first.pad_model_version == "open-model-zoo-anti-spoof-mn3-2022.1"
    assert first.pad_registry == config.pad_registry
    assert first.device == second.device == "cpu"
    assert first.device_id == second.device_id == "fixed"
    assert first.threshold == .73
    assert first.challenge_start_frame_id is None
    assert first.registration_calibration_artifact != second.registration_calibration_artifact


def test_environment_does_not_infer_demo_threshold_or_user(monkeypatch):
    for name in ("HC160_LOCAL_USER_ID", "HC160_THRESHOLD", "HC160_THRESHOLD_VERSION"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HC160_HANDOFF_DIR", "/tmp/legacy-demo")
    monkeypatch.setenv("HC160_DEMO_USER_ID", "old-untrusted-demo")
    config = ModelCliConfig.from_env()
    assert config.user_id == config.threshold == config.threshold_version == ""


def test_enrollment_ready_without_authentication_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("HC160_TEMPLATE_KEYS", "test-only")
    config = ModelCliConfig(repo_path=str(tmp_path), storage_root=str(tmp_path),
                            user_id="alice", template_key_id="key")
    assert config.ready("enroll")
    assert not config.ready("authenticate")


@pytest.mark.parametrize("threshold,version", [("", ""), ("0.73", "validated-population")])
def test_population_pair_is_optional_but_complete(tmp_path, monkeypatch, threshold, version):
    monkeypatch.setenv("HC160_TEMPLATE_KEYS", "test-only")
    (tmp_path / "pad.onnx").touch()
    (tmp_path / "pad.json").touch()
    (tmp_path / "synthetic.tar").touch()
    (tmp_path / "detector.pth").touch()
    config = ModelCliConfig(repo_path=str(tmp_path), storage_root=str(tmp_path), user_id="alice",
                            device_id="fixed", template_key_id="key", threshold=threshold,
                            threshold_version=version, query_budget_db=str(tmp_path / "budget.sqlite"),
                            pad_model=str(tmp_path / "pad.onnx"), pad_registry=str(tmp_path / "pad.json"),
                            synthetic_model=str(tmp_path / "synthetic.tar"),
                            synthetic_detector_model=str(tmp_path / "detector.pth"),
                            **strict_reference_settings(tmp_path))
    assert config.ready()
    for value, label in [("", "version-only"), (".73", ""), ("nan", "invalid"), ("2", "invalid")]:
        assert not replace(config, threshold=value, threshold_version=label).ready()


def test_enrollment_args_use_enroll_parser_without_population_configuration(tmp_path):
    repo = os.getenv("HC160_TEST_REPO")
    if not repo:
        pytest.skip("HC160_TEST_REPO required")
    sys.path.insert(0, repo)
    config = ModelCliConfig(repo_path=repo, storage_root=str(tmp_path), user_id="alice", template_key_id="key")
    args = config.enrollment_args("alice", tmp_path / "template", tmp_path / "calibration")
    assert args.command == "enroll"
    assert args.output == str(tmp_path / "template")
    assert args.registration_calibration_output == str(tmp_path / "calibration")
    assert args.template_key_id == "key"
    assert not hasattr(args, "threshold")
    auth = config.args("alice", tmp_path / "template", tmp_path / "calibration", None)
    assert auth.threshold is auth.threshold_version is None


def test_synthetic_environment_is_explicit_and_defaults_to_cpu(monkeypatch):
    monkeypatch.setenv("HC160_SYNTHETIC_MODEL", "/models/FFc23.tar")
    monkeypatch.setenv("HC160_SYNTHETIC_DETECTOR_MODEL", "/models/retinaface.pth")
    monkeypatch.delenv("HC160_SYNTHETIC_DEVICE", raising=False)
    config = ModelCliConfig.from_env()
    assert config.synthetic_model == "/models/FFc23.tar"
    assert config.synthetic_detector_model == "/models/retinaface.pth"
    assert config.synthetic_device == "cpu"


def test_synthetic_auth_requires_complete_absolute_file_pair_and_cpu(tmp_path, monkeypatch):
    monkeypatch.setenv("HC160_TEMPLATE_KEYS", "test-only")
    for name in ("pad.onnx", "pad.json", "FFc23.tar", "retinaface.pth"):
        (tmp_path / name).touch()
    config = ModelCliConfig(
        repo_path=str(tmp_path), storage_root=str(tmp_path), user_id="alice", device_id="fixed",
        template_key_id="key", query_budget_db=str(tmp_path / "budget.sqlite"),
        pad_model=str(tmp_path / "pad.onnx"), pad_registry=str(tmp_path / "pad.json"),
        synthetic_model=str(tmp_path / "FFc23.tar"),
        synthetic_detector_model=str(tmp_path / "retinaface.pth"),
        **strict_reference_settings(tmp_path),
    )
    assert config.ready()
    for fields in (
        {"synthetic_model": ""}, {"synthetic_detector_model": ""},
        {"synthetic_model": "relative.tar"},
        {"synthetic_detector_model": str(tmp_path / "missing.pth")},
        {"synthetic_device": "cuda"},
    ):
        candidate = replace(config, **fields)
        assert not candidate.ready()
        assert candidate.ready("enroll")
    assert not replace(config, synthetic_model="", synthetic_detector_model="").ready()


def test_synthetic_args_only_enable_explicit_pair_and_leave_enrollment_unchanged(tmp_path):
    repo = os.getenv("HC160_TEST_REPO")
    if not repo:
        pytest.skip("HC160_TEST_REPO required")
    sys.path.insert(0, repo)
    config = ModelCliConfig(repo_path=repo, storage_root=str(tmp_path), user_id="alice",
                            template_key_id="key")
    disabled = config.args("alice", tmp_path / "template", tmp_path / "calibration", None)
    assert disabled.synthetic_model is disabled.synthetic_detector_model is None
    enabled = replace(config, synthetic_model=str(tmp_path / "FFc23.tar"),
                      synthetic_detector_model=str(tmp_path / "retinaface.pth"))
    args = enabled.args("alice", tmp_path / "template", tmp_path / "calibration", None)
    assert args.synthetic_model == enabled.synthetic_model
    assert args.synthetic_detector_model == enabled.synthetic_detector_model
    assert args.synthetic_device == "cpu"
    assert args.profile == "FULL"
    enrollment = enabled.enrollment_args("alice", tmp_path / "template", tmp_path / "calibration")
    assert not hasattr(enrollment, "synthetic_model")


def test_strict_reference_configuration_is_explicit_and_authentication_only(tmp_path, monkeypatch):
    monkeypatch.setenv("HC160_TEMPLATE_KEYS", "test-only")
    for field in ("pad.onnx", "pad.json", "synthetic.tar", "detector.pth"):
        (tmp_path / field).touch()
    config = ModelCliConfig(
        repo_path=str(tmp_path), storage_root=str(tmp_path), user_id="alice", device_id="fixed",
        template_key_id="key", query_budget_db=str(tmp_path / "budget.sqlite"),
        pad_model=str(tmp_path / "pad.onnx"), pad_registry=str(tmp_path / "pad.json"),
        synthetic_model=str(tmp_path / "synthetic.tar"),
        synthetic_detector_model=str(tmp_path / "detector.pth"),
        **strict_reference_settings(tmp_path),
    )
    assert config.ready()
    for field in ("reference_bundle", "reference_scores", "reference_contract", "reference_splits", "reference_protocol_id"):
        missing = replace(config, **{field: ""})
        assert not missing.ready()
        assert missing.ready("enroll")
    for field in ("reference_bundle", "reference_scores", "reference_contract", "reference_splits"):
        assert not replace(config, **{field: "relative"}).ready()
        assert not replace(config, **{field: str(tmp_path / "missing")}).ready()
    assert not replace(config, reference_protocol_id="  ").ready()
    assert not replace(config, l3_defense_score=False).ready()
    raw = replace(config, reference_distributions=str(tmp_path / "legacy-raw.json"))
    assert not raw.ready()
    assert any("raw references" in blocker for blocker in raw.blockers())
    assert raw.ready("enroll")


def test_strict_reference_environment_and_cli_flags(tmp_path, monkeypatch):
    repo = os.getenv("HC160_TEST_REPO")
    if not repo:
        pytest.skip("HC160_TEST_REPO required")
    sys.path.insert(0, repo)
    expected = strict_reference_settings(tmp_path)
    for field, value in expected.items():
        env = "HC160_L3_DEFENSE_SCORE" if field == "l3_defense_score" else "HC160_" + field.upper()
        monkeypatch.setenv(env, "1" if value is True else value)
    config = replace(ModelCliConfig.from_env(), repo_path=repo, storage_root=str(tmp_path))
    for field, value in expected.items():
        assert getattr(config, field) == value
    args = config.args("alice", tmp_path / "template", tmp_path / "calibration", None)
    assert args.decision_reference_bundle == expected["reference_bundle"]
    assert args.reference_scores == expected["reference_scores"]
    assert args.reference_contract == expected["reference_contract"]
    assert args.reference_splits == expected["reference_splits"]
    assert args.evaluation_protocol_id == expected["reference_protocol_id"]
    assert args.l3_defense_score is True
    assert args.decision_reference_distributions is None
    monkeypatch.delenv("HC160_L3_DEFENSE_SCORE")
    assert ModelCliConfig.from_env().l3_defense_score is False


def test_documented_collection_cli_matches_web_pipeline_configuration(tmp_path):
    """Parse the documented command only; never execute configure/capture/models."""
    import ast
    import inspect
    from types import SimpleNamespace

    repo = os.getenv("HC160_TEST_REPO")
    if not repo:
        pytest.skip("HC160_TEST_REPO required")
    sys.path.insert(0, repo)
    from src.face_auth import cli

    root = Path(__file__).resolve().parents[2]
    runbook = (root / "docs/ui/FINAL_WEB_CAPTURE_RUNBOOK.md").read_text()
    command_block = next(
        block for block in runbook.split("```sh") if "args=[sys.executable" in block
    ).split("```")[0]
    python_source = command_block.split("<<'PY'\n", 1)[1].rsplit("\nPY", 1)[0]
    assignment = next(node for node in ast.parse(python_source).body
                      if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                         and target.id == "args" for target in node.targets))
    # Evaluate only the argument-list expression with synthetic, public path values.
    # The document's subprocess.run and camera source are never executed.
    env = {
        "HC160_DEVICE_ID": "test-device",
        "VERIFACE_QUERY_BUDGET_DB": str(tmp_path / "budget.sqlite"),
        "HC160_PAD_MODEL": str(tmp_path / "pad.onnx"),
        "HC160_PAD_REGISTRY": str(Path(repo) / "configs/models/anti-spoof-mn3.json"),
        "HC160_SYNTHETIC_MODEL": str(tmp_path / "synthetic.tar"),
        "HC160_SYNTHETIC_DETECTOR_MODEL": str(tmp_path / "detector.pth"),
        "PROTOCOL_ID": "test-protocol", "COLLECTION_ID": "test-collection",
    }
    template, calibration = tmp_path / "template", tmp_path / "calibration"
    arguments = eval(compile(ast.Expression(assignment.value), "runbook-args", "eval"),
                     {"sys": SimpleNamespace(executable=sys.executable), "str": str,
                      "os": SimpleNamespace(environ=env)},
                     {"user": "alice", "template": template, "calibration": calibration,
                      "registry": SimpleNamespace(root=tmp_path),
                      "record": tmp_path / "attempt", "OUTPUT": tmp_path, "enrollment_name": "enrollment-record"})
    collected = cli.build_parser().parse_args(arguments[3:])
    config = ModelCliConfig(
        repo_path=repo, storage_root=str(tmp_path), device="cpu", device_id=env["HC160_DEVICE_ID"],
        query_budget_db=env["VERIFACE_QUERY_BUDGET_DB"], pad_model=env["HC160_PAD_MODEL"],
        pad_registry=env["HC160_PAD_REGISTRY"], synthetic_model=env["HC160_SYNTHETIC_MODEL"],
        synthetic_detector_model=env["HC160_SYNTHETIC_DETECTOR_MODEL"],
        synthetic_device="cpu", l3_defense_score=True, reference_protocol_id=env["PROTOCOL_ID"],
    )
    web = config.args("alice", template, calibration, "127.0.0.1")
    # Reuse the backend's enumerated configuration fields so newly versioned gate
    # or quality settings are compared, rather than silently omitted here.
    names = next(node.value for node in ast.walk(ast.parse(inspect.getsource(cli._authentication_config_sha256)))
                 if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name)
                    and target.id == "names" for target in node.targets))
    fields = [*ast.literal_eval(names), "pad_model", "synthetic_model", "synthetic_detector_model",
              "synthetic_device", "evaluation_protocol_id", "device_id", "source_ip"]
    for field in fields:
        actual, expected = getattr(web, field), getattr(collected, field)
        if field in {"graded_rule_table", "query_budget_config"}:
            expected = str((Path(repo) / expected).resolve())
        assert actual == expected, field
    assert web.adversarial_randomize is collected.adversarial_randomize is False
    assert web.l3_randomized_samples == collected.l3_randomized_samples == 0
