# 최종 웹 통합 실행 및 검증

## 소스와 통합 경계

브랜치: `codex/final-web-integration`.
작업 폴더: 한이음 원본 `hanium-aml-defense/.worktrees/veriface-final-web-integration`.
공통 조상: `97e963abe14773ed0cccc011344e06f3ba8e671a`.

- synthetic 웹: `ff06ca89777b100a26cdfe2fd93dce6facaf156d`를 통합 시작점으로 사용.
- 사용자: `7253ce0` → `e99e1d1` → `dcefa38f39fa0301d7ab0eee647471a0ae844c7c` 전체 반영.
- 관리자: `1586d7b` → `144af87dd1b9b6459b930807a45d8258599bea86` 전체 반영.
- 실제 모델 인증 backend 검증 기준: `/Users/choihwanseok/26_HP015/hanium-local/backend-m-synthetic`, `7d67c7f756511198dab6e84baa26d89dbc8e0ff8`.

실제 App.tsx가 로그인 이후 UserMobileApp/AdminDashboard를 직접 렌더한다.
관리자 데이터 로딩은 관리자 컴포넌트 내부에만 있다. 사용자 진입에 관리자 fixture가 필요하지 않다.
기존 중복 UI/전역 관리자 로더를 제거했다. 두 UI의 화면과 촬영/모션 구현 파일은 원본 최종 커밋과 동일하다.
로그인만 범위를 한정한 퍼플 CSS를 추가하고 중복 submit/종료된 로그인 응답을 무효화했다.
전역 smooth scroll은 reduced-motion에서 해제한다.

관리자 runtimeResult의 실제 전달원이 없으므로 prop은 미전달이다. 사용자 인증 응답을 로그아웃 이후 관리자에게 넘기거나 fixture로 대체하지 않는다.
정적 관리자 실험 자료는 실시간 기록이 아니다. 기존 로그인 응답은 authenticated=false인 역할 선택이며 실제 계정/관리자 권한을 부여하지 않는다.
공개 API 응답 계약과 synthetic factory 전달 옵션은 변경하지 않았다.

## 독립 미리보기

현재 frontend `http://127.0.0.1:5173/`, 독립 웹 API `http://127.0.0.1:8017`.
기존 5174/5175/8001 서버는 변경하지 않았다. 카메라는 자동으로 켜지지 않는다.
미리보기는 아래 repo/model 경로만 설정하고 키·등록 저장소·SQLite는 연결하지 않았다.
따라서 context.ready=false이며 실제 등록/인증은 설정 오류로 차단된다. 이 상태를 성공 fallback으로 바꾸지 않는다.

웹 루트에서 실행 (Python 3.11 독립 synthetic 환경):

```sh
export HC160_REPO_PATH=/Users/choihwanseok/26_HP015/hanium-local/backend-m-synthetic
export HC160_SYNTHETIC_MODEL=/Users/choihwanseok/26_HP015/hanium-local/synthetic-assets/FFc23.tar
export HC160_SYNTHETIC_DETECTOR_MODEL=/Users/choihwanseok/26_HP015/hanium-local/synthetic-assets/retinaface_resnet50_2020-07-20.pth
export HC160_SYNTHETIC_DEVICE=cpu
PYTHONPATH=/private/tmp/veriface-final-web-preview-deps \
 /Users/choihwanseok/26_HP015/hanium-local/synthetic-venv/bin/python \
 -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8017 --workers 1 --no-proxy-headers
```

`uvicorn==0.34.0`은 별도 `/private/tmp/veriface-final-web-preview-deps`에 설치했다. 기존 공유 Python 환경은 변경하지 않았다.
이 임시 경로가 없다면 같은 독립 환경의 pip로 `--target` 설치하거나 별도 웹 venv에 저장소 requirements를 설치한다.
frontend 폴더에서:

```sh
npm ci --ignore-scripts
VERIFACE_API_TARGET=http://127.0.0.1:8017 npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`VERIFACE_API_TARGET`은 Vite 개발 서버 설정이며 브라우저 번들에 비공개 설정을 전달하지 않는다. 미설정 기본값은 기존 8001이다.
face API의 기존 Origin 허용 포트는 5173/5174/5175/8001이므로 빈 허용 frontend 포트를 사용한다.

최종 인증 backend가 도착하면 **이 통합 미리보기의 웹 API 프로세스에만** `HC160_REPO_PATH=/absolute/final/backend`를 지정하여 새 프로세스로 시작한다.
HC160Runtime은 이미 로드된 다른 backend 경로를 허용하지 않으므로 실행 중 프로세스에서 경로만 바꾸지 않는다.
원본 실행 서버를 재시작하지 않는다. 새 포트를 사용하면 frontend의 VERIFACE_API_TARGET도 일치시킨다.
실촬영용 필수 설정은 기존 ModelCliConfig 계약의 HC160_STORAGE_ROOT, HC160_LOCAL_USER_ID, HC160_TEMPLATE_KEY_ID/HC160_TEMPLATE_KEYS,
HC160_DEVICE_ID, VERIFACE_QUERY_BUDGET_DB, HC160_PAD_MODEL/HC160_PAD_REGISTRY 및 호환 HC160_REFERENCE_DISTRIBUTIONS다.
기존 키/등록 저장소/DB를 덮어쓰거나 초기화하지 않는다. reference 호환성/실측 자료는 인증 backend 담당의 검증 결과를 적용해야 한다.

## 검증 명령과 범위

웹 루트:

```sh
node --test frontend/tests/*.test.ts
npm --prefix frontend run build
npm --prefix frontend run lint
git diff --check
HC160_TEST_REPO=/Users/choihwanseok/26_HP015/hanium-local/backend-m-synthetic \
 HC160_TEST_PAD_MODEL=/Users/choihwanseok/.codex/worktrees/final-pad-runtime/hanium-aml-defense/local_models/anti-spoof-mn3/anti-spoof-mn3.onnx \
 SYNTHETIC_MODEL=/Users/choihwanseok/26_HP015/hanium-local/synthetic-assets/FFc23.tar \
 SYNTHETIC_DETECTOR_MODEL=/Users/choihwanseok/26_HP015/hanium-local/synthetic-assets/retinaface_resnet50_2020-07-20.pth \
 /Users/choihwanseok/26_HP015/hanium-local/synthetic-venv/bin/python -m pytest backend/tests -q -rs
/Users/choihwanseok/26_HP015/hanium-local/synthetic-venv/bin/python -m pip check
```

프런트 단위 테스트 21/21, TypeScript/Vite build, ESLint 통과.
웹 backend 전체 103/103, skip 0, pip check 통과(Python 3.11.7). 기존 deprecation warning 4개.
실제 SBI+RetinaFace는 공개 astronaut 6프레임으로 실행했고 scorer→FULL→score_contributions→정책을 확인했다.
이 검사에서 baseline/FaceNet/PAD/headpose/다른 게이트는 대역이며, 기준 분포가 없는 최종 판정은 STEP_UP/토큰 없음이다.
별도 실제 PAD opt-in은 무작위 RGB ROI의 ONNX 전처리/추론 smoke다. 공격 방어 성능이나 카메라 FULL 승인 증거가 아니다.

실제 App 진입점 브라우저 검사:

```sh
export PLAYWRIGHT_MODULE=/Users/choihwanseok/.agents/skills/gstack/node_modules/playwright/index.mjs
export PREVIEW_URL=http://127.0.0.1:5173/
export INTEGRATED_APP=1
node frontend/tests/app-integration.browser.mjs
node frontend/tests/user-mobile.browser.mjs
node frontend/tests/user-auth.browser.mjs
REDUCED_MOTION=1 node frontend/tests/user-auth.browser.mjs
node frontend/tests/user-motion.browser.mjs
ADMIN_TEST_PORT=5208 ADMIN_SCREENSHOTS=/tmp/veriface-final-web-screens/admin-detail node frontend/tests/admin-browser.mjs
```

통합 검사는 실제 App.tsx와 양쪽 CSS를 사용한다. 로그인/API/카메라는 명시적 대역이다.
사용자360/390/430px, 관리자1280/1440px, 역할/로그아웃, 관리자 데이터 실패 격리, focus/tooltip/menu/reduced-motion과 overflow를 검사한다.
사용자 검사는 등록/인증 분리, DOM→두 RAF→present ACK→순차프레임, 촬영 중 모션 잠금, 취소/늦은응답/중복 요청,
ACCEPT+consumed=true만 차감, STEP_UP/REJECT/ERROR/소비 실패 미차감을 검사한다.
관리자 기존 전체 회귀는 별도 컴포넌트 진입점으로 실행하는 보조 검사이며 실제 App 검사를 대체하지 않는다.
스크린샷: `/private/tmp/veriface-final-web-screens/`, 사용자 상세 상태는 `/private/tmp/veriface-user-screens/`.

## 남은 실촬영 검증

실제 카메라를 켜거나 얼굴 등록/실제 송금을 수행하지 않았다.
최종 backend와 호환 실측 reference/calibration이 준비된 뒤, 별도 동의를 받은 실제 등록 촬영과 인증 촬영으로
RGB 타이밍·움직임·취소/시간초과·PASS/STEP_UP/REJECT 및 토큰 1회 소비를 검증해야 한다.
대역 영수증은 실제 FULL 정상 승인 또는 실송금 증거가 아니다.

최종 브라우저 결과: 위 6개 실행 모두 PASS. 로그인 실패/동기 submit 2회→요청 1회 검사도 통과했다.
별도 대역 없는 독립 API(8017)로 실제 App 사용자·관리자 역할 진입/로그아웃도 PASS. 카메라는 강제로 차단했고 얼굴 인증은 실행하지 않았다.
`docs/ui/final-web-evidence/`에 실제 App의 로그인390px·사용자390px·관리자1440px와 대역 범위를 명시한 검사 기록을 보존했다.
