import assert from 'node:assert/strict';
import test from 'node:test';
import { ratio, attackSummary, filterAttacks, filterHistory, gateLayer, gateStatusLabel, displayValue } from '../src/admin/model.ts';
import type { AttackSession, HcGateResult, HcSessionSummary } from '../src/types.ts';

const attacks = [
  { session_id: 'a', attack_family: 'pgd', risk_level: 'high', accepted_after_attack: true },
  { session_id: 'b', attack_family: 'fgsm', risk_level: 'low', accepted_after_attack: false },
  { session_id: 'c', attack_family: 'pgd', risk_level: 'critical', accepted_after_attack: false },
] as AttackSession[];
test('ratios retain numerator/denominator and empty data is unaggregated', () => {
  assert.equal(ratio(1, 4), '25.00% (1 / 4)');
  assert.equal(ratio(0, 4), '0.00% (0 / 4)');
  assert.equal(ratio(0, 0), '미집계');
  assert.deepEqual(attackSummary([]), { total: 0, accepted: 0, review: 0 });
  assert.deepEqual(attackSummary(attacks), { total: 3, accepted: 1, review: 2 });
});
test('attack filters intersect without losing original row or showing stale selection', () => {
  assert.deepEqual(filterAttacks(attacks, 'review', 'all', 'all'), [attacks[0], attacks[2]]);
  assert.deepEqual(filterAttacks(attacks, 'review', 'pgd', 'accepted'), [attacks[0]]);
  assert.deepEqual(filterAttacks(attacks, 'high', 'pgd', 'accepted'), [attacks[0]]);
  assert.deepEqual(filterAttacks(attacks, 'low', 'pgd', 'all'), []);
  assert.deepEqual(filterAttacks(attacks, 'all', 'all', 'rejected'), attacks.slice(1));
});
test('history filters preserve decision, step-up, error and failed-gate semantics', () => {
  const rows = [
    { session_id: 'a', final_decision: 'STEP_UP', step_up: true, has_error: false, failed_gate: 'L3' },
    { session_id: 'b', final_decision: 'REJECT', step_up: false, has_error: true, failed_gate: 'L0' },
  ] as HcSessionSummary[];
  assert.deepEqual(filterHistory(rows, 'step_up', ''), [rows[0]]);
  assert.deepEqual(filterHistory(rows, 'error', 'L0'), [rows[1]]);
  assert.deepEqual(filterHistory(rows, 'ACCEPT', ''), []);
});
test('null display layer never infers a layer; score state is not approval', () => {
  assert.equal(gateLayer({ gate_id: 'L3_EXAMPLE', display_layer: null } as HcGateResult), '미분류 (null)');
  assert.equal(gateLayer({ gate_id: 'L0_EXAMPLE' } as HcGateResult), '미제공');
  assert.equal(gateLayer({ display_layer: 'L2b' } as HcGateResult), 'L2b');
  assert.equal(gateStatusLabel('SCORED'), 'SCORED · 점수 산출');
  assert.equal(gateStatusLabel('NOT_EVALUATED'), 'NOT_EVALUATED · 미평가');
  assert.equal(displayValue(null), '자료 없음 (null)');
  assert.equal(displayValue(false), 'false');
  assert.equal(displayValue(0), '0');
});
