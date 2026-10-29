import type { FaceAuthVerifyResponse } from '../src/api.ts';

// Transport-only test data, never inference evidence or a runtime reference distribution.
export const payload = {
  session: {
    schema_version: '1.0', session_id: 'transport-test', status: 'COMPLETED',
    final_decision: 'STEP_UP', created_at: '2026-10-29T00:00:00Z',
    completed_at: '2026-10-29T00:00:01Z', latency_ms: null, attempt_count: 1,
    query_budget: { used: 1, limit: 20, exceeded: false },
    gates: [
      { gate_id: 'adversarial', status: 'SCORED', role: 'SCORING', display_layer: 'L3',
        latency_ms: null, score: null, threshold: null, reason_code: null,
        provenance: { artifact_id: 'hc160-runtime', artifact_version: 'unknown',
          model_version: 'runtime', policy_version: 'face-auth-policy-v1' } },
      { gate_id: 'unmapped', status: 'NOT_EVALUATED', role: 'BLOCKING', display_layer: null,
        latency_ms: null, score: null, threshold: null, reason_code: null,
        provenance: { artifact_id: 'hc160-runtime', artifact_version: 'unknown',
          model_version: 'runtime', policy_version: 'face-auth-policy-v1' } },
    ],
    decision_provenance: { source: 'hc160_runtime', security_profile: 'FULL',
      calibration_artifact_id: null,
      runtime_identity: { backend_commit: 'unknown', backend_dirty: null,
        web_commit: 'unknown', web_dirty: null } },
  },
  authorized: false, account_authenticated: false, token_id: null,
  user_message: 'test only', next_action: 'step_up', solutions: [], attack_detected: false,
} satisfies FaceAuthVerifyResponse;

export const session = { session_id: 'transport-test', nonce: 'test-only', challenge: '', expires_in_sec: 30 };

