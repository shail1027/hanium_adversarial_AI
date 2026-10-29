from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat


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
    authenticated: Literal[False] = False


class FaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")


class FaceAuthStartRequest(FaceRequest):
    operation: Literal["enroll", "authenticate"]


class FaceAuthVerifyRequest(FaceRequest):
    session_id: str = Field(min_length=1, max_length=128)
    nonce: str = Field(min_length=1, max_length=128)


class FacePresentRequest(FaceAuthVerifyRequest):
    displayed_at_ms: FiniteFloat = Field(ge=0)


class FaceFrameRequest(FaceAuthVerifyRequest):
    frame_id: int = Field(ge=0, lt=80, strict=True)
    timestamp_ms: FiniteFloat = Field(ge=0)
    image: str = Field(min_length=1, max_length=200_000)


class FaceConsumeRequest(FaceRequest):
    session_id: str = Field(min_length=1, max_length=128)
    token_id: str = Field(min_length=1, max_length=128)


class QueryBudget(BaseModel):
    used: int | None
    limit: int | None
    exceeded: bool | None


class GateProvenance(BaseModel):
    artifact_id: str
    artifact_version: str
    model_version: str
    policy_version: str


class GateResultDto(BaseModel):
    gate_id: str
    label: str | None = None
    status: Literal["SCORED", "PASS", "FAIL", "ERROR", "TIMEOUT", "NOT_EVALUATED", "SKIPPED", "UNAVAILABLE"]
    role: Literal["BLOCKING", "SCORING", "ESCALATION"]
    display_layer: Literal["L0", "L1", "L2", "L2b", "L3", "L4"] | None = None
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
    decision_provenance: dict[str, Any]
    audit: dict[str, Any] | None = None


class FaceAuthVerifyResponse(BaseModel):
    session: SessionResultDto
    user_message: str
    next_action: Literal["continue", "step_up", "retry", "contact_support"]
    solutions: list[str] = []
    attack_detected: bool = False
    authorized: bool = False
    account_authenticated: Literal[False] = False
    token_id: str | None = None


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
