import type { AttackFamily, RiskLevel, RiskSession, HcSessionSummary, HcGateResult, HcGateStatus } from '../types';

export function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? '미집계' : `${(numerator / denominator * 100).toFixed(2)}% (${numerator.toLocaleString('ko-KR')} / ${denominator.toLocaleString('ko-KR')})`;
}
export function attackSummary(rows: RiskSession[]) {
  return { total: rows.length, accepted: rows.filter(row => row.accepted_after_attack).length,
    review: rows.filter(row => row.risk_level === 'high' || row.risk_level === 'critical').length };
}
export function filterAttacks<T extends RiskSession>(rows: T[], risk: RiskLevel | 'all', family: AttackFamily | 'all', accepted: 'all' | 'accepted' | 'rejected') {
  return rows.filter(row => (risk === 'all' || row.risk_level === risk)
    && (family === 'all' || row.attack_family === family)
    && (accepted === 'all' || row.accepted_after_attack === (accepted === 'accepted')));
}
export function filterHistory(rows: HcSessionSummary[], filter: string, failedGate: string) {
  return rows.filter(row => (filter === 'all' || (filter === 'step_up' ? row.step_up : filter === 'error' ? row.has_error : row.final_decision === filter))
    && (!failedGate || row.failed_gate === failedGate));
}
export function gateLayer(gate: HcGateResult) {
  return gate.display_layer === null ? '미분류 (null)' : gate.display_layer ?? '미제공';
}
export function gateStatusLabel(status: HcGateStatus) {
  return status === 'SCORED' ? 'SCORED · 점수 산출' : status === 'NOT_EVALUATED' ? 'NOT_EVALUATED · 미평가' : status;
}
export function displayValue(value: unknown): string {
  if (value === null) return '자료 없음 (null)';
  if (value === undefined) return '미제공';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}
