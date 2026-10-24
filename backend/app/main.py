from __future__ import annotations

from contextlib import asynccontextmanager
import fcntl
import ipaddress
import logging
from pathlib import Path
import secrets
from threading import RLock
import time

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import FileResponse, JSONResponse

from .capture_service import CaptureError, CaptureService
from .model_adapter import ModelCliConfig
from .models import (FaceAuthStartRequest, FaceAuthVerifyRequest, FaceConsumeRequest,
                     FaceFrameRequest, FacePresentRequest, LoginRequest)
from .services import DashboardService, DemoAuthService


ORIGINS = [f"http://{host}:{port}" for host in ("localhost", "127.0.0.1")
           for port in (5173, 5174, 5175, 8001)]
COOKIE = "veriface_local_capture"
logger = logging.getLogger(__name__)


def create_app(config=None, runtime=None, clock=time.monotonic):
    config = config or ModelCliConfig.from_env()
    service = CaptureService(config, runtime, clock)
    contexts = {}
    context_lock = RLock()
    worker_lock = None

    @asynccontextmanager
    async def lifespan(app):
        yield
        service.close()
        if worker_lock is not None:
            worker_lock.close()

    app = FastAPI(title="Veriface Local Face API", version="0.3.0", lifespan=lifespan)
    app.state.capture_service = service
    app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_credentials=True,
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type", "X-CSRF-Token"])
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1", "[::1]"])
    auth_service = DemoAuthService()
    dashboard_service = DashboardService()

    @app.middleware("http")
    async def local_capture_boundary(request, call_next):
        if request.url.path.startswith("/api/face/"):
            try:
                local = request.client is not None and ipaddress.ip_address(request.client.host).is_loopback
            except ValueError:
                local = False
            if not local or (request.headers.get("origin") and request.headers["origin"] not in ORIGINS):
                return JSONResponse({"detail": {"code": "LOCAL_ONLY", "message": "로컬 브라우저에서만 사용할 수 있습니다."}}, 403)
            if request.method == "POST":
                chunks = []
                size = 0
                async for chunk in request.stream():
                    size += len(chunk)
                    if size > 220_000:
                        return JSONResponse({"detail": {"code": "BODY_TOO_LARGE", "message": "프레임 크기 제한을 초과했습니다."}}, 413)
                    chunks.append(chunk)
                request._body = b"".join(chunks)
        response = await call_next(request)
        if request.url.path.startswith("/api/face/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(CaptureError)
    async def capture_error(request, error):
        return JSONResponse({"detail": {"code": error.code, "message": error.message}}, error.status)

    def owner(request):
        token = request.cookies.get(COOKIE, "")
        with context_lock:
            context = contexts.get(token)
            if (not context or clock() >= context["expires"]
                    or context["ip"] != request.client.host
                    or not secrets.compare_digest(context["csrf"], request.headers.get("x-csrf-token", ""))):
                raise CaptureError("CONTEXT_REQUIRED", "화면을 새로 열어 촬영 세션을 시작하세요.", 403)
        return token

    def call(function, *args):
        try:
            return function(*args)
        except CaptureError:
            raise
        except Exception as exc:
            logger.warning("face API operation=%s failed kind=%s", function.__name__, type(exc).__name__)
            raise CaptureError("RUNTIME_UNAVAILABLE", "설정·모델·등록 파일·DB 상태를 확인하세요. 승인되지 않았습니다.", 503) from exc

    def claim_worker():
        nonlocal worker_lock
        with context_lock:
            if worker_lock is None:
                handle = (Path(config.storage_root) / ".server.lock").open("a")
                try:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    handle.close()
                    raise CaptureError("SINGLE_WORKER_REQUIRED", "동일 저장소에는 인증 서버 하나만 실행할 수 있습니다.", 503)
                worker_lock = handle

    @app.get("/api/health")
    def health():
        return {"status": "ok", "service": "veriface-local-face-api",
                "hc160_runtime_ready": config.ready(), "hc160_runtime_missing": config.blockers(),
                "account_authentication": "not_connected", "session_storage": "single_process"}

    @app.post("/api/auth/login")
    def login(payload: LoginRequest):
        return auth_service.login(payload.username, payload.password)

    @app.get("/api/face/context")
    def face_context(request: Request, response: Response):
        with context_lock:
            now = clock()
            for key in list(contexts):
                if contexts[key]["expires"] <= now:
                    del contexts[key]
            token = request.cookies.get(COOKIE, "")
            if token not in contexts:
                if len(contexts) >= 32:
                    raise CaptureError("CONTEXT_LIMIT", "열린 촬영 화면이 너무 많습니다. 잠시 후 다시 시도하세요.", 429)
                token = secrets.token_urlsafe(32)
                contexts[token] = {"csrf": secrets.token_urlsafe(32), "expires": now + 1800,
                                   "ip": request.client.host}
            response.set_cookie(COOKIE, token, httponly=True, samesite="strict", max_age=1800, path="/api/face")
            blockers = []
            registered = False
            if service.registry is not None:
                try:
                    registered = service.registry.registered(config.user_id)
                except (OSError, ValueError):
                    blockers = [*blockers, "등록 파일 무결성 확인 필요"]
            blockers = [*config.blockers("authenticate" if registered else "enroll"), *blockers]
            return {"mode": "local", "user_label": config.user_id or "서버 사용자 미설정",
                    "registered": registered, "ready": not blockers, "blockers": blockers,
                    "csrf_token": contexts[token]["csrf"], "account_authenticated": False}

    @app.post("/api/face/start")
    def start(payload: FaceAuthStartRequest, request: Request):
        identity = owner(request)
        if config.ready(payload.operation):
            call(claim_worker)
        return call(service.start, identity, request.client.host, payload.operation)

    @app.post("/api/face/present")
    def present(payload: FacePresentRequest, request: Request):
        return call(service.present, payload.session_id, owner(request), payload.nonce, payload.displayed_at_ms)

    @app.post("/api/face/frame")
    def frame(payload: FaceFrameRequest, request: Request):
        return call(service.frame, payload.session_id, owner(request), payload.nonce,
                    payload.frame_id, payload.timestamp_ms, payload.image)

    @app.post("/api/face/verify")
    def verify(payload: FaceAuthVerifyRequest, request: Request):
        return call(service.finish, payload.session_id, owner(request), payload.nonce)

    @app.post("/api/face/consume")
    def consume(payload: FaceConsumeRequest, request: Request):
        return call(service.consume, payload.session_id, owner(request), payload.token_id)

    @app.post("/api/face/cancel")
    def cancel(payload: FaceAuthVerifyRequest, request: Request):
        return call(service.cancel, payload.session_id, owner(request), payload.nonce)

    @app.get("/api/dashboard/hc160/session-result")
    def session_result():
        return dashboard_service.hc160_result()

    @app.get("/api/dashboard/hc160/session-summaries")
    def session_summaries():
        return dashboard_service.hc160_summaries()

    @app.get("/api/dashboard/hc160/system-status")
    def system_status():
        return dashboard_service.system_status()

    @app.get("/api/dashboard/static/{dataset}/{file_name}")
    def static_file(dataset: str, file_name: str):
        try:
            return FileResponse(dashboard_service.static_file(dataset, file_name))
        except FileNotFoundError as exc:
            raise HTTPException(404, detail="dashboard file not found") from exc

    return app


app = create_app()
