"""Local browser capture protocol; biometric evidence stays in bounded memory."""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor, TimeoutError as JobTimeout
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import io
import json
import math
import logging
import secrets
from threading import RLock, Semaphore
import time

from .hc160_runtime import HC160Runtime
from .registration_store import Registry
from .runtime_metadata import DISPLAY_LAYERS, artifact_version, gate_role, runtime_identity


logger = logging.getLogger(__name__)


class CaptureError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status
        super().__init__(code)


@dataclass
class Capture:
    session_id: str
    nonce: str
    owner: str
    user_id: str
    source_ip: str
    context_hash: str
    operation: str
    expires: float
    created_at: str
    state: str = "ISSUED"
    displayed_ms: float | None = None
    presented: float | None = None
    illumination: object = None
    duration_ms: float = 3000
    frames: list = field(default_factory=list, repr=False)
    last_timestamp: float = -1
    token_id: str | None = None
    token_deadline: float = 0
    runtime_identity: dict = field(default_factory=dict)


class CaptureService:
    def __init__(self, config, runtime=None, clock=time.monotonic):
        self.config = config
        self.runtime_identity = runtime_identity(config.repo_path)
        self.runtime = runtime or HC160Runtime(config)
        self.registry = Registry(config.storage_root) if config.storage_root else None
        self.clock = clock
        self.captures = {}
        self.lock = RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="hc160-inference")
        self.inference_slot = Semaphore(1)

    def _prune(self):
        now = self.clock()
        for key, capture in list(self.captures.items()):
            if now > max(capture.expires, capture.token_deadline) and capture.state != "EVALUATING":
                capture.frames.clear()
                del self.captures[key]

    def start(self, owner, source_ip, operation):
        with self.lock:
            self._prune()
            if not self.config.ready(operation):
                raise CaptureError("CONFIGURATION_REQUIRED", "인증 서버 설정을 확인하세요.", 503)
            if any(c.state in {"ISSUED", "CAPTURING", "EVALUATING"} for c in self.captures.values()):
                raise CaptureError("CAPTURE_BUSY", "진행 중인 촬영을 완료하거나 취소하세요.", 409)
            registered = self.registry.registered(self.config.user_id)
            if operation == "enroll" and registered:
                raise CaptureError("ALREADY_ENROLLED", "이미 등록되어 있습니다. 기존 등록은 덮어쓰지 않습니다.", 409)
            if operation == "authenticate" and not registered:
                raise CaptureError("ENROLLMENT_REQUIRED", "먼저 서버에 지정된 사용자의 얼굴을 등록하세요.", 409)
            context = hashlib.sha256(owner.encode()).hexdigest()
            # A timed-out native inference may still be running. Never block the
            # capture lock on its runtime lock, including on the next request.
            if not self.inference_slot.acquire(blocking=False):
                raise CaptureError("INFERENCE_BUSY", "인증 처리가 끝나지 않았습니다. 잠시 후 다시 시도하세요.", 503)
            try:
                session, challenge = self.runtime.create(self.config.user_id, "LOCAL_FACE_CHECK", context)
            finally:
                self.inference_slot.release()
            now = self.clock()
            capture = Capture(session.session_id, challenge.nonce, owner, self.config.user_id,
                              source_ip, context, operation, now + 30, _utc_now(),
                              runtime_identity=self.runtime_identity)
            self.captures[session.session_id] = capture
            instruction = ("얼굴을 중앙에 두고 고개를 천천히 왼쪽으로 돌려주세요."
                           if challenge.kind == "HEAD_LEFT" else "얼굴을 중앙에 두고 고개를 천천히 오른쪽으로 돌려주세요.")
            return {"session_id": session.session_id, "nonce": challenge.nonce,
                    "challenge": instruction if operation == "authenticate" else "얼굴을 중앙에 두고 등록할 얼굴을 촬영하세요.",
                    "expires_in_sec": 30}

    def _get(self, session_id, owner, nonce=None, states=None):
        capture = self.captures.get(session_id)
        if capture is None or not secrets.compare_digest(capture.owner, owner):
            raise CaptureError("UNKNOWN_SESSION", "존재하지 않는 촬영 세션입니다.", 404)
        if nonce is not None and not secrets.compare_digest(capture.nonce, nonce):
            raise CaptureError("NONCE_MISMATCH", "촬영 세션이 일치하지 않습니다.", 409)
        deadline = capture.token_deadline if capture.state == "COMPLETED" else capture.expires
        if self.clock() >= deadline:
            capture.frames.clear()
            capture.state = "EXPIRED"
            raise CaptureError("SESSION_EXPIRED", "촬영 세션이 만료되었습니다. 다시 시작하세요.", 410)
        if states and capture.state not in states:
            raise CaptureError("SESSION_ALREADY_USED", "이미 제출되었거나 사용할 수 없는 세션입니다.", 409)
        return capture

    def present(self, session_id, owner, nonce, displayed_at_ms):
        with self.lock:
            c = self._get(session_id, owner, nonce, {"ISSUED"})
            c.displayed_ms = displayed_at_ms
            c.presented = self.clock()
            steps = []
            if c.operation == "authenticate":
                c.illumination = self.runtime.illumination(c.nonce, c.presented)
                steps = [{"offset_ms": (s.display_at_monotonic - c.presented) * 1000,
                          "duration_ms": s.duration_s * 1000, "color": list(s.color)}
                         for s in c.illumination.steps]
                c.duration_ms = max(3000, max(s["offset_ms"] + s["duration_ms"] for s in steps) + 500)
            c.state = "CAPTURING"
            return {"illumination": steps, "capture_duration_ms": c.duration_ms, "max_frames": 80}

    def frame(self, session_id, owner, nonce, frame_id, timestamp_ms, image):
        with self.lock:
            c = self._get(session_id, owner, nonce, {"CAPTURING"})
            elapsed = (timestamp_ms - c.displayed_ms) / 1000
            received = self.clock() - c.presented
            if (frame_id != len(c.frames) or frame_id >= 80 or timestamp_ms <= c.last_timestamp
                    or not math.isfinite(elapsed) or elapsed < 0 or elapsed > c.duration_ms / 1000 + 1
                    or abs(received - elapsed) > 0.5):
                c.state = "ERROR"
                c.frames.clear()
                raise CaptureError("CAPTURE_TIMING_INVALID", "프레임 순서 또는 촬영 시간 연결이 올바르지 않습니다.")
            try:
                pixels = _decode_frame(image)
                # Client clocks are useful for sequence checks, never for reducing
                # measured liveness response latency. Server receipt is authoritative.
                c.frames.append(self.runtime.make_frame(frame_id, self.clock(), pixels, timestamp_ms))
                c.last_timestamp = timestamp_ms
            except Exception as exc:
                c.state = "ERROR"
                c.frames.clear()
                raise CaptureError("FRAME_INVALID", "카메라 프레임을 읽을 수 없습니다.") from exc
            return {"accepted": True}

    def finish(self, session_id, owner, nonce):
        with self.lock:
            c = self._get(session_id, owner, nonce, {"CAPTURING"})
            if (len(c.frames) < 10 or c.last_timestamp - c.displayed_ms < c.duration_ms - 300
                    or self.clock() - c.presented < (c.duration_ms - 300) / 1000):
                c.state = "ERROR"
                c.frames.clear()
                raise CaptureError("CAPTURE_INCOMPLETE", "챌린지 전체 촬영 증거가 부족합니다.")
            if not self.inference_slot.acquire(blocking=False):
                raise CaptureError("INFERENCE_BUSY", "인증 처리 중입니다. 잠시 후 다시 시도하세요.", 503)
            c.state = "EVALUATING"
            frames = tuple(c.frames)
            c.frames.clear()
        try:
            if c.operation == "enroll":
                pair = self.registry.allocate(c.user_id)
                job = self.executor.submit(self.runtime.enroll, c.user_id, frames, *pair)
            else:
                pair = self.registry.resolve(c.user_id)
                # The first received frame is bound only after presentation ACK;
                # no client-supplied frame marker or prerecorded-video path exists.
                job = self.executor.submit(self.runtime.evaluate, c.session_id, c.user_id, c.source_ip,
                                           frames, frames[0].frame_id, c.illumination, *pair)
        except Exception as exc:
            logger.warning("capture setup failed session=%s kind=%s", c.session_id, type(exc).__name__)
            self.inference_slot.release()
            c.state = "ERROR"
            return _error_result(c, "ARTIFACT_UNAVAILABLE")
        job.add_done_callback(lambda _: self.inference_slot.release())
        try:
            result = job.result(timeout=self.config.timeout_seconds)
            with self.lock:
                if c.state != "EVALUATING":
                    return _error_result(c, "CAPTURE_CANCELLED")
                if c.operation == "enroll":
                    if result.get("status") != "ENROLLED":
                        raise ValueError("Enrollment did not complete")
                    self.registry.publish(c.user_id, *pair)
                    c.state = "ENROLLED"
                    logger.info("face_attempt %s", json.dumps({
                        "operation": "enroll", "session_id": c.session_id, "status": "ENROLLED",
                        **{key: result.get(key) for key in ("captured_frames", "valid_frames",
                           "excluded_frames", "exclusion_reasons", "registration_calibration_id")},
                    }, sort_keys=True))
                    return {"status": "ENROLLED", "registered": True,
                            **{key: result.get(key) for key in ("captured_frames", "valid_frames",
                               "excluded_frames", "exclusion_reasons", "registration_calibration_id")},
                            "user_message": "서버에 지정된 로컬 사용자의 얼굴과 보정 파일을 등록했습니다."}
                response = _auth_result(c, result)
                c.state = "COMPLETED"
                c.token_id = response["token_id"]
                c.token_deadline = self.clock() + 60
                return response
        except JobTimeout:
            job.cancel()
            c.state = "ERROR"
            return _error_result(c, "INFERENCE_TIMEOUT")
        except Exception as exc:
            logger.warning("capture processing failed session=%s operation=%s kind=%s", c.session_id, c.operation, type(exc).__name__)
            c.state = "ERROR"
            return _error_result(c, "ENROLLMENT_FAILED" if c.operation == "enroll" else "AUTHENTICATION_FAILED")

    def consume(self, session_id, owner, token_id):
        with self.lock:
            c = self._get(session_id, owner, states={"COMPLETED"})
            if not c.token_id or not secrets.compare_digest(c.token_id, token_id):
                raise CaptureError("TOKEN_INVALID", "승인 토큰이 없거나 일치하지 않습니다.", 409)
            self.runtime.consume(token_id, c.user_id, "LOCAL_FACE_CHECK", c.context_hash)
            c.state = "CONSUMED"
            c.token_id = None
            logger.info("face_attempt %s", json.dumps({
                "operation": "authenticate", "session_id": c.session_id, "status": "CONSUMED",
            }, sort_keys=True))
            return {"consumed": True, "account_authenticated": False}

    def cancel(self, session_id, owner, nonce):
        with self.lock:
            c = self._get(session_id, owner, nonce)
            c.state = "CANCELLED"
            c.frames.clear()
            c.token_id = None
            return {"cancelled": True}

    def close(self):
        for c in self.captures.values():
            c.frames.clear()
        self.executor.shutdown(wait=False, cancel_futures=True)


def _decode_frame(image):
    import numpy as np
    from PIL import Image
    raw = base64.b64decode(image, validate=True)
    if len(raw) > 150_000:
        raise ValueError("Frame too large")
    with Image.open(io.BytesIO(raw)) as picture:
        if picture.format != "JPEG" or not (160 <= picture.width <= 640 and 120 <= picture.height <= 480):
            raise ValueError("Invalid frame dimensions or encoding")
        return np.array(picture.convert("RGB"))[:, :, ::-1].copy()


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _auth_result(c, result):
    decision = result.get("decision")
    token = result.get("token_id")
    if decision not in {"ACCEPT", "STEP_UP", "REJECT"} or (decision == "ACCEPT" and not token):
        return _error_result(c, "INVALID_AUTHENTICATION_RESULT")
    if decision != "ACCEPT" and token:
        return _error_result(c, "UNEXPECTED_TOKEN")
    messages = {"ACCEPT": "얼굴 판정 ACCEPT입니다. 일회용 토큰 소비 후 결과를 확정합니다.",
                "STEP_UP": "추가 인증이 필요합니다. 연결된 추가 인증 수단이 없어 승인되지 않았습니다.",
                "REJECT": "얼굴 인증이 거부되었습니다."}
    gates = [{"gate_id": g["gate"], "label": g["gate"],
              "status": g["status"], "role": gate_role(g),
              "display_layer": DISPLAY_LAYERS.get(g["gate"]),
              "latency_ms": g.get("latency_ms"), "score": g.get("score"), "threshold": g.get("threshold"),
              "reason_code": ",".join(g.get("reason_codes", [])) or None,
              "provenance": {"artifact_id": "hc160-runtime", "artifact_version": artifact_version(getattr(c, "runtime_identity", {})),
                             "model_version": "runtime", "policy_version": "face-auth-policy-v1"}}
             for g in result.get("gates", [])]
    logger.info("face_attempt %s", json.dumps({
        "operation": c.operation, "session_id": c.session_id, "decision": decision,
        "status": "COMPLETED", "gates": gates,
        **{key: result.get(key) for key in ("total_frames", "valid_face_frames", "calibration",
                                           "attempt_id", "evidence_digest", "query_budget_summary")},
    }, sort_keys=True))
    return {"session": {"schema_version": "1.0", "session_id": c.session_id,
            "status": "COMPLETED", "final_decision": decision, "created_at": c.created_at,
            "completed_at": _utc_now(), "latency_ms": None, "attempt_count": 1,
            "query_budget": {key: result.get("query_budget_summary", {}).get(key)
                             for key in ("used", "limit", "exceeded")},
            "gates": gates, "decision_provenance": {
                "source": "hc160_runtime", "security_profile": "FULL",
                "runtime_identity": getattr(c, "runtime_identity", {}),
                "calibration_artifact_id": result.get("calibration", {}).get("artifact_id"),
            },
            "audit": {"model_source": "hc160_runtime", "evidence_digest": result.get("evidence_digest"),
                      "total_frames": result.get("total_frames"),
                      "valid_face_frames": result.get("valid_face_frames"),
                      "calibration": result.get("calibration")}},
            "authorized": False, "account_authenticated": False, "token_id": token,
            "user_message": messages[decision],
            "next_action": "continue" if decision == "ACCEPT" else "step_up" if decision == "STEP_UP" else "retry",
            "solutions": [] if decision == "ACCEPT" else ["촬영 환경을 확인한 뒤 다시 시도하거나 담당자에게 문의하세요."],
            "attack_detected": False}


def _error_result(c, code):
    logger.info("face_attempt %s", json.dumps({
        "operation": c.operation, "session_id": c.session_id, "decision": "ERROR",
        "status": "ERROR", "error_code": code,
    }, sort_keys=True))
    return {"session": {"schema_version": "1.0", "session_id": c.session_id, "status": "ERROR",
            "final_decision": "ERROR", "created_at": c.created_at, "completed_at": _utc_now(),
            "latency_ms": None, "attempt_count": 1, "query_budget": {"used": None, "limit": None, "exceeded": None},
            "gates": [], "decision_provenance": {"source": "hc160_runtime", "security_profile": "FULL",
                                                    "runtime_identity": getattr(c, "runtime_identity", {})},
            "audit": {"error_code": code}}, "authorized": False, "account_authenticated": False,
            "token_id": None, "user_message": (
                "처리 시간이 초과되었습니다. 승인되지 않았습니다. 처리가 멈추면 서버를 재시작하세요."
                if code == "INFERENCE_TIMEOUT" else
                "얼굴 등록에 실패했습니다. 등록 파일 연결을 생성하지 않았습니다."
                if code == "ENROLLMENT_FAILED" else
                "등록 또는 인증 처리에 실패했습니다. 승인되지 않았습니다."),
            "next_action": "retry", "attack_detected": False,
            "solutions": ["설정·모델·등록 파일·DB 상태를 확인한 후 다시 시도하세요."]}
