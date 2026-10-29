# VeriFace 관리자 UI 인수인계

## 작업 기준과 소유권

- 기준 웹: `/Users/choihwanseok/26_HP015/hanium-local/web`, `97e963abe14773ed0cccc011344e06f3ba8e671a`. 시작 시 후속 커밋 및 미커밋 변경 없음.
- 작업 복제: 한이음 원본 폴더의 `.worktrees/veriface-admin-purple-ui`.
- 브랜치: `codex/admin-purple-ui`. 기준 저장소나 다른 UI 작업 폴더에서 수정하지 않음.
- 백엔드 확인 기준: `8ebd3783fc242e9ffb869d63fca380012fda3b88`. 서버·설정·등록 저장소·SQLite 수정 없음.
- DESIGN.md, PLAN.md, API 계약을 읽고 `admin-dashboard.png`, `youtube-layout-reference.jpg`를 이미지 뷰어로 직접 확인했다. 참고본 전체를 복사하지 않았으며 기존 기준 App.tsx의 공격 분석 코드를 관리자 모듈로 옮겨 재사용했다.
- 최신 사용자 지시 반영: 상시 시연 배너, 데모 워터마크, 반복 안내를 제거했다. 데이터 출처와 평가 상태는 해당 결과와 실험 기록에 표시한다.

## 공통 진입점 연결

```tsx
import { AdminDashboard } from './admin';

// 로그인과 사용자 역할 분기 이후 관리자 분기에만 배치한다.
if (currentUser.role === 'admin') {
  return (
    <AdminDashboard
      user={currentUser}
      onLogout={() => setCurrentUser(null)}
    />
  );
}
```

`AdminDashboardProps` export:

```ts
interface AdminDashboardProps {
  user: Pick<LoginResponse, 'display_name'>;
  onLogout: () => void;
  runtimeResult?: FaceAuthVerifyResponse;
}
```

- 기본 export 진입점은 `frontend/src/admin/index.ts`의 named export `AdminDashboard`다.
- CSS는 컴포넌트에서 import한다. 공통 CSS·index.html에 추가할 코드는 없다.
- `.console-main` 같은 폭 제한 컨테이너 안에 넣지 말고 역할 분기에서 최상위 화면으로 렌더링한다.
- 기존 App.tsx의 관리자용 세 로더와 관리자 전역 에러/로딩 분기는 통합자가 제거한다. AdminDashboard가 출처별 로딩·재시도를 소유한다. 특히 사용자 역할 화면 앞에서 관리자 자료 로딩 실패를 반환하지 않도록 한다.
- 기존 관리자 TopBar/분석 컴포넌트와 사용하지 않게 된 imports/types/constants도 통합자가 정리한다. 이 브랜치는 원본 App.tsx를 변경하지 않는다.
- `runtimeResult`는 실제 얼굴 API의 **단일 응답**을 명시적으로 전달할 때만 사용한다. fixture를 이 타입으로 변환하거나 캐스팅하지 않는다. 미전달 시 실제 결과를 생성하지 않는다.
- 실제 결과는 정적 HC160 로드 실패와 무관하게 인증 결과 메뉴에서 표시한다. 해당 prop은 관리자 이력 API를 구현하지 않는다. token_id는 렌더링·저장·소비하지 않는다.
- 메뉴는 내부 상태로 관리한다. 외부 라우터 변경은 필요하지 않다. 로그아웃은 전달받은 콜백만 호출한다.

## 메뉴와 보존한 분석 기능

| 메뉴 | 제공 기능 |
| --- | --- |
| 개요 | 공격 CSV 전체 표본 수·공격 후 승인 분자/분모·High/Critical 수, 공격 유형별 비교표, 인증 이력 빈 상태, 최근 분석 세션 및 상세 이동 |
| 인증 결과 | 실제 이력 미연결 상태, HC160 기록 목록·선택, 판정/STEP-UP/오류/실패 게이트 필터, 선택한 세션 요약 및 제공되는 경우만 상세·게이트·예산·출처·감사 정보 |
| 공격 분석 | 기존 공격별 비교·위험 분포, risk/family/accepted 교집합 필터, 키보드 세션 선택, 원본 공격 조건·nullable 측정값, 탐지 룰 설명, evidence 경로, 계정별 위험 집계, 기록 타임라인, 룰 통계 |
| 방어 분석 | 앙상블·적대적 학습·특징 압축 각 CSV의 독립 분모, 모든 원본 행/측정값, 3종 특징 압축 탐지 비교, epoch별 loss/ASR와 학습 설정 |
| 실험 기록 | CSV/JSON/fixture 출처, 모델·pretrained·공격 전달 산출물, 스키마 및 게이트 artifact 버전, 기록된 시스템 상태 |

공격 상세는 기존 top_risk_sessions 목록을 필터링하고 attack_sessions의 같은 session_id 상세를 찾는다. 필터 결과가 비면 이전 상세를 남기지 않는다. HC160 요약 목록 중 상세 JSON과 ID가 일치하지 않는 세션은 상세 자료 없음으로 표시한다.

기존 방어 화면의 시간적 일관성 정상 카운터, 하드코딩 운영 상태/날짜, 서로 다른 기법을 결합한 최종 통과·차단 및 근거 없는 위험 점수 안내는 옮기지 않았다. 동일 sample_id라고 해서 독립 실험 결과를 실제 순차 파이프라인의 최종 판정으로 합치지 않는다. 원본 열과 각 기법별 성공/승인/탐지 결과는 모두 남겼다.

## 데이터와 인증 의미

- 기존 `data.ts`, `api.ts`, `types.ts`를 변경하지 않고 사용한다. API 응답 또는 public fallback 모두 현재 정적 관리자 산출물이다.
- 개요의 공격 데이터: 현재 2,000행, accepted_after_attack 981행 → 49.05% (981 / 2,000), High/Critical 893행. 정적 공격 데이터셋 내부 집계이며 실제 인증 통계가 아니다.
- 방어 CSV의 표본과 공격 전체·HC160 fixture를 하나의 성공률로 합치지 않는다. 0행이면 비율은 `미집계`, null은 `자료 없음 (null)`, undefined는 `미제공`이다.
- gate_id, role, status 원본 유지. `SCORED · 점수 산출`과 `NOT_EVALUATED · 미평가` 구분. `display_layer=null`은 `미분류 (null)`, 속성 누락은 `미제공`; ID에서 임의 추론하지 않는다.
- runtime decision_provenance.source와 runtime_identity를 그대로 표시한다. schema_version과 gate provenance.artifact_version을 다른 필드로 유지한다.
- 실제 인증 기록 조회 API는 아직 미연결이다. 모의 로그인은 실제 권한 통제가 아니다. 실제 FULL 정상 승인·공격 방어 성능을 검증 완료로 표시하지 않는다.
- 기존 인증 흐름·토큰 소비 조건·카메라 조명에는 변경이 없다.

## 스타일·접근성

모든 CSS는 `.veriface-admin` 하위에 한정했다. 일반 컴포넌트 클래스에는 `vf-` 접두사를 사용해 기존 전역 클래스와 충돌하지 않는다. body/:root/전역 요소 스타일을 작성하지 않는다. 공통 styles.css를 함께 로드한 브라우저에서도 제목·지표·표 색상을 검증했다.

고정 좌측 메뉴, 세 지표 카드, 넓은 결과 표와 우측 보조 패널을 제공한다. 760px 이하에서는 메뉴 버튼으로 펼친다. 표는 개별 스크롤 영역이고 tabIndex/접근 가능한 이름을 갖는다. 메뉴·세션 선택은 native button, 필터는 label/select 및 aria-pressed를 사용한다. 데이터 표는 높이 560px 안에서 스크롤하여 대량 행도 다음 분석 영역을 밀어내지 않는다.

## 검증

```sh
node --test frontend/tests/*.test.ts
npm run build
npm run lint
git diff --check
```

- Node 테스트: 기존 9개 + 관리자 4개 = 13개 통과.
- TypeScript/build, ESLint, diff 공백 검사 통과. 공통 진입점을 연결하지 않았으므로 기존 Vite build는 기존 App을 번들한다. 관리자 export는 별도 esbuild 번들 검사 및 브라우저 모듈 로딩으로 검증했다.
- 관리자 번들: `frontend/node_modules/.bin/esbuild frontend/src/admin/index.ts --bundle --outdir=/tmp/veriface-admin-bundle --format=esm --platform=browser` 통과.
- 관리자 모델 테스트: 분자/분모·0행, 공격 교집합 필터, 인증 판정/이벤트/실패 게이트 필터, nullable·미평가 의미.
- 기존 환경의 Playwright를 이용한 관리자 전용 브라우저 검사(의존성/lock 추가 없음):

```sh
PLAYWRIGHT_MODULE=/Users/choihwanseok/.agents/skills/gstack/node_modules/playwright/index.mjs \
  node frontend/tests/admin-browser.mjs
```

다른 환경은 PLAYWRIGHT_MODULE을 설치된 Playwright의 index.mjs로 지정하거나 모듈이 resolve되게 한다. ADMIN_BROWSER_CHANNEL 기본값은 chrome, ADMIN_TEST_PORT 기본값은 5198이다. 테스트는 독립 Vite 프로세스와 임시 HTML/TSX 진입점을 만들고 종료 시 자신의 프로세스·진입점만 정리한다. 별도 기존 서버를 종료하지 않는다.

브라우저 검사: 5개 메뉴, 1440/1280/390/360px, 모든 메뉴 360px 가로 넘침 없음, 키보드 세션 선택, 필터·상세 없음, 빈 CSV 미집계, 출처별 오류 격리, HC160 로드 실패와 실제 결과 동시 존재, null/SCORED/NOT_EVALUATED/provenance, 다크 테마 텍스트, 로그아웃 콜백. API 경로는 테스트에서 503 처리해 저장된 public 자료 fallback을 검증한다. runtime 검사는 명시적 대역이며 실물 얼굴 인증 검증이 아니다.

스크린샷: `frontend/tests/admin-screenshots/`

- `overview-desktop.png`: 1440px 개요
- `overview-1280.png`, `overview-390.png`, `overview-360.png`: 반응형 개요
- `authentication-desktop.png`, `attack-desktop.png`, `defense-desktop.png`, `experiments-desktop.png`: 세부 메뉴
- `attack-mobile.png`: 좁은 화면 공격 분석
- `runtime-test-mobile.png`: 실제 응답 계약의 명시적 UI 테스트 대역

## 남은 통합 범위

공통 App.tsx 연결과 모바일 UI 결합은 최종 통합 담당 작업이다. 실제 인증 이력 API, 계정/관리자 권한 통제, 실제 FULL 인증 성공 및 방어 성능 실측 검증은 이 UI 변경으로 구현되지 않는다. 서버/인증 백엔드/의존성/lock/shared capture는 변경하지 않았다. 원격 push·배포·원본 브랜치 병합 없음.
