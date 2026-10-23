from __future__ import annotations

from pathlib import Path
from uuid import uuid4
from .fixtures import FRONTEND_PUBLIC, load_json
from .models import LoginResponse, UserRole


class DemoAuthService:
    """Display-only login. Its role/token never authorize biometric operations."""
    def login(self, username: str, password: str) -> LoginResponse:
        role = UserRole.admin if username.lower().startswith("admin") else UserRole.user
        return LoginResponse(access_token=f"demo-{uuid4().hex}", role=role,
                             display_name=f"시연 사용자 {username}")


class DashboardService:
    allowed_static_roots = {"forensics", "defense", "hc160"}

    def static_file(self, dataset: str, file_name: str) -> Path:
        if dataset not in self.allowed_static_roots or "/" in file_name or ".." in file_name:
            raise FileNotFoundError("Unsupported dashboard file")
        path = FRONTEND_PUBLIC / dataset / file_name
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(file_name)
        return path

    def hc160_result(self):
        return load_json("hc160/session-result.json")

    def hc160_summaries(self):
        return load_json("hc160/session-summaries.json")

    def system_status(self):
        return load_json("hc160/system-status.json")
