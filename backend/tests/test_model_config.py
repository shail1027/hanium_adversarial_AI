"""The web adapter must always construct the same fixed FULL contract."""
import os
from pathlib import Path
import sys
from dataclasses import replace

import pytest

from backend.app.model_adapter import ModelCliConfig


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
