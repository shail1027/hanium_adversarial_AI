# 데이터 스키마 참조

## verification_defense_feature_squeezing.csv

4단계 Feature Squeezing 포렌식 결과. **대시보드 risk_score 산출 핵심 파일.**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `sample_id` | string | 인증 세션 ID |
| `defense` | string | "feature_squeezing" (고정) |
| `detection_threshold` | float | 탐지 임계값 (기본 0.05) |
| `accepted_after_attack` | bool | 공격 후 FaceNet이 인증 통과시켰는지 |
| `is_attack_detected` | bool | 1개 이상 squeezer에서 탐지됐는지 |
| `n_squeezers_detected` | int | 탐지된 squeezer 개수 (0~3) |
| `max_sim_diff` | float | 3개 squeezer 중 최대 similarity 차이 |
| `risk_score_add` | int | **대시보드 위험도 추가점 (0/10/20/30)** |
| `lr_sim_original` | float | low_res: 원본 similarity |
| `lr_sim_squeezed` | float | low_res: 압축 후 similarity |
| `lr_sim_diff` | float | low_res: similarity 차이 |
| `lr_detected` | bool | low_res: 탐지 여부 |
| `cd_sim_original` | float | color_depth: 원본 similarity |
| `cd_sim_squeezed` | float | color_depth: 압축 후 similarity |
| `cd_sim_diff` | float | color_depth: similarity 차이 |
| `cd_detected` | bool | color_depth: 탐지 여부 |
| `mf_sim_original` | float | median_filter: 원본 similarity |
| `mf_sim_squeezed` | float | median_filter: 압축 후 similarity |
| `mf_sim_diff` | float | median_filter: similarity 차이 |
| `mf_detected` | bool | median_filter: 탐지 여부 |
| `defense_time_sec` | float | 처리 시간 (초) |

---

## verification_defense_ensemble.csv

2단계 앙상블 투표 결과.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `sample_id` | string | 인증 세션 ID |
| `defense` | string | "ensemble_voting" (고정) |
| `roi_accepted` | bool | ROI-first 방어가 통과시켰는지 |
| `smoothing_accepted` | bool | Smoothing 방어가 통과시켰는지 |
| `randomized_accepted` | bool | Randomized Smoothing이 통과시켰는지 |
| `ensemble_votes` | JSON string | `{"roi": bool, "smoothing": bool, "randomized": bool}` |
| `ensemble_accepted` | bool | 앙상블 다수결 최종 통과 여부 |
| `accepted_after_attack` | bool | 공격 후 FaceNet이 인증 통과시켰는지 |
| `attack_success_after_defense` | bool | 방어 후에도 공격이 성공했는지 |
| `defense_success` | bool | 공격 샘플을 차단했는지 |

---

## verification_defense_adv_training.csv

3단계 적대적 학습 모델의 최종 평가 결과. **핵심 방어 결과 파일.**

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `sample_id` | string | 인증 세션 ID |
| `defense` | string | "adv_training" (고정) |
| `defense_params` | JSON string | `{"epochs": 5, "lr": 1e-5, "margin": 0.15}` |
| `threshold` | float | FaceNet 인증 임계값 (0.47966) |
| `similarity_after_attack` | float | 공격 전 원본 FaceNet similarity |
| `sim_adv_target` | float | **fine-tuned 모델의 adv→target similarity** |
| `sim_adv_source` | float | fine-tuned 모델의 adv→source similarity |
| `accepted_after_attack` | bool | 공격 후 원본 FaceNet이 통과시켰는지 |
| `accepted_after_defense` | bool | fine-tuned 모델이 통과시켰는지 |
| `attack_success_after_defense` | bool | 방어 후에도 공격이 성공했는지 |
| `defense_success` | bool | **공격을 성공적으로 차단했는지** |

---

## training_history.json

모델 학습 이력. 대시보드의 "모델 상태" 패널에 표시.

```json
{
  "asr_before": 0.8066,       // 학습 전 공격 성공률 (80.7%)
  "asr_best": 0.0189,         // 최저 공격 성공률 (1.9%)
  "epochs": 5,
  "lr": 1e-05,
  "margin": 0.15,
  "history": [
    { "epoch": 1, "loss": 0.0007, "asr": 0.5613 },
    { "epoch": 2, "loss": 0.0045, "asr": 0.0472 },
    { "epoch": 3, "loss": 0.0028, "asr": 0.0566 },
    { "epoch": 4, "loss": 0.0004, "asr": 0.0849 },
    { "epoch": 5, "loss": 0.0007, "asr": 0.0189 }  // BEST
  ]
}
```

---

## attack_handoff_jpeg_index.csv

원본 공격 패키지 인덱스. 세션별 파일 경로 확인용.

| 컬럼 | 설명 |
|------|------|
| `sample_id` | 세션 ID |
| `adv_file` | 적대적 이미지 경로 (패키지 내 상대 경로) |
| `source_file` | 원본 얼굴 이미지 경로 |
| `target_enroll_file` | 인증 대상(사칭 목표) 등록 이미지 경로 |
| `similarity_after_attack` | 공격 후 FaceNet similarity 값 |
| `accepted_after_attack` | 공격 성공 여부 (True=인증 통과) |

---

## sample_id 연결 방법

4개 CSV는 모두 `sample_id`로 JOIN 가능하다:

```python
import pandas as pd

fs  = pd.read_csv('data/verification_defense_feature_squeezing.csv')
ens = pd.read_csv('data/verification_defense_ensemble.csv')
adv = pd.read_csv('data/verification_defense_adv_training.csv')

merged = fs.merge(ens[['sample_id','ensemble_accepted','defense_success']], on='sample_id') \
           .merge(adv[['sample_id','sim_adv_target','defense_success']], on='sample_id', suffixes=('_ens','_adv'))
```
