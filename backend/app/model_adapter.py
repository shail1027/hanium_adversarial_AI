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
    demo_user_id: str | None = None
    template_path: str | None = None
    threshold: float | None = None
    threshold_version: str | None = None
    video_path: str | None = None
    profile: str = "BASELINE_ONLY"
    template_audit_log: str = "template-audit.jsonl"
    frames: int = 20
    min_valid_frames: int = 5
    min_blur_variance: float = 40.0
    min_brightness: float = 35.0
    max_brightness: float = 220.0
    device: str | None = None
    torch_home: str | None = None

    @classmethod
    def from_env(cls) -> "ModelCliConfig":
        handoff_dir = os.environ.get("HC160_HANDOFF_DIR")
        threshold = os.environ.get("HC160_THRESHOLD")
        return cls(
            repo_path=os.environ.get("HC160_REPO_PATH"),
            python_path=os.environ.get("HC160_PYTHON_PATH", "python3"),
            demo_user_id=os.environ.get("HC160_DEMO_USER_ID"),
            template_path=os.environ.get("HC160_TEMPLATE_PATH")
            or _handoff_path(handoff_dir, "api-demo-user.enc.json"),
            threshold=float(threshold) if threshold else (0.60 if handoff_dir else None),
            threshold_version=os.environ.get("HC160_THRESHOLD_VERSION")
            or ("demo-smoke-v1" if handoff_dir else None),
            video_path=os.environ.get("HC160_DEMO_VIDEO_PATH")
            or _handoff_path(handoff_dir, "api-demo-genuine.mp4"),
            profile=os.environ.get("HC160_PROFILE", "BASELINE_ONLY"),
            template_audit_log=os.environ.get("HC160_TEMPLATE_AUDIT_LOG")
            or _handoff_path(handoff_dir, "api-demo-audit.jsonl")
            or "template-audit.jsonl",
            frames=int(os.environ.get("HC160_FRAMES", "20")),
            min_valid_frames=int(os.environ.get("HC160_MIN_VALID_FRAMES", "5")),
            min_blur_variance=float(os.environ.get("HC160_MIN_BLUR_VARIANCE", "40")),
            min_brightness=float(os.environ.get("HC160_MIN_BRIGHTNESS", "35")),
            max_brightness=float(os.environ.get("HC160_MAX_BRIGHTNESS", "220")),
            device=os.environ.get("HC160_DEVICE"),
            torch_home=os.environ.get("HC160_TORCH_HOME") or os.environ.get("TORCH_HOME"),
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
            self.config.demo_user_id or user_id,
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
            "--min-blur-variance",
            str(self.config.min_blur_variance),
            "--min-brightness",
            str(self.config.min_brightness),
            "--max-brightness",
            str(self.config.max_brightness),
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
        env = os.environ.copy()
        if self.config.torch_home:
            env["TORCH_HOME"] = self.config.torch_home
        completed = subprocess.run(
            command,
            cwd=repo_path,
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        return json.loads(completed.stdout)


def _handoff_path(handoff_dir: str | None, file_name: str) -> str | None:
    if not handoff_dir:
        return None
    return str(Path(handoff_dir) / file_name)
