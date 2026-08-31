from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .models import FaceAuthStartRequest, FaceAuthVerifyRequest, LoginRequest
from .services import DashboardService, DemoAuthService, DemoFaceAuthService


app = FastAPI(title="Hanium Adversarial AI Demo API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://127.0.0.1:5174", "http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

auth_service = DemoAuthService()
face_auth_service = DemoFaceAuthService()
dashboard_service = DashboardService()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "faceauth-demo-api"}


@app.post("/api/auth/login")
def login(payload: LoginRequest):
    return auth_service.login(payload.username, payload.password)


@app.post("/api/face/start")
def start_face_auth(payload: FaceAuthStartRequest):
    return face_auth_service.start(payload.user_id, payload.purpose)


@app.post("/api/face/verify")
def verify_face_auth(payload: FaceAuthVerifyRequest):
    return face_auth_service.verify(payload.session_id, payload.scenario)


@app.get("/api/dashboard/hc160/session-result")
def hc160_session_result():
    return dashboard_service.hc160_result()


@app.get("/api/dashboard/hc160/session-summaries")
def hc160_session_summaries():
    return dashboard_service.hc160_summaries()


@app.get("/api/dashboard/hc160/system-status")
def hc160_system_status():
    return dashboard_service.system_status()
