# VeriFace 사용자 모바일 웹 인수인계

기준 웹: `97e963abe14773ed0cccc011344e06f3ba8e671a` (시작 시 후속 커밋·미커밋 변경 없음).
기준 인증 백엔드: `8ebd3783fc242e9ffb869d63fca380012fda3b88` (읽기 확인만).
브랜치: `codex/user-mobile-ui`. 원본 한이음 폴더의 `.worktrees/veriface-user-mobile-ui` 독립 clone.
이전 `.worktrees/veriface-web-ui`는 기준이나 복사 원본으로 사용하지 않았다.
DESIGN.md, PLAN.md와 mobile-web.png를 직접 열어 확인한 뒤 구현했다.

## 통합 연결

```tsx
import { UserMobileApp } from './user';

// 기존 사용자 역할 분기를 교체. 관리자 데이터 로딩/오류 분기보다 앞에 둔다.
if (user.role === 'user') {
  return <UserMobileApp user={user} onLogout={handleLogout} />;
}
```

`UserMobileAppProps`: `user: LoginResponse`, `onLogout: () => void`.
이름은 시연 인사에만 사용하고 실제 계정 인증으로 해석하지 않는다.
`frontend/src/user/index.ts`가 컴포넌트와 props 타입을 export한다.
CSS는 컴포넌트 import로 포함되며 모든 selector는 `.vf-user` 하위에 제한된다.
추가 전역 CSS, 의존성, API, 타입, index.html 변경은 필요하지 않다.
통합 담당은 사용자 분기가 관리자 fixture 로딩 실패에 가로막히지 않도록 배치해야 한다.
사용자 화면을 감싸는 부모에 filter/transform/opacity를 적용하지 말 것: 촬영 RGB는 viewport 전체 원색이어야 한다.
공통 App.tsx의 기존 UserAuthShell 제거/교체는 통합 담당 소유다.

공통 촬영 hook 추출은 기준 커밋에 없으므로 사용자 전용 `useTransfer.ts`가 기존 API 함수와
`faceCapture.ts`의 waitForPaint/captureScheduleOrigin/captureFrames를 재사용한다.
공통 컨트롤 추출이 나중에 수행되면 이 사용자 hook의 세션·취소 검증을 보존해야 한다.

## 동작

홈 → 수신인/계좌/정수 금액 → 확인 → 미등록 시 등록 → 별도 인증 버튼 → 토큰 소비 → 영수증.
시연 시작 잔액 2,450,000원, 초기 거래는 빈 상태. 실제 금융 API 없음.
새로고침/컴포넌트 종료 시 시연 잔액과 이력은 초기화된다. 토큰/얼굴 자료는 저장하지 않는다.

- 입력값을 인증 시작 시 복제하여 고정한다. 수정/취소/새 거래는 이전 request capability를 폐기한다.
- 현재 요청에 바인딩된 session_id의 ACCEPT, 비어 있지 않은 token,
  authorized=false/account_authenticated=false, 해당 consume의 consumed=true를 모두 확인한다.
- 등록 완료는 인증 완료가 아니며 별도 버튼으로 새 authenticate 세션을 시작한다.
- 중복 클릭은 동기 ref로 막고, 영수증 생성과 차감은 ledger에서 1회만 수행한다.
- 각 await 뒤 AbortSignal과 현재 attempt identity를 확인한다. 늦게 도착한 세션은 cancel하고,
  늦게 허용된 카메라 스트림은 즉시 stop한다. consume 응답 유실은 완료로 추정하지 않는다.
- 취소/pagehide/unmount/90초 timeout에서 진행 작업·타이머·카메라 트랙을 정리한다.
- challenge를 flushSync로 DOM 반영 → 기존 두 animation frame → present ACK → 기존 연속 프레임.
  원래 nonce, displayed_at_ms, 프레임 순서와 서버 RGB를 그대로 사용한다.
- STEP_UP/REJECT/ERROR/세션 불일치/소비 실패에서는 잔액·거래가 변하지 않는다.
- 카메라는 등록·인증 버튼으로만 요청한다. UI 진입/렌더/홈에서는 켜지지 않는다.

## 검증과 재현

웹 루트:
```sh
node --test frontend/tests/*.test.ts
```
frontend:
```sh
npm run build
npm run lint
```
웹 루트: `git diff --check`.
기존 API 2개 + 촬영 7개 + 사용자 ledger 8개 = 17개 테스트.

브라우저 테스트는 기존 외부 Playwright 설치를 이용하며 package/lock을 수정하지 않는다.
독립 검증용 미추적 `frontend/user-preview.html`, `frontend/user-preview.tsx`를 작성해 Vite에서
UserMobileApp만 렌더했다(React StrictMode, 기존 전역 styles.css도 포함).
최종 커밋에 임시 진입점은 포함하지 않는다. 재현 시 임시 HTML에 root와 module script를 두고
다음 내용을 임시 TSX로 작성한다:
```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles.css';
import { UserMobileApp } from './src/user';
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><UserMobileApp
    user={{display_name:'사용자',role:'user',access_token:'',token_type:'demo'}}
    onLogout={() => {}} /></React.StrictMode>
);
```
로컬 Vite를 127.0.0.1:5187에서 시작한 뒤:
```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/tests/user-mobile.browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/tests/user-auth.browser.mjs
```
`PREVIEW_URL`로 진입 주소, `BROWSER_CHANNEL`로 설치 브라우저 지정 가능(기본 chrome).
스크린샷 출력: `/tmp/veriface-user-screens/` (해당 폴더를 먼저 생성).
mobile 테스트: 360/390/430px overflow, 금액/잔액 검증, 확인→촬영 대기,
자동 카메라 없음, 권한 거부 시 잔액/내역 유지.
auth 테스트: 카메라/전송/API를 명시적으로 대체한 브라우저 상태 전이 검증.
실제 얼굴 또는 합성 얼굴 이미지를 만들지 않고 프레임 문자열도 transport-only 대역이다.
완료 스크린샷 `receipt-stub-390.png`는 대역 ACCEPT+consume 결과이며 실제 FULL 성공 증거가 아니다.

## 남은 제약

실제 카메라, 실제 얼굴 등록, FULL 정상 승인, 실제 backend consume는 이번 검증에서 실행하지 않았다.
현재 synthetic 점수 생성기와 호환 실측 기준 분포 부재 제약을 우회하지 않는다.
실제 이체·OTP·계정 권한·관리자 이력 자동 적재는 구현 대상이 아니다.
App.tsx 연결과 관리자 동시 렌더 회귀 검증은 최종 통합 단계에서 수행한다.
원격 push·배포·원본 브랜치 병합을 수행하지 않았다.

## 최종 실행 결과 — 2026-10-29

- node:test: 17/17 통과.
- TypeScript + Vite build: 통과. 공통 App은 연결 전이므로 production bundle은 기존 App이며,
  사용자 TS 전체는 타입 검사되고 실제 렌더는 위 독립 진입점에서 검증했다.
- ESLint, git diff --check: 통과.
- user-mobile.browser.mjs: 360/390/430px 및 입력/권한 거부 검증 통과.
- user-auth.browser.mjs: 등록/인증 분리, ACCEPT+consume, STEP_UP/REJECT/ERROR,
  소비 실패/세션 불일치, pending consume 취소, 트랙 정리 검증 통과.
- 홈·입력·확인·촬영 대기·대역 완료 스크린샷 생성. 홈과 촬영 대기, 대역 완료 이미지를 직접 열어 확인.
- 실제 90초 경과 및 물리 RGB 조명의 카메라 효과는 실측하지 않았다. 기존 촬영 프로토콜 단위 테스트는 통과했다.

## 사용자 문구 수정 — 2026-10-29

후속 사용자 요청에 따라 시연 모드 배지와 각 화면의 시연·실제 이체 안내 문구를 제거했다.
계좌·잔액·송금 일시·내 정보는 일반 서비스 문구로 표시한다. 실제 금융 API가 없는 구조와
인증·토큰 소비 조건은 그대로이며, 이 문서의 구현 제약은 여전히 유효하다.

## 모션 및 상호작용 — 2026-10-29

- `useUserMotion.ts`: 한 개의 mounted main에 WAAPI transform/opacity로 220ms 진입 효과.
  홈→입력→확인은 +18px, 이전 단계 복귀는 -18px. 나가는 DOM 복제/잔류 없음.
  뒤로 버튼은 확인→입력, 촬영→확인으로 복귀하며 draft를 보존한다.
- 버튼: 120ms scale(.97) 눌림, 160ms 메뉴 활성색·포커스/테두리 반응.
  hover는 hover:hover/pointer:fine에서만. 금액 입력값과 커서에는 애니메이션 없음.
  오류는 160ms 한 번 나타나며 흔들림 없음.
- 실제 비동기 상태만 준비/촬영/등록 확인/인증 확인/소비 승인 확인으로 표시.
  카메라 시작부터 consume 종료까지 busy 버튼은 disabled, 취소는 enabled.
  context 조회 중에만 회전 로딩을 표시하고, 촬영 요청 동안 spinner는 정지 상태다.
- 현재 검증된 receipt에만 240ms 체크 배지와 360ms 체크 선 그리기.
  receipt ID를 기억하여 1회 재생. 홈의 새 거래 행은 최초 표시 때만 240ms 등장하며
  다른 탭에서 돌아와도 이전 거래 행은 다시 재생하지 않는다.
  잔액 카운트업은 넣지 않았고 실제 확정값만 즉시 표시한다.
- `working`이 true인 전체 요청 구간에 root의 `vf-user--working` 적용.
  useLayoutEffect cleanup으로 WAAPI 취소, 전체 하위/의사 요소의 CSS animation/transition/filter를
  비활성화하며 버튼 눌림 변형도 중지한다. 촬영 화면은 화면 전환에서 제외한다.
  카메라 stream, 두 RAF, present ACK, RGB, 프레임·토큰 계약은 변경하지 않았다.
- reduced-motion에서 WAAPI 재생 없음, CSS 애니메이션/전환/눌림 이동 없음.
  OS 설정 변경도 감지해 실행 중인 WAAPI를 즉시 취소한다. 이벤트 리스너와 animation은
  effect cleanup으로 해제한다. 모션용 상시 타이머나 성공 판정 타이머는 추가하지 않았다.
- 화면 이동 때만 제목에 focus, 입력 변경·요청 진행 때는 focus를 이동하지 않는다.

브라우저 검증 추가 명령:
```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node frontend/tests/user-motion.browser.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs REDUCED_MOTION=1 node frontend/tests/user-auth.browser.mjs
```
`user-motion.browser.mjs`는 실제 Element.animate 호출의 방향·시간, computed pressed style,
포커스·caret, 빠른 이동/연타/단일 DOM, 세 모바일 폭 overflow, 촬영 중 animation 0개,
취소 후 늦은 카메라 응답, reduced-motion을 브라우저에서 검사한다.
`user-auth.browser.mjs`는 모든 start/present/frame/verify/consume 요청 시 motion lock과
실행 중 animation 0개를 확인하고 프레임 전송 시 배경이 서버 RGB/흰색 그대로임을 확인한다.
등록 버튼 연타 시 세션 1개, receipt 효과 1회, 새 거래 효과 1회와 탭 복귀 시 미재생,
비승인·소비 실패에서 성공 효과 0회를 확인한다. API·카메라는 명시적 대역이다.

모션 녹화: `/tmp/veriface-user-motion/mobile-motion.webm`.
Chrome CDP의 실제 화면 프레임 87개를 MediaRecorder로 기록했다(홈→입력→확인→뒤로→확인→촬영 대기).
녹화에서는 카메라 시작·실제 인증을 실행하지 않았다. 완료 효과는 별도 API 대역 브라우저 검사다.
미리보기: `http://127.0.0.1:5187/user-preview.html` (무시된 임시 진입점, 커밋 제외).

최종 모션 검증 결과: node:test 17/17, TypeScript/Vite build, ESLint, diff-check 통과.
일반/모션 감소 각각의 인증 대역 브라우저 검사와 기존 모바일 브라우저 검사 통과.
독립 모션 검사는 360/390/430px·키프레임·포커스·입력·취소·감소 설정 모두 통과.
WebM은 390×844 크기로 실제 디코딩/1초 이상 재생되며 video.error=null임을 확인했다.
