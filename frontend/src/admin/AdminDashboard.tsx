import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { loadDashboardData, loadDefenseDashboardData, loadHc160DashboardData } from '../data';
import type { FaceAuthVerifyResponse, LoginResponse } from '../api';
import { AttackDashboard } from './AttackDashboard';
import type { AttackFocus } from './AttackDashboard';
import { AuthenticationResults, DefenseAnalysis, ExperimentRecords, Panel, RuntimeResultPanel } from './ResultPanels';
import { attackSummary, ratio } from './model';
import { InfoTooltip, Skeleton } from './Interactions';
import './admin.css';

export interface AdminDashboardProps {
  user: Pick<LoginResponse, 'display_name'>;
  onLogout: () => void;
  /** Optional single runtime response supplied explicitly by the integrator, never fixture data. */
  runtimeResult?: FaceAuthVerifyResponse;
}
const menus = [
  { id: 'overview', title: '개요', subtitle: '주요 결과와 확인할 항목을 한눈에 살펴보세요.', icon: 'home' },
  { id: 'authentication', title: '인증 결과', subtitle: '인증 결과와 세션별 분석 근거를 확인하세요.', icon: 'result' },
  { id: 'attack', title: '공격 분석', subtitle: '공격 조건, 위험도와 탐지 룰의 근거를 확인하세요.', icon: 'shield' },
  { id: 'defense', title: '방어 분석', subtitle: '독립된 방어 실험의 결과와 점수를 비교하세요.', icon: 'chart' },
  { id: 'experiments', title: '실험 기록', subtitle: '원본 산출물과 모델·스키마·버전의 출처를 확인하세요.', icon: 'file' },
] as const;
type Menu = typeof menus[number]['id'];
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10H3Z" /><path d="M9 20v-7h6v7" /></>,
    result: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
    chart: <><path d="M5 20v-7M12 20V8M19 20V3" /></>,
    file: <><path d="M5 3h9l5 5v13H5Z" /><path d="M14 3v6h5M8 13h8M8 17h5" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.result}</svg>;
}
function useDataset<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [attempt, setAttempt] = useState(0);
  const request = useRef<{ attempt: number; promise: Promise<T> }>();
  useEffect(() => {
    let active = true;
    setState(previous => ({ ...previous, loading: true }));
    // Share the in-flight request across StrictMode effect replay, never across users.
    if (request.current?.attempt !== attempt) request.current = { attempt, promise: loader() };
    request.current.promise.then(data => {
      if (active) setState({ data, loading: false });
    }).catch(() => {
      if (active) setState(previous => ({ ...previous, loading: false, error: '데이터를 불러오지 못했습니다.' }));
    });
    return () => { active = false; };
  }, [loader, attempt]);
  return { ...state, retry: () => { if (!state.loading) setAttempt(value => value + 1); } };
}
function DataState({ source, state }: { source: string; state: { error?: string; loading: boolean; retry: () => void } }) {
  return <Panel title={source}>{state.error ? <div role={state.loading ? 'status' : 'alert'}><p>{state.error} 잠시 후 다시 시도해 주세요.</p><button type="button" disabled={state.loading} onClick={state.retry}>{state.loading && <span className="admin-spinner" aria-hidden="true"/>}{state.loading ? '다시 불러오는 중' : '다시 불러오기'}</button></div> : <Skeleton />}</Panel>;
}
export function AdminDashboard({ user, onLogout, runtimeResult }: AdminDashboardProps) {
  const [menu, setMenu] = useState<Menu>('overview');
  const [navOpen, setNavOpen] = useState(false);
  const [attackFocus, setAttackFocus] = useState<AttackFocus>();
  function exploreAttack(selection: Omit<AttackFocus, 'id'> = {}) {
    setAttackFocus(previous => ({ ...selection, id: (previous?.id ?? 0) + 1 }));
    navigate('attack');
  }
  const [visited, setVisited] = useState<Set<Menu>>(() => new Set(['overview']));
  const [cardsEntered, setCardsEntered] = useState(false);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Partial<Record<Menu, number>>>({});
  const navigating = useRef(false);
  useLayoutEffect(() => {
    if (!navigating.current) return;
    title.current?.focus({ preventScroll: true });
    window.scrollTo({ top: scrollPositions.current[menu] ?? 0, behavior: 'instant' });
    navigating.current = false;
  }, [menu]);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const sync = () => {
      if (navigation.current) navigation.current.inert = query.matches && !navOpen;
    };
    sync(); query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [navOpen]);
  const title = useRef<HTMLHeadingElement>(null);
  const attack = useDataset(loadDashboardData);
  const defense = useDataset(loadDefenseDashboardData);
  const hc = useDataset(loadHc160DashboardData);
  const active = menus.find(item => item.id === menu)!;
  const summary = attack.data ? attackSummary(attack.data.attackSessions) : undefined;
  const currentSources = menu === 'authentication' ? [hc] : menu === 'defense' ? [defense] : menu === 'experiments' ? [defense, hc] : [attack];
  const refreshing = currentSources.some(source => source.loading);
  function navigate(next: Menu) {
    document.querySelectorAll<HTMLElement>('.veriface-admin [popover]:popover-open').forEach(element => element.hidePopover());
    setNavOpen(false);
    if (next === menu) { title.current?.focus({ preventScroll: true }); return; }
    scrollPositions.current[menu] = window.scrollY;
    navigating.current = true;
    if (menu === 'overview' && summary) setCardsEntered(true);
    setVisited(previous => new Set([...previous, next]));
    setMenu(next);
  }
  return <div className="veriface-admin">
    <a className="admin-skip" href="#admin-content">본문으로 이동</a>
    <aside className="admin-sidebar">
      <div className="admin-brand"><svg width="40" height="48" viewBox="0 0 40 48" aria-hidden="true"><path d="m2 4 17 10 3 30Z" fill="#BB88FC"/><path d="M38 4 22 44l-3-30Z" fill="#8B5CF6"/></svg><div><strong>VeriFace</strong><small>SECURITY CONSOLE</small></div></div>
      <button ref={menuToggle} type="button" className="admin-menu-toggle" aria-expanded={navOpen} aria-controls="admin-navigation" onClick={() => setNavOpen(!navOpen)}>메뉴 {navOpen ? '닫기' : '열기'}</button>
      <div className={`admin-nav-reveal ${navOpen ? 'is-open' : ''}`}><nav ref={navigation} onKeyDown={event => { if (event.key === 'Escape' && window.matchMedia('(max-width: 760px)').matches) { setNavOpen(false); menuToggle.current?.focus(); } }} id="admin-navigation" className={navOpen ? 'is-open' : ''} aria-label="관리자 메뉴"><span className="admin-nav-indicator" aria-hidden="true" style={{ transform: `translateY(${menus.findIndex(item => item.id === menu) * 64}px)` }} />{menus.map(item => <button type="button" key={item.id} aria-current={menu === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}><Icon name={item.icon}/><span>{item.title}</span></button>)}</nav></div>
      <div className="admin-sidebar-footer"><span>VeriFace Workspace</span><button type="button" onClick={onLogout}>↪ 로그아웃</button></div>
    </aside>
    <main className="admin-main" id="admin-content">
      <header className="admin-header"><div><p className="admin-eyebrow">VERIFACE / OVERVIEW</p><h1 ref={title} tabIndex={-1}>{active.title === '개요' ? '보안 현황' : active.title}</h1><p>{active.subtitle}</p></div><div className="admin-profile"><span className="admin-source-badge">실험 데이터</span><span className="admin-avatar" aria-hidden="true">V</span><div><strong>{user.display_name}</strong><small>관리자</small></div></div></header>
      <div className="admin-refresh"><button type="button" disabled={refreshing} onClick={() => currentSources.forEach(source => source.retry())}>{refreshing && <span className="admin-spinner" aria-hidden="true"/>}{refreshing ? '불러오는 중' : '데이터 새로고침'}</button><span role="status">{refreshing && currentSources.some(source => source.data) ? '기존 결과를 유지하며 갱신 중입니다.' : ''}</span></div>
      {currentSources.filter(source => source.data && source.error).map((source, index) => <DataState key={index} source="데이터 갱신" state={source}/>)}
      <div className="admin-page" data-menu="overview" hidden={menu !== 'overview'}>

        {attack.loading && !attack.data ? <Skeleton cards /> : <div className={`admin-metrics ${summary && !cardsEntered ? 'admin-card-entry' : ''}`} onAnimationEnd={event => { if (event.target === event.currentTarget.lastElementChild) setCardsEntered(true); }}><article className="vf-stat-card"><span><Icon name="result"/>분석 표본</span><strong>{summary ? summary.total.toLocaleString('ko-KR') : '미집계'}</strong><small>공격 데이터셋 · 전체 표본</small><button className="admin-metric-link" type="button" onClick={() => exploreAttack()}>관련 위험 세션 보기 <span aria-hidden="true">↗</span></button></article><article className="vf-stat-card"><span><Icon name="shield"/>공격 후 승인 비율{summary && <InfoTooltip label="공격 후 승인 수치와 분모 보기" text={ratio(summary.accepted, summary.total)} />}</span><strong className="metric-ratio">{summary ? ratio(summary.accepted, summary.total) : '미집계'}</strong><small>방어 전 공격 결과 · 승인 / 전체</small><button className="admin-metric-link" type="button" onClick={() => exploreAttack({ accepted: 'accepted' })}>승인된 위험 세션 보기 <span aria-hidden="true">↗</span></button></article><article className="vf-stat-card"><span><Icon name="chart"/>우선 검토 표본</span><strong>{summary ? summary.review.toLocaleString('ko-KR') : '미집계'}</strong><small>High / Critical · 공격 데이터셋</small><button className="admin-metric-link" type="button" onClick={() => exploreAttack({ review: true })}>우선 검토 시작 <span aria-hidden="true">↗</span></button></article></div>}
        <div className="admin-overview-grid"><div className="admin-primary">
          {attack.data ? <Panel title="공격별 결과" eyebrow="ATTACK SUMMARY"><div className="vf-section-heading"><p className="vf-muted">공격 유형별 표본과 결과를 비교합니다.</p><button type="button" onClick={() => exploreAttack()}>상세 분석 →</button></div><div className="vf-table-wrap" role="region" aria-label="공격별 결과 요약" tabIndex={0}><table><thead><tr><th>공격 유형</th><th>표본 수</th><th>공격 후 승인 / 전체</th><th>High / Critical</th></tr></thead><tbody>{attack.data.familyRows.map(row => <tr key={row.attack_family}><td><span className="admin-family-icon"><Icon name="shield"/></span><button type="button" className="admin-family-drill" onClick={() => exploreAttack({ family: row.attack_family })}>{row.attack_family.toUpperCase()} <span aria-hidden="true">↗</span></button></td><td>{row.sessions.toLocaleString('ko-KR')}</td><td>{ratio(row.accepted_after_attack, row.sessions)}</td><td>{row.high + row.critical}</td></tr>)}</tbody></table></div>{!attack.data.familyRows.length && <p>자료 없음</p>}<p className="admin-table-note">출처: 공격 실험 데이터셋 · 방어 적용 전 결과</p></Panel> : <DataState source="공격 실험" state={attack} />}
          <Panel title="실제 인증 기록" eyebrow="AUTHENTICATION HISTORY"><div className="vf-empty-state"><span className="vf-empty-icon" aria-hidden="true">◎</span><h3>인증 기록 연결을 기다리고 있습니다</h3><p>기록 연동 후 인증 결과를 이곳에서 확인할 수 있습니다.</p><button type="button" onClick={() => navigate('authentication')}>분석 세션 보기 →</button></div></Panel>
        </div><aside className="admin-context"><Panel title="확인이 필요한 항목"><div className="admin-review-item"><span>검토 대기</span><h3>고위험 공격 결과</h3><p>High / Critical로 분류된 표본의 공격 조건과 탐지 근거를 확인하세요.</p><button type="button" onClick={() => exploreAttack({ review: true })}>고위험 세션 살펴보기 →</button></div><div className="admin-review-item"><span>상세 분석</span><h3>게이트 평가 결과</h3><p>단계별 점수와 미평가 항목을 확인하세요.</p></div><button type="button" onClick={() => navigate('authentication')}>결과와 평가 상태 보기 →</button></Panel>
          <Panel title="최근 분석 세션" eyebrow="SESSION HISTORY">{hc.data ? <ul className="admin-recent">{[...hc.data.sessionSummaries].sort((a,b) => b.created_at.localeCompare(a.created_at)).slice(0,3).map(row => <li key={row.session_id}><span className="vf-pill">{row.final_decision}</span><strong>{row.session_id}</strong><small>{row.created_at}</small></li>)}</ul> : <p>{hc.error ?? '분석 기록을 불러오는 중입니다.'}</p>}<button type="button" onClick={() => navigate('experiments')}>출처·실험 기록 →</button></Panel>
          <div className="admin-source-note"><Icon name="file"/><p>데이터 출처와 모델 버전은<br/>실험 기록에서 확인할 수 있습니다.</p></div>
        </aside></div>
      </div>
      <div className="admin-page" data-menu="authentication" hidden={menu !== 'authentication'}>{visited.has('authentication') && <>{runtimeResult && <RuntimeResultPanel result={runtimeResult} />}{hc.data ? <AuthenticationResults data={hc.data} /> : <><Panel title="실제 인증 기록"><p>인증 기록 연결을 기다리고 있습니다.</p></Panel><DataState source="HC160 분석 세션" state={hc} /></>}</>}
      </div>
      <div className="admin-page" data-menu="attack" hidden={menu !== 'attack'}>{visited.has('attack') && (attack.data ? <AttackDashboard data={attack.data} focus={attackFocus} /> : <DataState source="공격 실험" state={attack} />)}
      </div>
      <div className="admin-page" data-menu="defense" hidden={menu !== 'defense'}>{visited.has('defense') && (defense.data ? <DefenseAnalysis data={defense.data} /> : <DataState source="방어 실험" state={defense} />)}
      </div>
      <div className="admin-page" data-menu="experiments" hidden={menu !== 'experiments'}>{visited.has('experiments') && <><ExperimentRecords defense={defense.data} hc={hc.data} />{!defense.data && <DataState source="방어 산출물" state={defense}/>} {!hc.data && <DataState source="HC160 출처" state={hc}/>}</>}
      </div>
      <footer className="admin-footer">VeriFace · Security Console <span>한이음</span></footer>
    </main>
  </div>;
}
