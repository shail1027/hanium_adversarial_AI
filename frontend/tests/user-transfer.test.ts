import assert from 'node:assert/strict';
import test from 'node:test';
import type { FaceAuthVerifyResponse } from '../src/api.ts';
import { TransferLedger, validateDraft } from '../src/user/transfer.ts';
import { payload } from './api-contract.fixture.ts';

// ACCEPT is a transport/state-machine double, never evidence of real FULL inference.
const draft = { recipient: '친구', account: '123-456-789', amount: '30000' };
const consumed = { consumed: true, account_authenticated: false };
function result(sessionId = 'current-session', decision: FaceAuthVerifyResponse['session']['final_decision'] = 'ACCEPT', token: string | null = 'test-token'): FaceAuthVerifyResponse {
  return { ...payload, session: { ...payload.session, session_id: sessionId, final_decision: decision }, token_id: token };
}
function pending() {
  const ledger = new TransferLedger();
  const request = ledger.begin(draft);
  assert.equal(ledger.bind(request, 'current-session'), true);
  return { ledger, request };
}
function unchanged(ledger: TransferLedger) {
  assert.equal(ledger.balance, 2450000);
  assert.deepEqual(ledger.transactions, []);
}

test('transfer rejects missing recipient/account, malformed amount, and insufficient demo balance', () => {
  assert.equal(validateDraft(draft, 30000), null);
  assert.ok(validateDraft({ ...draft, recipient: ' ' }, 30000));
  for (const account of ['', '1234', '1----', '한글계좌', '12345<script>']) assert.ok(validateDraft({ ...draft, account }, 30000));
  for (const amount of ['', '0', '-1', '1.5', 'NaN', '1e3', ' 1', '01', '9'.repeat(20)]) {
    assert.ok(validateDraft({ ...draft, amount }, 30000), amount);
  }
  assert.ok(validateDraft(draft, 29999));
  assert.throws(() => new TransferLedger().begin({ ...draft, amount: '2450001' }));
});

test('matching ACCEPT does not debit until consumed=true and commits one immutable draft receipt', () => {
  const { ledger, request } = pending();
  assert.equal(ledger.complete(request, 'test-token', consumed), null);
  assert.equal(ledger.accept(request, result()), true);
  unchanged(ledger);
  const receipt = ledger.complete(request, 'test-token', consumed);
  assert.ok(receipt);
  assert.equal(receipt.recipient, '친구');
  assert.equal(receipt.amount, 30000);
  assert.equal(receipt.id, 'current-session');
  assert.ok(Number.isFinite(Date.parse(receipt.createdAt)));
  assert.equal(ledger.balance, 2420000);
  assert.deepEqual(ledger.transactions, [receipt]);
  assert.equal(ledger.complete(request, 'test-token', consumed), null);
  assert.equal(ledger.accept(request, result()), false);
  assert.equal(ledger.balance, 2420000);
  assert.equal(ledger.transactions.length, 1);
});

test('STEP_UP, REJECT, ERROR and missing tokens never authorize a receipt', () => {
  for (const decision of ['STEP_UP', 'REJECT', 'ERROR'] as const) {
    const { ledger, request } = pending();
    assert.equal(ledger.accept(request, result('current-session', decision)), false);
    assert.equal(ledger.complete(request, 'test-token', consumed), null);
    unchanged(ledger);
  }
  for (const token of [null, '', ' ']) {
    const { ledger, request } = pending();
    assert.equal(ledger.accept(request, result('current-session', 'ACCEPT', token)), false);
    assert.equal(ledger.complete(request, token ?? '', consumed), null);
    unchanged(ledger);
  }
});

test('failed consume and unexpected account authorization never complete a transfer', () => {
  for (const response of [{ consumed: false, account_authenticated: false }, { consumed: true, account_authenticated: true }]) {
    const { ledger, request } = pending();
    assert.equal(ledger.accept(request, result()), true);
    assert.equal(ledger.complete(request, 'test-token', response), null);
    unchanged(ledger);
  }
  for (const outcome of [{ ...result(), authorized: true }, { ...result(), account_authenticated: true }]) {
    const { ledger, request } = pending();
    assert.equal(ledger.accept(request, outcome as unknown as FaceAuthVerifyResponse), false);
    unchanged(ledger);
  }
});

test('results and tokens from another session cannot complete current transfer', () => {
  const { ledger, request } = pending();
  assert.equal(ledger.accept(request, result('other-session')), false);
  assert.equal(ledger.bind(request, 'other-session'), false);
  assert.equal(ledger.accept(request, result()), true);
  assert.equal(ledger.accept(request, result()), false);
  assert.equal(ledger.complete(request, 'another-token', consumed), null);
  unchanged(ledger);
});

test('cancel ignores late verification and late consume responses', () => {
  const lateVerify = pending();
  lateVerify.ledger.cancel();
  assert.equal(lateVerify.ledger.accept(lateVerify.request, result()), false);
  assert.equal(lateVerify.ledger.complete(lateVerify.request, 'test-token', consumed), null);
  unchanged(lateVerify.ledger);
  const lateConsume = pending();
  assert.equal(lateConsume.ledger.accept(lateConsume.request, result()), true);
  lateConsume.ledger.cancel();
  assert.equal(lateConsume.ledger.complete(lateConsume.request, 'test-token', consumed), null);
  unchanged(lateConsume.ledger);
});

test('new transfer invalidates old request even when server reuses a session id', () => {
  const { ledger, request: old } = pending();
  assert.equal(ledger.accept(old, result()), true);
  const current = ledger.begin({ ...draft, amount: '50000' });
  assert.equal(ledger.bind(current, 'current-session'), true);
  assert.equal(ledger.complete(old, 'test-token', consumed), null);
  assert.equal(ledger.accept(old, result()), false);
  assert.equal(ledger.complete(current, 'test-token', consumed), null);
  unchanged(ledger);
});

test('editing original draft cannot alter an authentication request already started', () => {
  const ledger = new TransferLedger();
  const editable = { ...draft };
  const request = ledger.begin(editable);
  editable.recipient = '다른 사람';
  editable.amount = '100000';
  assert.equal(ledger.bind(request, 'current-session'), true);
  assert.equal(ledger.accept(request, result()), true);
  const receipt = ledger.complete(request, 'test-token', consumed);
  assert.equal(receipt?.recipient, draft.recipient);
  assert.equal(receipt?.amount, 30000);
});
