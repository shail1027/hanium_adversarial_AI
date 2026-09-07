# Veriface Backend

FastAPI 서버는 Veriface 시연영상용 얼굴인증 API와 관리자 대시보드 API를 제공한다.

## Run

```bash
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8001
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

`Yaho03/26_HC160` 저장소는 현재 CLI 중심 구조다. 이 서버는 `backend/app/model_adapter.py`에 CLI 연동 경계를 두고, 아래 환경변수가 모두 준비되면 `POST /api/face/verify`의 정상 인증 시나리오에서 실제 CLI를 우선 호출한다.

```bash
export HC160_REPO_PATH=/path/to/26_HC160
export HC160_PYTHON_PATH=/path/to/python
export HC160_TEMPLATE_PATH=/path/to/template.enc
export HC160_DEMO_USER_ID=api-demo-user
export HC160_THRESHOLD=0.73
export HC160_THRESHOLD_VERSION=threshold-v1
export HC160_DEMO_VIDEO_PATH=/path/to/demo-auth-video.mp4
export HC160_TEMPLATE_KEYS='{"local-key-id":"base64-encoded-32-byte-key"}'
```

모델팀 handoff 폴더가 `HC160_DASHBOARD_HANDOFF_2026-09-08` 형태로 전달된 경우에는 아래처럼 줄여서 설정할 수 있다.

```bash
export HC160_REPO_PATH=/path/to/26_HC160
export HC160_PYTHON_PATH=/path/to/python
export HC160_HANDOFF_DIR=/path/to/HC160_DASHBOARD_HANDOFF_2026-09-08
export HC160_DEMO_USER_ID=api-demo-user
export HC160_TEMPLATE_KEYS='{"api-demo-v1":"base64-encoded-32-byte-key"}'
export HC160_MIN_BLUR_VARIANCE=10
export HC160_TORCH_HOME=/private/tmp/torch-cache
```

선택값:

```bash
export HC160_PROFILE=BASELINE_ONLY
export HC160_TEMPLATE_AUDIT_LOG=template-audit.jsonl
export HC160_FRAMES=20
export HC160_MIN_VALID_FRAMES=5
export HC160_MIN_BLUR_VARIANCE=40
export HC160_MIN_BRIGHTNESS=35
export HC160_MAX_BRIGHTNESS=220
export HC160_DEVICE=cpu
export HC160_TORCH_HOME=/private/tmp/torch-cache
```

환경변수나 실행 아티팩트가 없으면 서버는 fixture 응답으로 fallback한다. `GET /api/health`는 `hc160_cli_ready`와 `hc160_cli_missing`을 반환하므로 현재 실제 CLI 판정이 가능한 상태인지 바로 확인할 수 있다.

### 모델 개발팀에 필요한 산출물

실제 얼굴 인증 판정을 시연에 연결하려면 모델 개발팀에서 다음을 제공해야 한다.

- `python -m src.face_auth.cli authenticate`로 실행 가능한 고정 버전의 레포 commit 또는 release tag
- FastAPI 서버에서 사용할 Python 실행환경과 dependency 설치 방법
- 등록 완료된 암호화 template 파일 경로 또는 생성 절차
- template 복호화용 `HC160_TEMPLATE_KEYS` key id와 base64 인코딩된 32-byte 개발용 키
- 검증된 threshold 값과 `threshold_version`
- 데모용 정상 인증 video 파일 또는 브라우저 카메라 녹화 파일을 CLI 입력으로 받는 계약
- FULL profile을 쓸 경우 PAD model 파일, runtime 종류, input size, live class index, threshold 정보
- CLI stdout JSON의 stable schema와 exit code 의미
