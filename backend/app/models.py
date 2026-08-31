from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    user = "user"
    admin = "admin"


class LoginRequest(BaseModel):
    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    access_token: str
    token_type: Literal["demo"] = "demo"
    role: UserRole
    display_name: str


class FaceAuthStartRequest(BaseModel):
    user_id: str
    purpose: str = "LOGIN"


class FaceAuthStartResponse(BaseModel):
    session_id: str
    challenge: str
    expires_in_sec: int
    remaining_attempts: int


class FaceAuthVerifyRequest(BaseModel):
    session_id: str
    scenario: Literal["normal", "attack", "quality_fail", "timeout"] = "normal"


class QueryBudget(BaseModel):
    used: int
    limit: int
    exceeded: bool


class GateProvenance(BaseModel):
    artifact_id: str
    artifact_version: str
    model_version: str
    policy_version: str


class GateResultDto(BaseModel):
    gate_id: str
    label: str | None = None
    status: Literal["PASS", "FAIL", "ERROR", "TIMEOUT", "NOT_EVALUATED", "SKIPPED", "UNAVAILABLE"]
    role: Literal["BLOCKING", "SCORING", "ESCALATION"]
    latency_ms: float | None
    score: str | float | None
    threshold: str | float | None
    provenance: GateProvenance
    reason_code: str | None


class SessionResultDto(BaseModel):
    schema_version: Literal["1.0"] = "1.0"
    session_id: str
    status: Literal["CREATED", "RUNNING", "COMPLETED", "ERROR", "EXPIRED"]
    final_decision: Literal["ACCEPT", "STEP_UP", "REJECT", "ERROR"]
    created_at: str
    completed_at: str | None
    latency_ms: float | None
    attempt_count: int
    query_budget: QueryBudget
    gates: list[GateResultDto]
    decision_provenance: dict[str, str]
    audit: dict[str, Any] | None = None


class FaceAuthVerifyResponse(BaseModel):
    session: SessionResultDto
    user_message: str
    next_action: Literal["continue", "step_up", "retry", "contact_support"]
    solutions: list[str] = []
    attack_detected: bool = False


class SessionSummaryDto(BaseModel):
    session_id: str
    created_at: str
    status: str
    final_decision: str
    latency_ms: float | None
    attempt_count: int
    step_up: bool
    has_error: bool
    failed_gate: str | None
    policy_version: str
    model_version: str
    artifact_version: str


class SystemStatusDto(BaseModel):
    component: str
    status: str
    last_ok_at: str
    error_count: int
    latency_p50_ms: float | None
    latency_p95_ms: float | None
