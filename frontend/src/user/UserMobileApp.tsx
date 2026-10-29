import { useEffect, useRef } from 'react';
import type { LoginResponse } from '../api';
import { useUserMotion } from './useUserMotion';
import { useTransfer } from './useTransfer';
import './user-mobile.css';

export interface UserMobileAppProps {
  user: LoginResponse;
  onLogout: () => void;
}

function Icon({ name }: { name: 'home' | 'send' | 'person' | 'back' | 'check' | 'arrow' }) {
  const paths = {
    home: 'm3 10 9-7 9 7v10H15v-6H9v6H3Z',
    send: 'm21 3-7 18-4-7-7-4 18-7ZM10 14l11-11',
    person: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2Z',
    back: 'm14 5-7 7 7 7',
    check: 'm5 12 5 5L20 7',
    arrow: 'm9 5 7 7-7 7',
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} pathLength={name === 'check' ? 1 : undefined} /></svg>;
}

const won = (amount: number) => `${amount.toLocaleString('ko-KR')}원`;
const date = (value: string) => new Date(value).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function UserMobileApp({ user, onLogout }: UserMobileAppProps) {
  const flow = useTransfer();
  const heading = useRef<HTMLHeadingElement>(null);
  const main = useRef<HTMLElement>(null);
  const { screen, draft, balance, context, working, receipt } = flow;
  useUserMotion(main, screen, working, receipt?.id, flow.transactions.map(item => item.id));
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [screen]);
  const title = screen === 'input' ? '어디로 보낼까요?' : screen === 'confirm' ? '송금 정보를 확인해 주세요' : screen === 'capture' ? '본인 확인' : screen === 'profile' ? '내 정보' : screen === 'receipt' ? '송금 완료' : '내 돈을 한눈에';
  const navigate = (next: 'home' | 'input' | 'profile') => { flow.setScreen(next); };
  const back = () => {
    if (screen === 'capture') flow.cancel();
    else flow.setScreen(screen === 'confirm' ? 'input' : 'home');
  };
  const recent = flow.transactions.filter((item, i, all) => all.findIndex((other) => other.account === item.account) === i).slice(0, 3);
  return (
    <div className={`vf-user${working ? ' vf-user--working' : ''}${flow.illumination ? ' vf-user--illuminated' : ''}`} style={flow.illumination ? { background: flow.illumination } : undefined}>
      <div className="vf-user__shell">
        <header className="vf-user__header">
          {screen === 'home' ? <a className="vf-user__brand" href="#veriface-home" onClick={(event) => { event.preventDefault(); navigate('home'); }}><span className="vf-user__mark" aria-hidden="true">V</span>VeriFace</a> : <button type="button" className="vf-user__icon-button" aria-label={screen === 'confirm' || screen === 'capture' ? '이전 화면으로 돌아가기' : '홈으로 돌아가기'} onClick={back}><Icon name="back" /></button>}
          {screen === 'home' && <button type="button" className="vf-user__avatar vf-user__profile-button" aria-label="내 정보 보기" onClick={() => navigate('profile')}><Icon name="person" /></button>}
        </header>
        <main ref={main} id="veriface-home" className={`vf-user__main vf-user__main--${screen}`}>
          {screen === 'home' && <p className="vf-user__greeting">{user.display_name}님, 안녕하세요</p>}
          <h1 ref={heading} tabIndex={-1}>{title}</h1>
          {screen === 'home' && <>
            <section className="vf-user__account" aria-label="계좌">
              <div className="vf-user__row"><span>내 계좌</span><span className="vf-user__account-dot" aria-hidden="true" /></div>
              <strong className="vf-user__balance">{won(balance)}</strong>
              <p>Veri 계좌 · 1234</p>
              <button type="button" className="vf-user__primary" onClick={() => navigate('input')}>송금하기 <Icon name="arrow" /></button>
            </section>
            <section className="vf-user__section"><h2>최근 보낸 사람</h2>{recent.length ? <div className="vf-user__recipients">{recent.map((item) => <button type="button" key={item.account} onClick={() => { flow.setDraft({ recipient: item.recipient, account: item.account, amount: '' }); navigate('input'); }}><span className="vf-user__avatar"><Icon name="person" /></span><span>{item.recipient}</span></button>)}</div> : <p className="vf-user__muted">첫 송금을 마치면 여기에 표시돼요.</p>}</section>
            <section className="vf-user__section vf-user__history"><div className="vf-user__row"><h2>최근 거래</h2><span className="vf-user__muted">송금 내역</span></div>{flow.transactions.length ? <ul>{flow.transactions.map((item) => <li key={item.id} data-transaction-id={item.id}><span className="vf-user__avatar"><Icon name="person" /></span><div><strong>{item.recipient}님에게 송금</strong><small>{date(item.createdAt)}</small></div><b>− {won(item.amount)}</b></li>)}</ul> : <div className="vf-user__empty"><Icon name="send" /><p>아직 송금 내역이 없어요</p><span>첫 송금을 시작해 보세요.</span></div>}</section>
          </>}
          {screen === 'input' && <form className="vf-user__form" onSubmit={(event) => { event.preventDefault(); flow.submitDraft(); }}>
            <p className="vf-user__muted">받는 사람과 계좌, 보낼 금액을 입력해 주세요.</p>
            <label>받는 사람<input name="recipient" autoComplete="off" value={draft.recipient} maxLength={40} onChange={(event) => flow.setDraft({ ...draft, recipient: event.target.value })} placeholder="이름" required /></label>
            <label>받는 계좌<input name="account" autoComplete="off" inputMode="numeric" value={draft.account} maxLength={40} onChange={(event) => flow.setDraft({ ...draft, account: event.target.value })} placeholder="계좌번호" required /></label>
            <label>보낼 금액<div className="vf-user__amount-field"><input name="amount" autoComplete="off" inputMode="numeric" value={draft.amount} onChange={(event) => flow.setDraft({ ...draft, amount: event.target.value })} placeholder="0" aria-describedby="vf-user-balance" required /><span>원</span></div></label>
            <p id="vf-user-balance" className="vf-user__muted">보낼 수 있는 잔액 {won(balance)}</p>
            {flow.error && <p className="vf-user__error" role="alert">{flow.error}</p>}
            <button type="submit" className="vf-user__primary">다음 <Icon name="arrow" /></button>
          </form>}
          {screen === 'confirm' && <>
            <div className="vf-user__transfer-summary"><span className="vf-user__avatar vf-user__avatar--large"><Icon name="person" /></span><p>{draft.recipient}님에게</p><strong>{won(Number(draft.amount))}</strong><span>보낼까요?</span></div>
            <dl className="vf-user__details"><div><dt>받는 계좌</dt><dd>{draft.account}</dd></div><div><dt>보낼 금액</dt><dd>{won(Number(draft.amount))}</dd></div><div><dt>수수료</dt><dd>0원</dd></div></dl>
            <p className="vf-user__muted">이 송금 정보를 확인한 뒤 얼굴 인증으로 승인합니다. 처음 이용하면 얼굴 등록부터 진행해요.</p>
            <button type="button" className="vf-user__primary" onClick={flow.openCapture}>얼굴로 확인하기 <Icon name="arrow" /></button>
            <button type="button" className="vf-user__secondary" onClick={() => flow.setScreen('input')}>송금 정보 수정</button>
          </>}
          {screen === 'capture' && <>
            <p className="vf-user__capture-transfer">{draft.recipient}님에게 <strong>{won(Number(draft.amount))}</strong><span className="vf-user__capture-account">받는 계좌 {draft.account}</span></p>
            <h2 className="vf-user__capture-title">{context?.registered ? '얼굴로 확인할게요' : '먼저 얼굴을 등록할게요'}</h2>
            <p className="vf-user__capture-copy">{working ? flow.processingStatus : '촬영 시작을 누르면 카메라 권한을 요청해요.'}</p>
            <div className="vf-user__camera"><video ref={flow.videoRef} muted playsInline aria-label="얼굴 촬영 미리보기" /><div className="vf-user__camera-guide" aria-hidden="true" />{!working && <span className="vf-user__camera-placeholder"><Icon name="person" /><span>얼굴을 안내선 안에 맞춰 주세요</span></span>}</div>
            <p className="vf-user__challenge" role="status">{flow.challenge || (working ? '카메라를 준비하고 있어요.' : '얼굴 등록과 송금 인증은 각각 촬영합니다.')}</p>
            {flow.loadingContext && <p className="vf-user__loading" role="status"><span className="vf-user__spinner" aria-hidden="true" />등록 상태를 확인하고 있어요.</p>}
            {!flow.loadingContext && !context && <button type="button" className="vf-user__secondary" onClick={() => void flow.reloadContext()}>등록 상태 다시 확인</button>}
            {context?.blockers.length ? <details className="vf-user__technical"><summary>현재 촬영할 수 없는 이유</summary><ul>{context.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></details> : null}
            {flow.error && <p className="vf-user__error" role="alert">{flow.error}</p>}
            <button type="button" className="vf-user__primary" aria-busy={working} disabled={working || !context?.ready || flow.loadingContext} onClick={() => void flow.capture(context?.registered ? 'authenticate' : 'enroll')}>{working ? <><span className="vf-user__spinner" aria-hidden="true" />{flow.processingStatus}</> : context?.registered ? '송금 얼굴 인증 시작' : '얼굴 최초 등록 시작'}</button>
            <button type="button" className="vf-user__secondary" onClick={() => { flow.cancel(); flow.setScreen('confirm'); }}>{working ? '촬영 취소' : '송금 정보로 돌아가기'}</button>
            {flow.result && <details className="vf-user__technical"><summary>검사 상세</summary><p>판정: {flow.result.session.final_decision}</p><p>세션: {flow.result.session.session_id}</p><p>{flow.result.user_message}</p><ul>{flow.result.session.gates.map((gate) => <li key={gate.gate_id}>{gate.gate_id} · {gate.status} · {gate.role}<br />{gate.reason_code}</li>)}</ul></details>}
          </>}
          {screen === 'receipt' && receipt && <div className="vf-user__receipt">
            <span className="vf-user__success" aria-hidden="true"><Icon name="check" /></span>
            <p className="vf-user__receipt-person">{receipt.recipient}님에게</p><strong className="vf-user__receipt-amount">{won(receipt.amount)}을 보냈어요</strong>
            <dl className="vf-user__details"><div><dt>받는 계좌</dt><dd>{receipt.account}</dd></div><div><dt>보낸 금액</dt><dd>{won(receipt.amount)}</dd></div><div><dt>수수료</dt><dd>0원</dd></div><div><dt>송금 일시</dt><dd>{date(receipt.createdAt)}</dd></div></dl>
            <button type="button" className="vf-user__primary" onClick={() => navigate('home')}>확인</button>
          </div>}
          {screen === 'profile' && <>
            <div className="vf-user__profile"><span className="vf-user__avatar vf-user__avatar--large"><Icon name="person" /></span><h2>{user.display_name}님</h2><p>VeriFace</p></div>
            <dl className="vf-user__details"><div><dt>계좌</dt><dd>Veri 계좌 · 1234</dd></div><div><dt>얼굴 등록</dt><dd>{flow.loadingContext ? '확인 중' : context ? context.registered ? '등록됨' : '미등록' : '확인하지 못함'}</dd></div></dl>
            <button type="button" className="vf-user__secondary" onClick={() => { flow.cancel(); onLogout(); }}>나가기</button>
          </>}
        </main>
        {(screen === 'home' || screen === 'input' || screen === 'profile') && <nav className="vf-user__nav" aria-label="사용자 메뉴">{([{ screen: 'home', label: '홈', icon: 'home' }, { screen: 'input', label: '송금', icon: 'send' }, { screen: 'profile', label: '내 정보', icon: 'person' }] as const).map((item) => <button type="button" key={item.screen} aria-current={screen === item.screen ? 'page' : undefined} onClick={() => navigate(item.screen)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>}
      </div>
    </div>
  );
}
