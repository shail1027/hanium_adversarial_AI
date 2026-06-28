# Hanium Adversarial AI Dashboard

금융 얼굴인증 공격 포렌식 결과를 운영자가 빠르게 확인하기 위한 React 대시보드입니다.

## Branch Strategy

- `develop`: 기본 개발 브랜치입니다. 기능 구현과 통합 작업은 이 브랜치에서 진행합니다.
- `main`: 배포 가능한 안정 브랜치입니다. `develop`에서 검증된 변경만 병합합니다.

## Run

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Data

대시보드는 `public/forensics` 아래의 정적 포렌식 산출물을 읽습니다.

- `dashboard_overview.json`
- `attack_sessions.csv`
- `attack_family_matrix.csv`
- `rule_hit_summary.csv`
- `top_risk_sessions.csv`
- `attack_detection_rules.json`

현재 MVP 범위는 Overview 카드, 공격 유형별 비교, 위험 세션 테이블, 세션 상세 보기, 탐지 룰 통계입니다.
