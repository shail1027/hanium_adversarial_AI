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
