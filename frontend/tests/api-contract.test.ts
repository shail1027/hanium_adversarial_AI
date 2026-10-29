import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyFaceAuth } from '../src/api.ts';
import { payload, session } from './api-contract.fixture.ts';

test('face JSON transport preserves domain states, roles, null layers and runtime identity', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(payload), { status: 200 }));
  const response = await verifyFaceAuth(session, 'test-only', new AbortController().signal);
  assert.deepEqual(response, payload);
  assert.ok('session' in response);
  assert.equal(response.session.gates[0].status, 'SCORED');
  assert.equal(response.session.gates[1].status, 'NOT_EVALUATED');
  assert.equal(response.session.gates[1].display_layer, null);
  assert.equal(response.session.schema_version, '1.0');
  assert.equal(response.session.gates[0].provenance.artifact_version, 'unknown');
});

test('error JSON is not converted into success and the HTTP error remains rejected', async (t) => {
  const error = { ...payload, session: { ...payload.session, status: 'ERROR', final_decision: 'ERROR',
    gates: [], query_budget: { used: null, limit: null, exceeded: null } } };
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(error), { status: 200 }));
  assert.deepEqual(await verifyFaceAuth(session, 'test-only', new AbortController().signal), error);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    detail: { code: 'ENROLLMENT_REQUIRED', message: 'Registration required' },
  }), { status: 409 }));
  await assert.rejects(verifyFaceAuth(session, 'test-only', new AbortController().signal), /Registration required/);
});
