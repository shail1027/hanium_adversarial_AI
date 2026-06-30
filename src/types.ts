export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type AttackFamily = 'pgd' | 'fgsm' | 'square' | 'adaptive';

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
