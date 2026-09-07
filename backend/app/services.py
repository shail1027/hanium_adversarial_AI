from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from uuid import uuid4

from .fixtures import FRONTEND_PUBLIC, load_json, session_fixture_for_scenario
from .model_adapter import ModelCliAdapter
from .models import (
    FaceAuthStartResponse,
    FaceAuthVerifyResponse,
    GateResultDto,
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
    def __init__(self, model_adapter: ModelCliAdapter | None = None) -> None:
        self.sessions: dict[str, DemoSession] = {}
        self.model_adapter = model_adapter

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

        if scenario == "normal" and self.model_adapter and self.model_adapter.ready():
            try:
                cli_payload = self.model_adapter.run_demo_authenticate(user_id=session.user_id)
                return self._response_from_cli(session_id, cli_payload)
            except (RuntimeError, subprocess.CalledProcessError, ValueError) as error:
                result = SessionResultDto.model_validate(session_fixture_for_scenario(session_id, scenario))
                result.audit = {
                    **(result.audit or {}),
                    "model_source": "fixture_fallback",
                    "fallback_reason": str(error),
                }
                return FaceAuthVerifyResponse(
                    session=result,
                    user_message="모델 CLI 실행에 실패해 시연용 결과로 인증을 완료했습니다.",
                    next_action="continue",
                    solutions=["HC160 CLI 설정과 모델 아티팩트 경로를 확인하세요."],
                )

        result = SessionResultDto.model_validate(session_fixture_for_scenario(session_id, scenario))
        if self.model_adapter:
            result.audit = {
                **(result.audit or {}),
                "model_source": "fixture",
                "missing_cli_requirements": self.model_adapter.missing_requirements(),
            }

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

    def _response_from_cli(self, requested_session_id: str, payload: dict) -> FaceAuthVerifyResponse:
        final_decision = self._map_cli_decision(payload.get("decision"))
        result = SessionResultDto(
            session_id=requested_session_id,
            status="COMPLETED" if final_decision != "ERROR" else "ERROR",
            final_decision=final_decision,
            created_at=_utc_now(),
            completed_at=_utc_now(),
            latency_ms=_sum_gate_latency(payload.get("gates", [])),
            attempt_count=1,
            query_budget={"used": 1, "limit": 3, "exceeded": False},
            gates=[
                _gate_from_cli(index, gate)
                for index, gate in enumerate(payload.get("gates", []), start=1)
            ],
            decision_provenance={
                "source": "hc160_cli",
                "policy_version": str(payload.get("policy_version") or "face-auth-policy-v1"),
                "security_profile": str(payload.get("security_profile") or "BASELINE_ONLY"),
            },
            audit={
                "model_source": "hc160_cli",
                "cli_session_id": payload.get("session_id"),
                "attempt_id": payload.get("attempt_id"),
                "evidence_digest": payload.get("evidence_digest"),
                "warning": payload.get("warning"),
                "reason_codes": payload.get("reason_codes", []),
            },
        )

        if final_decision == "ACCEPT":
            return FaceAuthVerifyResponse(
                session=result,
                user_message="HC160 모델 CLI 판정으로 얼굴 인증이 완료되었습니다.",
                next_action="continue",
            )
        if final_decision == "STEP_UP":
            return FaceAuthVerifyResponse(
                session=result,
                user_message="HC160 모델 CLI가 추가 인증이 필요한 위험 신호를 반환했습니다.",
                next_action="step_up",
                attack_detected=True,
                solutions=["OTP 추가 인증을 진행하세요.", "운영자 대시보드에서 gate와 reason code를 확인하세요."],
            )
        if final_decision == "ERROR":
            return FaceAuthVerifyResponse(
                session=result,
                user_message="HC160 모델 CLI 인증 처리 중 오류가 발생했습니다.",
                next_action="retry",
                solutions=["CLI stderr와 모델 설정값을 확인하세요."],
            )
        return FaceAuthVerifyResponse(
            session=result,
            user_message="HC160 모델 CLI가 인증 거부 판정을 반환했습니다.",
            next_action="retry",
            solutions=["촬영 환경과 등록 템플릿 상태를 확인하세요."],
        )

    @staticmethod
    def _map_cli_decision(decision: object) -> str:
        if decision == "VERIFIED":
            return "ACCEPT"
        if decision == "SECURITY_DENIED":
            return "STEP_UP"
        if decision == "ERROR":
            return "ERROR"
        return "REJECT"


def _gate_from_cli(index: int, gate: dict) -> GateResultDto:
    status = gate.get("status")
    if status == "SCORED":
        status = "PASS"
    return GateResultDto(
        gate_id=str(gate.get("gate") or f"L{index}"),
        label=str(gate.get("gate") or f"Gate {index}"),
        status=status if status in {"PASS", "FAIL", "ERROR", "TIMEOUT", "NOT_EVALUATED", "SKIPPED", "UNAVAILABLE"} else "ERROR",
        role="BLOCKING",
        latency_ms=gate.get("latency_ms"),
        score=gate.get("score"),
        threshold=gate.get("threshold"),
        provenance={
            "artifact_id": "hc160-cli",
            "artifact_version": "runtime",
            "model_version": str(gate.get("model_version") or "unknown"),
            "policy_version": "face-auth-policy-v1",
        },
        reason_code=",".join(gate.get("reason_codes") or []) or None,
    )


def _sum_gate_latency(gates: list[dict]) -> float | None:
    latencies = [gate.get("latency_ms") for gate in gates if isinstance(gate.get("latency_ms"), (int, float))]
    return round(sum(latencies), 2) if latencies else None


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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
