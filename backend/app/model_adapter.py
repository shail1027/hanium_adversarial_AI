from __future__ import annotations

from dataclasses import dataclass
import json
import subprocess


@dataclass(frozen=True)
class ModelCliConfig:
    repo_path: str | None = None
    python_path: str = "python3"


class ModelCliAdapter:
    """Optional adapter for the HC160 model repository CLI.

    The demo server uses fixtures by default. When the model repository is available,
    this class is the boundary where CLI JSON can be converted into the public DTO.
    """

    def __init__(self, config: ModelCliConfig) -> None:
        self.config = config

    def available(self) -> bool:
        return bool(self.config.repo_path)

    def run_authenticate(self, args: list[str]) -> dict:
        if not self.config.repo_path:
            raise RuntimeError("HC160 model repository path is not configured")
        command = [self.config.python_path, "-m", "src.face_auth.cli", "authenticate", *args]
        completed = subprocess.run(
            command,
            cwd=self.config.repo_path,
            check=True,
            capture_output=True,
            text=True,
        )
        return json.loads(completed.stdout)
