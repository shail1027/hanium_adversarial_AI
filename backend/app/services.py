from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from .fixtures import load_json, session_fixture_for_scenario
from .models import (
    FaceAuthStartResponse,
    FaceAuthVerifyResponse,
    LoginResponse,
    SessionResultDto,
    UserRole,
)


@dataclass
class DemoSession:
    session_id: str
    user_id: str
    remaining_attempts: int = 3


class DemoAuthService:
    def login(self, username: str, password: str) -> LoginResponse:
        role = UserRole.admin if username.lower().startswith("admin") else UserRole.user
        label = "관리자" if role is UserRole.admin else "일반 사용자"
        return LoginResponse(
            access_token=f"demo-{role.value}-{uuid4().hex[:12]}",
            role=role,
            display_name=f"{label} {username}",
        )


class DemoFaceAuthService:
    def __init__(self) -> None:
        self.sessions: dict[str, DemoSession] = {}

    def start(self, user_id: str, purpose: str) -> FaceAuthStartResponse:
        session_id = f"sess_{uuid4().hex[:8]}****"
        self.sessions[session_id] = DemoSession(session_id=session_id, user_id=user_id)
        return FaceAuthStartResponse(
            session_id=session_id,
            challenge="화면의 안내에 맞춰 얼굴을 중앙에 두고 고개를 천천히 돌려주세요.",
            expires_in_sec=90,
            remaining_attempts=3,
        )

    def verify(self, session_id: str, scenario: str) -> FaceAuthVerifyResponse:
        session = self.sessions.setdefault(session_id, DemoSession(session_id=session_id, user_id="demo-user"))
        session.remaining_attempts = max(session.remaining_attempts - 1, 0)
        result = SessionResultDto.model_validate(session_fixture_for_scenario(session_id, scenario))

        if result.final_decision == "ACCEPT":
            return FaceAuthVerifyResponse(
                session=result,
                user_message="얼굴 인증이 정상적으로 완료되었습니다.",
                next_action="continue",
            )

        if result.final_decision == "STEP_UP":
            return FaceAuthVerifyResponse(
                session=result,
                user_message="공격 또는 비정상 인증 시도가 탐지되어 추가 인증이 필요합니다.",
                next_action="step_up",
                attack_detected=True,
                solutions=["OTP 추가 인증을 진행하세요.", "카메라를 다시 정렬하고 재시도하세요.", "반복 탐지 시 고객센터로 연결하세요."],
            )

        if result.final_decision == "ERROR":
            return FaceAuthVerifyResponse(
                session=result,
                user_message="인증 처리 중 일시적 오류가 발생했습니다.",
                next_action="retry",
                solutions=["네트워크 상태를 확인하세요.", "잠시 후 다시 시도하세요."],
            )

        return FaceAuthVerifyResponse(
            session=result,
            user_message="얼굴이 명확하지 않아 인증이 거부되었습니다.",
            next_action="retry",
            solutions=["밝은 곳에서 다시 촬영하세요.", "마스크나 가림 요소를 제거하세요."],
        )


class DashboardService:
    def hc160_result(self):
        return load_json("hc160/session-result.json")

    def hc160_summaries(self):
        return load_json("hc160/session-summaries.json")

    def system_status(self):
        return load_json("hc160/system-status.json")
