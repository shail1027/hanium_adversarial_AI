export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type AttackFamily = 'pgd' | 'fgsm' | 'square' | 'adaptive';
export type HcSessionStatus = 'CREATED' | 'RUNNING' | 'COMPLETED' | 'ERROR' | 'EXPIRED';
export type HcFinalDecision = 'ACCEPT' | 'STEP_UP' | 'REJECT' | 'ERROR';
export type HcGateStatus = 'PASS' | 'FAIL' | 'ERROR' | 'TIMEOUT' | 'NOT_EVALUATED' | 'SKIPPED' | 'UNAVAILABLE';
export type HcGateRole = 'BLOCKING' | 'SCORING' | 'ESCALATION';
export type HcSystemStatus = 'OK' | 'MEASUREMENT_PENDING' | 'NOT_EVALUATED' | 'BLOCKED' | 'DEGRADED';

export interface DashboardOverview {
  total_sessions: number;
  accepted_after_attack: number;
  attack_accept_rate: number;
  critical_sessions: number;
  high_or_critical_sessions: number;
  high_or_critical_rate: number;
  avg_risk_score: number;
  attack_family_counts: Record<AttackFamily, number>;
  risk_level_counts: Record<RiskLevel, number>;
}

export interface AttackFamilyRow {
  attack_family: AttackFamily;
  sessions: number;
  accepted_after_attack: number;
  attack_accept_rate: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  avg_risk_score: number;
}

export interface RuleDefinition {
  id: string;
  name: string;
  severity: RiskLevel;
  description: string;
}

export interface RuleDefinitionFile {
  version: number;
  domain: string;
  rules: RuleDefinition[];
}

export interface RuleHitSummary {
  rule_id: string;
  sessions: number;
  accepted_after_attack: number;
  attack_accept_rate: number;
}

export interface RiskSession {
  session_id: string;
  timestamp: string;
  account_id: string;
  source_identity: string;
  target_identity: string;
  attack_family: AttackFamily;
  epsilon: number;
  similarity_before: number;
  similarity_after_attack: number;
  threshold_margin: number;
  accepted_after_attack: boolean;
  risk_score: number;
  risk_level: RiskLevel;
  rule_hits: string;
  adv_file: string;
}

export interface AttackSession extends RiskSession {
  attempt_id: string;
  pair_id: string;
  attack: string;
  is_adaptive: boolean;
  alpha: number | null;
  steps: number | null;
  queries_used: number | null;
  similarity_gain: number;
  threshold: number;
  accepted_before: boolean;
  attack_success_before_defense: boolean;
  source_file: string;
  target_enroll_file: string;
  perturbation_file: string;
  l2: number | null;
  linf: number | null;
  time_sec: number | null;
}

export interface DefenseFeatureSqueezingRow {
  sample_id: string;
  defense: string;
  detection_threshold: number;
  accepted_after_attack: boolean;
  is_attack_detected: boolean;
  n_squeezers_detected: number;
  max_sim_diff: number;
  risk_score_add: number;
  lr_sim_original: number;
  lr_sim_squeezed: number;
  lr_sim_diff: number;
  lr_detected: boolean;
  cd_sim_original: number;
  cd_sim_squeezed: number;
  cd_sim_diff: number;
  cd_detected: boolean;
  mf_sim_original: number;
  mf_sim_squeezed: number;
  mf_sim_diff: number;
  mf_detected: boolean;
  defense_time_sec: number;
}

export interface DefenseEnsembleRow {
  sample_id: string;
  defense: string;
  roi_accepted: boolean;
  smoothing_accepted: boolean;
  randomized_accepted: boolean;
  ensemble_votes: string;
  ensemble_accepted: boolean;
  accepted_after_attack: boolean;
  attack_success_after_defense: boolean;
  defense_success: boolean;
}

export interface DefenseAdvTrainingRow {
  sample_id: string;
  defense: string;
  defense_params: string;
  threshold: number;
  similarity_after_attack: number;
  sim_adv_target: number;
  sim_adv_source: number;
  accepted_after_attack: boolean;
  accepted_after_defense: boolean;
  attack_success_after_defense: boolean;
  defense_success: boolean;
}

export interface DefenseHandoffRow {
  sample_id: string;
  pair_id: string;
  attack: string;
  model: string;
  pretrained: string;
  source_file: string;
  target_enroll_file: string;
  adv_file: string;
  perturbation_file: string;
  source_name: string;
  target_name: string;
  threshold: number;
  similarity_before: number;
  similarity_after_attack: number;
  similarity_gain: number;
  accepted_before: boolean;
  accepted_after_attack: boolean;
  attack_success_before_defense: boolean;
  epsilon: number;
  alpha: number;
  steps: number;
  l2: number;
  linf: number;
  time_sec: number;
}

export interface TrainingHistory {
  asr_before: number;
  asr_best: number;
  epochs: number;
  lr: number;
  margin: number;
  history: Array<{
    epoch: number;
    loss: number;
    asr: number;
  }>;
}

export interface HcProvenance {
  artifact_id: string;
  artifact_version: string;
  model_version: string;
  policy_version: string;
}

export interface HcGateResult {
  gate_id: string;
  label?: string;
  status: HcGateStatus;
  role: HcGateRole;
  latency_ms: number | null;
  score: string | number | null;
  threshold: string | number | null;
  provenance: HcProvenance;
  reason_code: string | null;
}

export interface HcSessionResult {
  schema_version: string;
  session_id: string;
  status: HcSessionStatus;
  final_decision: HcFinalDecision;
  created_at: string;
  completed_at: string | null;
  latency_ms: number | null;
  attempt_count: number;
  query_budget: {
    used: number;
    limit: number;
    exceeded: boolean;
  };
  gates: HcGateResult[];
  decision_provenance: {
    policy_version: string;
    calibration_artifact_id: string;
    production_model_version: string;
  };
  audit?: {
    audit_log_id: string;
    result_stored: boolean;
    operator_view: boolean;
  };
}

export interface HcSessionSummary {
  session_id: string;
  created_at: string;
  status: HcSessionStatus;
  final_decision: HcFinalDecision;
  latency_ms: number | null;
  attempt_count: number;
  step_up: boolean;
  has_error: boolean;
  failed_gate: string | null;
  policy_version: string;
  model_version: string;
  artifact_version: string;
}

export interface HcSystemStatusRow {
  component: string;
  status: HcSystemStatus;
  last_ok_at: string;
  error_count: number;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
}
