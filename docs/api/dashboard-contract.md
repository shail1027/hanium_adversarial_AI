# HC160 Dashboard API Contract

이 문서는 HC160 운영 대시보드가 표시할 외부 응답 계약을 정리한다. 대시보드는 백엔드가 계산한 값을 표시하며, 프론트엔드에서 score, threshold, ACCEPT/STEP_UP/REJECT 판정을 재계산하지 않는다.

## 응답 원칙

- 모든 세션 결과 응답은 `schema_version`을 포함한다.
- `status`는 세션 처리 상태이고, `final_decision`은 인증 판정이다. 두 필드는 서로 대체하지 않는다.
- API 응답에 없는 gate는 `PASS`로 추정하지 않는다. 화면에서는 `UNAVAILABLE`, `NOT_EVALUATED`, `MEASUREMENT_PENDING` 중 안전한 상태로 표시한다.
- 원본 얼굴 이미지, embedding, template, 키, nonce 원문, 공격 생성 입력, 내부 stack trace, 로컬 절대 경로는 응답과 화면에 포함하지 않는다.

## 추가된 파일

- `schemas/api/session-result.schema.json`
- `schemas/api/session-summary.schema.json`
- `public/hc160/session-result.json`
- `public/hc160/session-summaries.json`
- `public/hc160/system-status.json`

## 화면 매핑

- Current Session: 세션 ID, 생성/완료 시각, 처리 상태, 최종 판정, latency, query budget
- Gate Timeline: L0~L4 gate status, role, reason code, provenance
- Step-up Panel: 백엔드 최종 판정이 `STEP_UP`인 경우 추가 인증 안내와 남은 시도 표시
- Session History: 최근 세션 목록과 판정/오류/STEP-UP/실패 gate 필터
- System Status: API, 엔진, 저장소, 모델, calibration artifact 상태

## 정적 대시보드와 실제 얼굴 API 스키마 분리

`session-result.schema.json`은 `/api/dashboard/hc160/session-result`가 제공하는
`frontend/public/hc160/session-result.json` 정적 결과의 계약이다. 기존 스키마와
fixture는 유지한다. 대시보드 결과는 현재 촬영 결과나 자동 누적 인증 이력이 아니다.

`face-verify-response.schema.json`은 `POST /api/face/verify`의 HTTP 200 본문을
검증한다. 등록 완료(`ENROLLED`)와 실제 runtime 인증 결과를 구별하며, 인증 처리
오류도 `session.final_decision=ERROR`인 비승인 응답으로 검증한다. HTTP 4xx/5xx의
FastAPI `detail` 응답은 이 스키마 대상이 아니다. `face-consume-response.schema.json`은
성공한 `POST /api/face/consume` 본문을 검증한다.

실제 결과에서 UI가 사용할 계약:

- `gates[].gate_id`, `status`, `role`은 원본 의미를 보존한다. `SCORED`는 점수가
  계산된 상태이며 `NOT_EVALUATED`나 인증 승인으로 바꾸지 않는다.
- `gates[].display_layer`는 표시용 계층이다. `null`이면 미분류로 표시하고 원본 ID를
  임의의 L0~L4 ID로 덮어쓰지 않는다.
- `decision_provenance.source=hc160_runtime`은 실제 얼굴 API 출처다.
  `runtime_identity`의 `backend_commit`, `backend_dirty`, `web_commit`, `web_dirty`는
  서버 초기화 시 확인한 실행 코드 정보다. Git 정보가 없으면 commit은 `unknown`,
  dirty는 `null`이다.
- `schema_version=1.0`은 응답 형식의 버전이다. gate provenance의
  `artifact_version`은 runtime backend commit(수정 작업 트리면 `-dirty`) 또는
  `unknown`이며 스키마 버전과 다르다.
- `ACCEPT`도 `authorized=false`, `account_authenticated=false`다. 비어 있지 않은
  token으로 `/face/consume`을 호출하고 `consumed=true`를 확인한 뒤에만 얼굴 검사
  통과로 표시한다. `STEP_UP`, `REJECT`, `ERROR`에는 token이 없으며 성공으로 표시하지
  않는다. 얼굴 검사 통과는 계정 로그인이나 관리자 권한 부여가 아니다.

스키마 테스트는 기존 정적 HTTP 응답과 브라우저 프로토콜을 통과한 등록·인증·오류·소비
HTTP 응답을 검증한다. 합성 JPEG와 명시적인 추론/토큰 대역을 사용하는 ACCEPT 검증은
전송 계약의 검증이며, 실제 사용자 FULL 인증 성공이나 PAD 정확도의 증거가 아니다.
