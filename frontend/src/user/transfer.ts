import type { FaceAuthVerifyResponse } from '../api';

export type Draft = { recipient: string; account: string; amount: string };
export type Receipt = { id: string; recipient: string; account: string; amount: number; createdAt: string };
export function validateDraft(draft: Draft, balance: number): string | null {
  if (!draft.recipient.trim()) return '받는 사람을 입력해 주세요.';
  if ((!/^[0-9 -]+$/.test(draft.account.trim()) || !/^\d{5,30}$/.test(draft.account.replace(/[ -]/g, '')))) return '계좌번호를 숫자 5~30자로 입력해 주세요.';
  if (!/^[1-9]\d*$/.test(draft.amount) || !Number.isSafeInteger(Number(draft.amount))) return '금액은 1원 이상의 정수로 입력해 주세요.';
  if (Number(draft.amount) > balance) return '시연 잔액보다 많은 금액을 보낼 수 없어요.';
  return null;
}

// The request object is an in-memory capability; a session/result alone cannot complete a transfer.
export class TransferLedger {
  balance = 2450000;
  transactions: Receipt[] = [];
  private current: { draft: Draft; session: string | null; token: string | null } | null = null;
  begin(draft: Draft) {
    const error = validateDraft(draft, this.balance);
    if (error) throw new Error(error);
    this.current = { draft: { ...draft }, session: null, token: null };
    return this.current;
  }
  cancel() { this.current = null; }
  bind(request: NonNullable<TransferLedger['current']>, session: string) {
    if (this.current !== request || !session || request.session) return false;
    request.session = session;
    return true;
  }
  accept(request: NonNullable<TransferLedger['current']>, result: FaceAuthVerifyResponse) {
    if (this.current !== request || !request.session || result.session.session_id !== request.session
      || result.session.final_decision !== 'ACCEPT' || !result.token_id?.trim()
      || result.authorized !== false || result.account_authenticated !== false || request.token) return false;
    request.token = result.token_id;
    return true;
  }
  complete(request: NonNullable<TransferLedger['current']>, token: string, consumed: { consumed: boolean; account_authenticated: boolean }): Receipt | null {
    if (this.current !== request || !request.session || !request.token || token !== request.token
      || consumed.consumed !== true || consumed.account_authenticated !== false) return null;
    const receipt = { id: request.session, recipient: request.draft.recipient.trim(), account: request.draft.account.trim(), amount: Number(request.draft.amount), createdAt: new Date().toISOString() };
    this.current = null;
    this.balance -= receipt.amount;
    this.transactions = [receipt, ...this.transactions];
    return receipt;
  }
}
