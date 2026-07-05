# 얼굴 인증 방어 시스템 — 대시보드 개발 브리핑

> **수신:** 대시보드 개발 담당자  
> **발신:** 방어 파이프라인 팀  
> **작성일:** 2026-07-07  
> **목적:** 대시보드 UI/UX 구성에 필요한 데이터 구조, 방어 로직, 표시 항목 정의

---

## 1. 시스템 개요

본 시스템은 FaceNet(InceptionResnetV1) 기반 얼굴 인증에 대한 **적대적 공격(Adversarial Attack)** 을 탐지·차단하는 4단계 방어 파이프라인이다.

```
인증 요청 수신
      │
  [1단계] 시간적 일관성 (Temporal Consistency)
      │  ─ 정적 이미지(사진 재생 등) 탐지
      │  ─ 탐지 시 즉시 REJECT
      │
  [2단계] 앙상블 투표 (Ensemble Voting)
      │  ─ ROI-first + Smoothing + Randomized Smoothing 3종 다수결
      │  ─ 과반 거부 시 REJECT
      │
  [3단계] 적대적 학습 (Adversarial Training)
      │  ─ fine-tuned FaceNet으로 cosine similarity 재검증
      │  ─ 임계값(0.47966) 미달 시 REJECT
      │
  [4단계] 특징 압축 사후 포렌식 (Feature Squeezing)
         ─ 3종 squeezer로 원본/압축 similarity 차이 측정
         ─ 탐지 결과를 risk_score로 변환 → 대시보드 전송
         ─ (차단 X, 분석/기록 목적)
```

각 단계의 실험 결과 (212개 적대적 샘플 기준):

| 단계 | 기법 | 방어 성공률 |
|------|------|------------|
| 1단계 | 시간적 일관성 | 100% (시뮬레이션) |
| 2단계 | 앙상블 투표 | 76.6% (131/171) |
| 3단계 | 적대적 학습 | 98.1% (208/212) |
| 4단계 | 특징 압축 탐지 | 100% 탐지 |

---

## 2. 대시보드에 표시해야 할 화면 구성 (제안)

### 2-1. 메인 패널: 실시간 인증 현황

```
┌─────────────────────────────────────────────────────┐
│  오늘의 인증 시도      오늘의 차단            위험 세션  │
│       212                  208                  4    │
│  ─────────────         ────────────        ──────── │
│  차단률 98.1%          공격 시도 212         위험도 高  │
└─────────────────────────────────────────────────────┘
```

표시 데이터:
- 총 인증 시도 수
- 차단 수 / 통과 수
- 공격 탐지 수
- 위험 세션 수 (risk_score ≥ 20인 세션)

---

### 2-2. 방어 파이프라인 상태 패널

각 단계별 실시간 탐지 현황:

```
[1단계] 시간적 일관성   ████████████ 212/212 (100%)  상태: 정상
[2단계] 앙상블 투표     ████████░░░░ 131/171 (76.6%) 상태: 정상
[3단계] 적대적 학습     ███████████░ 208/212 (98.1%) 상태: 정상
[4단계] 특징압축 포렌식  ████████████ 212/212 (100%) 상태: 감시중
```

---

### 2-3. 위험도 스코어 (Risk Score) 패널

**위험도 계산 방식:**

| 이벤트 | risk_score 기여 |
|--------|----------------|
| Feature Squeezing: 1개 squeezer 탐지 | +10 |
| Feature Squeezing: 2개 squeezer 탐지 | +20 |
| Feature Squeezing: 3개 squeezer 탐지 | +30 |
| 2단계 앙상블에서 차단됨 | +40 |
| 1단계 시간적 일관성에서 차단됨 | +50 |
| **최대 총점** | **100** |

**위험도 등급:**
- 🟢 정상 (0): 공격 없음
- 🟡 주의 (10~20): Feature Squeezing 1~2개 탐지
- 🔴 위험 (30+): Feature Squeezing 3개 탐지 또는 앙상블 차단

`data/verification_defense_feature_squeezing.csv` 의 `risk_score_add` 컬럼이 이 값이다.

---

### 2-4. 세션별 상세 로그 테이블

각 인증 시도(sample_id)마다 한 행으로 표시:

| 컬럼명 | 설명 | 데이터 출처 |
|--------|------|------------|
| `sample_id` | 인증 세션 ID | 모든 CSV 공통 |
| `stage1_blocked` | 1단계 차단 여부 | temporal CSV |
| `stage2_blocked` | 2단계 앙상블 차단 여부 | `ensemble_accepted == False` |
| `stage3_blocked` | 3단계 적대적 학습 차단 여부 | `accepted_after_defense == False` |
| `stage4_detected` | 4단계 포렌식 탐지 여부 | `is_attack_detected` |
| `risk_score` | 위험도 점수 (0~100) | `risk_score_add` 기반 |
| `final_result` | 최종 인증 결과 | BLOCKED / PASSED |
| `sim_score` | 최종 similarity 값 | `sim_adv_target` |

---

### 2-5. Feature Squeezing 상세 (포렌식 패널)

3종 Squeezer 각각의 탐지 현황 표시:

| Squeezer | 탐지율 | 설명 |
|----------|--------|------|
| Low Resolution (32×32 축소) | **100%** | 고주파 perturbation 제거 |
| Color Depth (4-bit 양자화) | **43.9%** | 미세 픽셀 변화 소거 |
| Median Filter (3×3) | **73.1%** | 국소 perturbation 평활화 |

표시 항목: `lr_sim_diff`, `cd_sim_diff`, `mf_sim_diff` (similarity 변화량)

---

### 2-6. 적대적 학습 모델 상태 패널

```
모델 버전: best_adv_trained.pt (Epoch 5)
학습 전 ASR (공격 성공률): 80.7%
학습 후 ASR (공격 성공률):  1.9%
방어 성공률: 98.1%

학습 이력:
  Epoch 1 │ Loss: 0.0007 │ ASR: 56.1%
  Epoch 2 │ Loss: 0.0045 │ ASR:  4.7%
  Epoch 3 │ Loss: 0.0028 │ ASR:  5.7%
  Epoch 4 │ Loss: 0.0004 │ ASR:  8.5%
  Epoch 5 │ Loss: 0.0007 │ ASR:  1.9% ← BEST
```

데이터 출처: `data/training_history.json`

---

## 3. 데이터 연동 방식

### 현재 상태: CSV 파일 기반 (실험 결과)
대시보드는 `data/` 폴더의 CSV를 읽어 정적으로 표시하면 된다.

```
data/
├── verification_defense_feature_squeezing.csv  # 4단계 포렌식 결과
├── verification_defense_ensemble.csv            # 2단계 앙상블 결과
├── verification_defense_adv_training.csv        # 3단계 적대적 학습 결과
├── attack_handoff_jpeg_index.csv                # 원본 공격 샘플 정보
└── training_history.json                        # 모델 학습 이력
```

### 향후 목표: 실시간 API 연동
인증 요청이 들어올 때마다 방어 파이프라인이 실행되고, 결과를 JSON으로 대시보드에 푸시하는 구조.

예상 API 응답 형식:
```json
{
  "session_id": "vf_ea54843f0264",
  "timestamp": "2026-07-07T14:32:10Z",
  "final_result": "BLOCKED",
  "blocked_at_stage": 3,
  "risk_score": 30,
  "stages": {
    "stage1_temporal": { "blocked": false, "embedding_std": 0.0045 },
    "stage2_ensemble": {
      "blocked": false,
      "votes": { "roi": false, "smoothing": false, "randomized": true }
    },
    "stage3_adv_training": {
      "blocked": true,
      "sim_adv_target": 0.0127,
      "sim_adv_source": 0.9787,
      "threshold": 0.47966
    },
    "stage4_forensic": {
      "is_attack_detected": true,
      "risk_score_add": 30,
      "squeezers": {
        "low_resolution": { "sim_diff": 0.406, "detected": true },
        "color_depth":    { "sim_diff": 0.048, "detected": false },
        "median_filter":  { "sim_diff": 0.025, "detected": false }
      }
    }
  }
}
```

---

## 4. 핵심 수치 (중간보고서 기재용)

| 지표 | 값 |
|------|----|
| 테스트 샘플 수 | 212개 |
| 공격 성공 샘플 수 (방어 전) | 171개 (80.7%) |
| 최종 방어 성공률 (3단계 기준) | **98.1%** (208/212) |
| Feature Squeezing 탐지율 | **100%** |
| 앙상블 방어 성공률 | **76.6%** |
| FaceNet 임계값 (threshold) | 0.47966 |
| 모델 파인튜닝 파라미터 수 | 2.5M / 27.9M (9%) |

---

## 5. 질문 및 협의 사항

대시보드 개발 중 아래 사항은 방어 파이프라인 팀과 협의 필요:

1. **실시간 연동 시점**: 현재 CSV 정적 표시 → API 연동으로 전환할 시점
2. **risk_score 세부 가중치**: 현재 제안값이며 변경 가능
3. **알림 임계값**: 어느 risk_score부터 관리자 알림을 보낼지
4. **대시보드 갱신 주기**: 실시간 vs 분 단위 polling
