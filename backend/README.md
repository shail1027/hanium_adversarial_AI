# Backend

FastAPI 서버는 시연영상용 얼굴인증 API와 관리자 대시보드 API를 제공한다.

## Run

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

## API

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/face/start`
- `POST /api/face/verify`
- `GET /api/dashboard/hc160/session-result`
- `GET /api/dashboard/hc160/session-summaries`
- `GET /api/dashboard/hc160/system-status`
- `GET /api/dashboard/static/{dataset}/{file_name}`

## Model Adapter

`Yaho03/26_HC160` 저장소는 현재 CLI 중심 구조다. 이 서버는 `backend/app/model_adapter.py`에 CLI 연동 경계를 두고, 시연 안정성을 위해 fixture 응답을 기본값으로 사용한다.
