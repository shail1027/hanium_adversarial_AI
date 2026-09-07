from __future__ import annotations

from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess


@dataclass(frozen=True)
class ModelCliConfig:
    repo_path: str | None = None
    python_path: str = "python3"
    template_path: str | None = None
    threshold: float | None = None
    threshold_version: str | None = None
    video_path: str | None = None
    profile: str = "BASELINE_ONLY"
    template_audit_log: str = "template-audit.jsonl"
    frames: int = 20
    min_valid_frames: int = 5
    device: str | None = None

    @classmethod
    def from_env(cls) -> "ModelCliConfig":
        threshold = os.environ.get("HC160_THRESHOLD")
        return cls(
            repo_path=os.environ.get("HC160_REPO_PATH"),
            python_path=os.environ.get("HC160_PYTHON_PATH", "python3"),
            template_path=os.environ.get("HC160_TEMPLATE_PATH"),
            threshold=float(threshold) if threshold else None,
            threshold_version=os.environ.get("HC160_THRESHOLD_VERSION"),
            video_path=os.environ.get("HC160_DEMO_VIDEO_PATH"),
            profile=os.environ.get("HC160_PROFILE", "BASELINE_ONLY"),
            template_audit_log=os.environ.get("HC160_TEMPLATE_AUDIT_LOG", "template-audit.jsonl"),
            frames=int(os.environ.get("HC160_FRAMES", "20")),
            min_valid_frames=int(os.environ.get("HC160_MIN_VALID_FRAMES", "5")),
            device=os.environ.get("HC160_DEVICE"),
        )


class ModelCliAdapter:
    """Optional adapter for the HC160 model repository CLI.

    The demo server uses fixtures by default. When the model repository is available,
    this class is the boundary where CLI JSON can be converted into the public DTO.
    """

    def __init__(self, config: ModelCliConfig) -> None:
        self.config = config

    def available(self) -> bool:
        return bool(self.config.repo_path)

    def ready(self) -> bool:
        return all(
            [
                self.config.repo_path,
                self.config.template_path,
                self.config.threshold is not None,
                self.config.threshold_version,
                self.config.video_path,
            ]
        )

    def missing_requirements(self) -> list[str]:
        missing = []
        if not self.config.repo_path:
            missing.append("HC160_REPO_PATH")
        if not self.config.template_path:
            missing.append("HC160_TEMPLATE_PATH")
        if self.config.threshold is None:
            missing.append("HC160_THRESHOLD")
        if not self.config.threshold_version:
            missing.append("HC160_THRESHOLD_VERSION")
        if not self.config.video_path:
            missing.append("HC160_DEMO_VIDEO_PATH")
        return missing

    def run_demo_authenticate(self, *, user_id: str, decision_output: str | None = None) -> dict:
        if not self.ready():
            missing = ", ".join(self.missing_requirements())
            raise RuntimeError(f"HC160 CLI is not fully configured: {missing}")

        args = [
            "--template",
            str(self.config.template_path),
            "--threshold",
            str(self.config.threshold),
            "--threshold-version",
            str(self.config.threshold_version),
            "--user-id",
            user_id,
            "--video",
            str(self.config.video_path),
            "--no-preview",
            "--profile",
            self.config.profile,
            "--template-audit-log",
            self.config.template_audit_log,
            "--frames",
            str(self.config.frames),
            "--min-valid-frames",
            str(self.config.min_valid_frames),
        ]
        if self.config.device:
            args.extend(["--device", self.config.device])
        if decision_output:
            args.extend(["--decision-output", decision_output, "--overwrite-decision-output"])
        return self.run_authenticate(args)

    def run_authenticate(self, args: list[str]) -> dict:
        if not self.config.repo_path:
            raise RuntimeError("HC160 model repository path is not configured")
        repo_path = Path(self.config.repo_path)
        if not repo_path.exists():
            raise RuntimeError(f"HC160 model repository does not exist: {repo_path}")
        command = [self.config.python_path, "-m", "src.face_auth.cli", "authenticate", *args]
        completed = subprocess.run(
            command,
            cwd=repo_path,
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(completed.stdout)
