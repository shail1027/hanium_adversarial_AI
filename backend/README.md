# Veriface 로컬 얼굴 등록·인증 연결

이 서버는 기존 웹 `main`의 화면/API 구조에서 HC160의 등록·FULL 인증 서비스를 호출한다.
최종 통합 실행본은 `/private/tmp/hanium-final-backend`의 HC160 백엔드를 사용한다.
최초 연결 기준은 `db1e205863cf6eba7545982b8c6b96089f606ae8`이며, 최종본은 후속 보안 수정을
포함한다. 요청마다 CLI를 실행하지 않는다.
하나의 프로세스에서 `SessionService`, `TokenService`, `DecisionPolicyService`를 재사용한다.

## 신뢰 범위

현재 로그인은 **표시용 모의 로그인**이다. 비밀번호나 관리자 권한을 검증하지 않으며,
반환된 `demo` 토큰은 얼굴 API의 사용자 식별에 사용하지 않는다. 이번 연결은 로컬 단일
운영자 검증용이다. `HC160_LOCAL_USER_ID`와 `HC160_DEVICE_ID`를 서버에서 고정하고,
클라이언트가 account/device/IP/template/calibration 경로를 선택하지 못한다. IP는 직접
연결한 소켓의 주소만 사용하며 전달 헤더를 신뢰하지 않는다. 서버는 loopback 요청과
허용 Host/Origin만 받는다. **`--proxy-headers`를 켜거나 외부에 노출하지 않는다.**

여러 사람의 등록 파일은 사용자별 디렉터리로 구분된다. 로컬 사용자를 바꾸려면 서버를
중지하고 `HC160_LOCAL_USER_ID`를 바꾼 뒤 같은 저장소/DB로 다시 시작한다. 웹 로그인
이름을 바꿔 다른 사람의 등록을 선택할 수 없다. 실서비스 다중 사용자 운영에는 검증된
계정 principal을 제공하는 별도 로그인/계정 시스템 연결이 필요하다. 얼굴 ACCEPT도
계정 로그인이나 관리자 권한을 부여하지 않는다.

## 환경과 실행

웹 가상환경에 `backend/requirements.txt`와 기준 HC160 저장소의
`requirements-face-auth.txt`, `requirements-pad-onnx.txt` 의존성이 모두 필요하다.
기존 공통 lock은 변경하지 않았다. 기준 백엔드의 지원 환경/설치 안내도 따른다.

```bash
# 웹 worktree 루트에서 실행. 아래 최종 자동 검증은 Python 3.11.7에서 완료했다.
export HC160_REPO_PATH=/private/tmp/hanium-final-backend
python3.11 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m pip install -r "$HC160_REPO_PATH/requirements-pad-onnx.txt"
npm --prefix frontend ci
```

서버 프로세스를 시작하기 **전에** 다음을 설정한다. 경로는 전부 서버가 관리하는
절대 경로다. 기존에 승인된 threshold와 version을 사용하며 예시 숫자로 대체하지 않는다.

| 변수 | 의미 |
|---|---|
| `HC160_REPO_PATH` | 기준 HC160 저장소의 절대 경로 |
| `HC160_STORAGE_ROOT` | Git 밖의 비공개 등록/감사 저장 디렉터리, 소유자만 접근 가능하게 준비 |
| `HC160_LOCAL_USER_ID` | 서버가 지정한 불투명 로컬 사용자 ID |
| `HC160_DEVICE_ID` | 요청/브라우저 재시작으로 변경하지 않는 서버 지정 기기 ID |
| `HC160_DEVICE` | 등록과 인증에서 동일하게 사용, 기본 `cpu` |
| `VERIFACE_QUERY_BUDGET_DB` | 모든 FULL 요청이 공유하는 고정 SQLite 절대 경로, 부모 디렉터리 필요 |
| `HC160_PAD_MODEL` | 실제 `anti-spoof-mn3.onnx` 절대 경로 |
| `HC160_PAD_REGISTRY` | 기준 저장소 `configs/models/anti-spoof-mn3.json`의 절대 경로 |
| `HC160_THRESHOLD` / `HC160_THRESHOLD_VERSION` | 기존 검증/운영 설정의 임계값과 버전, 자동 기본값 없음 |
| `HC160_TEMPLATE_KEY_ID` | 암호화 등록에 사용할 서버 키 ID |
| `HC160_TEMPLATE_KEYS` | 기존 HC160 키 계약의 JSON, 환경에서만 제공하고 커밋/화면 출력 금지 |
| `HC160_REFERENCE_DISTRIBUTIONS` | 선택적 절대 기준 분포 JSON 경로; 없으면 기존 정책대로 STEP_UP 가능 |

PAD runtime은 `onnx`, version은 `open-model-zoo-anti-spoof-mn3-2022.1`로 고정한다.
설정은 CLI parser를 통해 원래의 FULL pipeline에 전달하며, SQLite는 항상
`--query-budget-store sqlite --query-budget-db <고정 경로>`에 해당하는 설정을 사용한다.
`HC160_HANDOFF_DIR`, 녹화 demo video, 임의 challenge frame marker 및 memory budget으로
fallback하지 않는다. 기본 gate와 threshold 설정을 낮추거나 비활성화하지 않는다.

```bash
backend/.venv/bin/python -m uvicorn backend.app.main:app \
  --host 127.0.0.1 --port 8001 --workers 1 --no-proxy-headers
npm run dev
```

동일 등록 저장소에는 OS 파일 잠금으로 하나의 서버만 허용한다. reload/재시작하면
진행 중 세션·nonce·token이 사라져 다시 촬영해야 한다. 등록 파일과 SQLite 예산은 유지된다.
정상 동작 환경에 FaceNet 가중치와 실제 PAD 모델을 준비한다. 모델 누락·키 오류·DB 장애는
성공으로 바뀌지 않는다. 실제 PAD registry는 `candidate_unvalidated` 상태이며 본 연결이
PAD 정확도 검증을 의미하지 않는다.

## 촬영·세션 계약

1. `GET /api/face/context`: 로컬 사용자 표시, 등록 상태, 설정 준비 상태와 CSRF를 반환한다.
   브라우저에는 HttpOnly/SameSite 쿠키를 주고 이후 POST마다 CSRF·쿠키 소유자를 검증한다.
2. `POST /api/face/start {operation}`: `enroll` 또는 `authenticate`. 실제 백엔드 세션과
   무작위 challenge/nonce를 발급한다. 다른 활성 촬영이 있으면 충돌로 거부한다.
3. 화면에 안내를 렌더링하고 두 animation frame 이후 `/face/present`에
   `{session_id, nonce, displayed_at_ms}`를 보낸다. 한 번만 허용한다. 서버는 같은 nonce의
   조명 순서를 발급한다. 브라우저는 표시 시각을 공통 시간 기준으로 유지하며, 응답이
   250ms 이상 늦거나 첫 조명 단계를 놓치면 촬영을 취소한다.
4. `/face/frame`에 `{session_id, nonce, frame_id, timestamp_ms, image}`를 순서대로 전송한다.
   `image`는 브라우저 카메라의 JPEG base64이며 파일 경로나 녹화 동영상을 받지 않는다.
   원본 비율을 유지해 최대 640×480, 약 10fps, 최대 80프레임을 메모리에만 보관한다.
   프레임 순서·단조 시각·표시 이후 여부·수신 시간 편차·크기·JPEG 형식을 검증한다.
   **FULL pipeline 시간은 서버 수신 시각**이다. 클라이언트 시각은 메타데이터/연속성
   검사에만 사용하므로 시각을 앞당겨 조명 반응 지연을 줄일 수 없다.
5. `/face/verify {session_id, nonce}`: 챌린지 전체 길이와 프레임 수를 확인하고 한 번만 평가한다.
   표시 확인 이후 받은 첫 프레임을 서버가 경계로 정한다. 클라이언트가
   `challenge_start_frame_id=0`을 제출해 기존 영상을 통과시키는 경로는 없다.
6. 등록은 기존 `create_calibrated_template`/`save_calibrated_template`을 사용한다. 성공 후에만
   사용자별 template/calibration 매핑을 원자적으로 공개한다. 기존 등록은 덮어쓰지 않으며
   해시·사용자·디렉터리 경계·template/model/device binding을 인증 시 다시 검증한다.
7. 인증은 기존 FULL pipeline과 정책을 사용한다. `ACCEPT`에 실제 token이 있어야
   `/face/consume {session_id, token_id}`를 호출할 수 있고 같은 프로세스에서 일회용 소비한다.
   화면은 소비 확인 후에만 **얼굴 검사 통과**를 표시한다. `STEP_UP`/`REJECT`에는 token이 없고,
   추가 인증 수단이 연결되지 않은 STEP_UP은 미승인 상태로 남는다.
8. `/face/cancel`은 프레임과 승인 토큰 연결을 지운다. 브라우저 취소/페이지 종료/90초 제한 시
   카메라 트랙을 중지한다. 서버 추론 제한은 60초이며 시간 초과 후 늦게 도착한 결과를
   공개하거나 등록 매핑에 반영하지 않는다. 네이티브 추론 스레드 자체를 강제 중지할 수는
   없어 그동안 새 촬영은 즉시 503으로 거부한다. 멈춘 추론은 서버 재시작이 필요하다.

브라우저는 수정 가능한 클라이언트다. 이 계약은 발급 순서·프레임 수신·서버 nonce 결합을
검증하지만, 실제 사람이 화면을 봤는지나 카메라 출처를 하드웨어로 증명하지는 않는다.
전송 지연은 보수적으로 게이트 실패를 유발할 수 있으므로 실물 카메라 검증이 필요하다.
등록 중 프로세스 종료/시간 초과는 공개 매핑 없는 비공개 orphan 파일을 남길 수 있다.
수동 점검 없이 기존 등록 파일을 삭제하지 않는다.

## Fixture와 실제 결과

`/api/face/*`에는 시나리오 fixture/CLI 실패 fallback이 없다. 기존 관리자 대시보드
`/api/dashboard/*`의 정적 fixture는 유지하고 화면에서 명확히 표시한다. 관리자 화면의
시연 결과는 실제 촬영 세션이나 승인 결과가 아니다.

## 자동 검증과 실물 검증

```bash
# 기준 저장소와 이미 준비된 모델을 지정해야 runtime/real ONNX 검사도 실행된다.
export HC160_TEST_REPO="$HC160_REPO_PATH"
export HC160_TEST_PAD_MODEL="$HC160_PAD_MODEL"
backend/.venv/bin/python -m pytest backend/tests -q
node --experimental-strip-types --test frontend/tests/faceCapture.test.ts
npm run build
npm run lint
```

자동 테스트는 합성 JPEG 전송, 실제 암호화 등록·보정 연결, 서로 다른 사용자/파일 거부,
세션·nonce·타이밍·중복 제출, 토큰 소비, 정책 결과, SQLite 지속성, DB/PAD/시간 초과의
비승인 처리를 검증한다. 일부 inference는 명시적 테스트 대역이다. opt-in ONNX 검사는
실제 모델에 합성 RGB를 넣어 runtime 배선을 검증하며 보안 성능을 측정하지 않는다.

사용자 참여 검사는 브라우저 카메라 권한 → 등록 → 별도 인증 촬영 → 무작위 고개 동작 및
조명 → 실제 판정·STEP_UP 안내 순서로 수행한다. 등록과 인증은 다른 촬영이어야 한다.
기준 분포가 없거나 장치 품질/지연 게이트가 실패해도 임계값을 낮춰 통과시키지 않는다.
사진/화면 재생 공격 방어율, 사용자·기기 일반화, 운영용 계정 인증은 별도 검증 대상이다.

## 최종 자동 검증 기록 (2026-10-24 KST)

최종 웹 worktree는 `/private/tmp/hanium-final-web`, 연결 백엔드는
`/private/tmp/hanium-final-backend`이다. macOS 26.6.2 arm64에서
Python 3.11.7, FastAPI 0.116.1, Uvicorn 0.35.0, Pydantic 2.11.7,
pytest 8.4.1, HTTPX 0.28.1, ONNX Runtime 1.19.2, Torch 2.2.2,
Torchvision 0.17.2, facenet-pytorch 2.6.0으로 검증했다. NumPy 1.26.4,
OpenCV 4.7.0.72, Pillow 10.2.0, scikit-learn 1.2.1, SciPy 1.10.1,
cryptography 50.0.1도 기존 얼굴 인증 요구 버전과 일치한다.
프론트엔드는 Node.js 26.5.0, npm 11.17.0, TypeScript 5.7.3,
Vite 6.4.3, React 18.3.1, ESLint 9.39.4를 사용했다.

검증용 Python은 `/private/tmp/hanium-final-web-venv/bin/python`이다. 이 환경은
웹 의존성을 별도로 설치하고 기존 검증 환경
`/private/tmp/face-auth-py311-verification/macos-venv/lib/python3.11/site-packages`를
`.pth`로 참조한다. 기존 환경은 변경하지 않았다. 독립 설치 시에는 위의
`backend/requirements.txt`와 `requirements-pad-onnx.txt` 설치 절차를 따른다.

```bash
HC160_TEST_REPO=/private/tmp/hanium-final-backend \
HC160_TEST_PAD_MODEL=/Users/choihwanseok/.codex/worktrees/final-pad-runtime/hanium-aml-defense/local_models/anti-spoof-mn3/anti-spoof-mn3.onnx \
/private/tmp/hanium-final-web-venv/bin/python -m pytest backend/tests -q
node --experimental-strip-types --test frontend/tests/faceCapture.test.ts
npm run build
npm run lint
```

- 웹 backend 전체 테스트: **51 passed, 0 skipped**. 실제 ONNX RGB ROI 추론 검사를 포함한다.
- 촬영 프로토콜 테스트: **7 passed, 0 skipped**.
- TypeScript 검사 및 프로덕션 build: 성공. ESLint: 성공.
- Starlette TestClient의 AnyIO alias 폐기 예정 경고 1건이 있다. 테스트 실패는 없다.
- 로그와 정확한 버전 목록: `/private/tmp/hanium-final-verification/web-*.log`.

이 결과는 합성 입력과 테스트 대역을 포함한 자동 검증 및 실제 PAD runtime 연결의
증거다. 카메라를 열거나 사용자 얼굴을 촬영하지 않았다. 실제 등록·별도 인증 촬영과
무작위 동작/조명에 대한 실물 검증, PAD 정확도·공격 방어율은 미검증 상태다.
