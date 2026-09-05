# FaceAuth Demo Scenario

## 1. 일반 사용자 정상 인증

1. 로그인 화면에서 `user` 계정으로 로그인한다.
2. 얼굴인증 시작을 누른다.
3. `정상 인증` 시나리오를 선택한다.
4. 화면에 `ACCEPT`와 정상 인증 완료 메시지가 표시된다.

## 2. 일반 사용자 공격 탐지

1. 로그인 화면에서 `user` 계정으로 로그인한다.
2. 얼굴인증 시작을 누른다.
3. `공격 탐지` 시나리오를 선택한다.
4. 화면에 `STEP_UP`이 표시된다.
5. 경고 및 솔루션 패널에 OTP, 카메라 재정렬, 고객센터 연결 안내가 표시된다.

## 3. 관리자 대시보드

1. 로그인 화면에서 `admin` 계정으로 로그인한다.
2. 관리자 화면에서 `Attack`, `Defense`, `HC160` 탭을 전환한다.
3. 공격 포렌식, 방어 파이프라인, HC160 세션 결과 계약 화면을 확인한다.

## 4. 백엔드 API

- `POST /api/auth/login`
- `POST /api/face/start`
- `POST /api/face/verify`
- `GET /api/dashboard/hc160/session-result`
- `GET /api/dashboard/hc160/session-summaries`
- `GET /api/dashboard/hc160/system-status`

현재 서버는 fixture fallback으로 시연 안정성을 보장한다. 모델 레포 CLI 연동은 `backend/app/model_adapter.py` 경계에서 교체한다.
