# Hanium Adversarial AI Dashboard

금융 얼굴인증 시연 플로우와 공격 포렌식·방어 파이프라인 결과를 확인하기 위한 fullstack 데모입니다.

## Branch Strategy

- `develop`: 기본 개발 브랜치입니다. 기능 구현과 통합 작업은 이 브랜치에서 진행합니다.
- `main`: 배포 가능한 안정 브랜치입니다. `develop`에서 검증된 변경만 병합합니다.

## Run

```bash
npm --prefix frontend install
npm run dev
python3 -m pip install -r backend/requirements.txt
npm run backend
```

## Build

```bash
npm run build
```

## Structure

- `frontend/`: React/Vite 사용자 인증 화면과 관리자 대시보드
- `backend/`: FastAPI 인증·대시보드 API
- `schemas/`: 외부 API contract schema
- `docs/`: 대시보드와 API 연동 문서

## Data

프론트엔드는 `frontend/public/forensics`, `frontend/public/defense`, `frontend/public/hc160` 아래의 정적 산출물을 읽고, FastAPI 서버는 같은 계약의 API 응답을 제공합니다.

### Attack Forensics

- `dashboard_overview.json`
- `attack_sessions.csv`
- `attack_family_matrix.csv`
- `rule_hit_summary.csv`
- `top_risk_sessions.csv`
- `attack_detection_rules.json`

현재 MVP 범위는 Overview 카드, 공격 유형별 비교, 위험 세션 테이블, 세션 상세 보기, 탐지 룰 통계입니다.

### Defense Dashboard

- `verification_defense_feature_squeezing.csv`
- `verification_defense_ensemble.csv`
- `verification_defense_adv_training.csv`
- `attack_handoff_jpeg_index.csv`
- `training_history.json`

방어 화면은 실시간 인증 현황, 4단계 방어 파이프라인 상태, 위험도 스코어 기준, 세션별 상세 로그, Feature Squeezing 포렌식, 적대적 학습 모델 상태를 표시합니다.

### HC160 Operations

- `public/hc160/session-result.json`
- `public/hc160/session-summaries.json`
- `public/hc160/system-status.json`
- `schemas/api/session-result.schema.json`
- `schemas/api/session-summary.schema.json`

HC160 화면은 백엔드가 계산한 세션 처리 상태와 최종 판정을 분리해 표시하고, L0~L4 gate 상태, STEP-UP 안내, 세션 이력, 시스템 상태를 운영자 관점에서 보여줍니다.
