import { useState } from 'react';
import type { ReactNode } from 'react';
import type { loadDefenseDashboardData, loadHc160DashboardData } from '../data';
import type { FaceAuthVerifyResponse } from '../api';
import type { HcGateResult, HcSessionResult } from '../types';
import { displayValue, filterHistory, gateLayer, gateStatusLabel, ratio } from './model';

type DefenseData = Awaited<ReturnType<typeof loadDefenseDashboardData>>;
type HcData = Awaited<ReturnType<typeof loadHc160DashboardData>>;

export function Panel({ title, eyebrow, children }: { title: string; eyebrow?: string; children: ReactNode }) {
  return <section className="vf-panel"><div className="vf-section-heading"><div>{eyebrow && <p>{eyebrow}</p>}<h2>{title}</h2></div></div>{children}</section>;
}
export function Fields({ value }: { value: object }) {
  return <dl className="vf-detail-grid">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{displayValue(item)}</dd></div>)}</dl>;
}
export function GateResults({ gates }: { gates: HcGateResult[] }) {
  return <Panel title="게이트 결과" eyebrow="GATE EVIDENCE">
    <p className="vf-muted">SCORED는 점수 산출 상태입니다. 최종 승인과 다릅니다. 미평가·미분류는 원본 그대로 표시합니다.</p>
    {!gates.length && <p role="status">게이트 자료 없음</p>}
    <div className="vf-gate-list">{gates.map(gate => <article className="vf-gate-card" key={gate.gate_id}>
      <div className="vf-section-heading"><div><small>{gateLayer(gate)}</small><h3>{gate.gate_id}</h3><p>{gate.label}</p></div><span className="vf-pill">{gateStatusLabel(gate.status)}</span></div>
      <Fields value={{ role: gate.role, score: gate.score, threshold: gate.threshold, latency_ms: gate.latency_ms, reason_code: gate.reason_code }} />
      <details><summary>provenance · 실행 artifact / 모델 / 정책</summary><Fields value={gate.provenance} /></details>
    </article>)}</div>
  </Panel>;
}
function StaticSessionDetail({ result }: { result: HcSessionResult }) {
  return <><Panel title={result.session_id} eyebrow="SESSION DETAIL">
    <Fields value={{ status: result.status, final_decision: result.final_decision, schema_version: result.schema_version, created_at: result.created_at, completed_at: result.completed_at, latency_ms: result.latency_ms, attempt_count: result.attempt_count }} />
    <h3>질의 예산</h3><Fields value={result.query_budget} />
    {result.final_decision === 'STEP_UP' && <p className="admin-notice">추가 인증 필요 · 기록된 잔여 질의 예산: {Math.max(0, result.query_budget.limit - result.query_budget.used)}. </p>}
    <details><summary>판정 출처·감사 정보</summary><Fields value={result.decision_provenance} />{result.audit && <Fields value={result.audit} />}</details>
    <details><summary>결과 출처·인증 범위</summary><p>HC160 fixture 결과입니다. 토큰 소비 상태는 미제공이며 실제 계정 인증이나 권한 부여를 의미하지 않습니다.</p></details>
  </Panel><GateResults gates={result.gates} /></>;
}
/** Explicit runtime input only. Never converted to or loaded through the static fixture contract. */
export function RuntimeResultPanel({ result }: { result: FaceAuthVerifyResponse }) {
  return <div className="admin-runtime"><Panel title="전달받은 실제 얼굴 API 결과" eyebrow="RUNTIME · 단일 응답">
    <p>관리자 이력 API 연결이 아닙니다. 토큰 소비는 이 화면에서 수행하거나 추정하지 않습니다.</p>
    <Fields value={{ session_id: result.session.session_id, status: result.session.status, final_decision: result.session.final_decision, schema_version: result.session.schema_version, authorized: result.authorized, account_authenticated: result.account_authenticated, user_message: result.user_message }} />
    <Fields value={result.session.query_budget} /><h3>decision_provenance</h3><Fields value={result.session.decision_provenance} />
    <p>토큰 소비 상태: 미제공 · 실제 FULL 정상 승인과 공격 방어 성능의 검증 완료를 의미하지 않습니다.</p>
  </Panel><GateResults gates={result.session.gates} /></div>;
}
export function AuthenticationResults({ data }: { data: HcData }) {
  const [filter, setFilter] = useState('all');
  const [failedGate, setFailedGate] = useState('');
  const [selected, setSelected] = useState(data.sessionResult.session_id);
  const rows = filterHistory(data.sessionSummaries, filter, failedGate);
  const selectedRow = rows.find(row => row.session_id === selected) ?? rows[0];
  const detail = selectedRow?.session_id === data.sessionResult.session_id ? data.sessionResult : undefined;
  return <>
    <Panel title="실제 인증 기록" eyebrow="LIVE HISTORY"><div className="vf-empty-state"><span className="vf-empty-icon" aria-hidden="true">◎</span><h3>인증 기록 연결을 기다리고 있습니다</h3><p>기록 연동 후 인증 결과를 이곳에서 확인할 수 있습니다.</p></div></Panel>
    <Panel title="분석 세션" eyebrow="HC160 · SESSION HISTORY">
      <p className="vf-muted">hc160/session-summaries.json · {rows.length} / {data.sessionSummaries.length}개 표시 · 기록 데이터</p>
      <div className="admin-controls"><label>판정 / 이벤트<select value={filter} onChange={event => setFilter(event.target.value)}>{['all', 'ACCEPT', 'STEP_UP', 'REJECT', 'ERROR', 'step_up', 'error'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>실패 게이트<select value={failedGate} onChange={event => setFailedGate(event.target.value)}><option value="">전체</option>{[...new Set(data.sessionSummaries.flatMap(row => row.failed_gate ? [row.failed_gate] : []))].map(value => <option key={value}>{value}</option>)}</select></label></div>
      <div className="vf-table-wrap" role="region" aria-label="분석 세션 목록" tabIndex={0}><table><thead><tr>{['세션 선택', '기록 시각', '처리 상태', '최종 판정', '오류 / STEP-UP', '실패 게이트', 'latency / 시도'].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.session_id} className={row.session_id === selectedRow?.session_id ? 'selected' : ''}><td><button type="button" aria-pressed={row.session_id === selectedRow?.session_id} onClick={() => setSelected(row.session_id)}>{row.session_id}</button></td><td>{row.created_at}</td><td>{row.status}</td><td><span className="vf-pill">{row.final_decision}</span></td><td>{String(row.has_error)} / {String(row.step_up)}</td><td>{displayValue(row.failed_gate)}</td><td>{displayValue(row.latency_ms)} ms / {row.attempt_count}</td></tr>)}</tbody></table></div>
      {!rows.length && <p role="status">조건에 맞는 세션이 없습니다.</p>}
    </Panel>
    {selectedRow && <Panel title="선택한 세션 요약·버전"><Fields value={selectedRow} />{!detail && <p className="admin-notice">이 세션의 상세 결과는 제공되지 않습니다.</p>}</Panel>}
    {detail && <StaticSessionDetail result={detail} />}
  </>;
}
function DatasetTable({ rows, label }: { rows: object[]; label: string }) {
  if (!rows.length) return <p role="status">자료 없음</p>;
  const columns = Object.keys(rows[0]);
  return <div className="vf-table-wrap" role="region" aria-label={label} tabIndex={0}><table><thead><tr>{columns.map(key => <th key={key}>{key}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map(key => <td key={key}>{displayValue((row as Record<string, unknown>)[key])}</td>)}</tr>)}</tbody></table></div>;
}
export function DefenseAnalysis({ data }: { data: DefenseData }) {
  const groups = [
    { title: '앙상블 투표', file: 'verification_defense_ensemble.csv', rows: data.ensemble, numerator: data.ensemble.filter(row => !row.ensemble_accepted).length, metric: '앙상블 거절', note: 'ROI / Smoothing / Randomized 투표 결과' },
    { title: '적대적 학습', file: 'verification_defense_adv_training.csv', rows: data.advTraining, numerator: data.advTraining.filter(row => row.defense_success).length, metric: 'defense_success', note: '방어 적용 후 승인 여부와 방어 성공 결과' },
    { title: '특징 압축 포렌식', file: 'verification_defense_feature_squeezing.csv', rows: data.featureSqueezing, numerator: data.featureSqueezing.filter(row => row.is_attack_detected).length, metric: '공격 신호 탐지', note: 'Low Resolution / Color Depth / Median Filter 측정값 · 탐지와 차단은 별도 결과입니다.' },
  ];
  return <><p className="vf-muted">방어 기법별 실험 결과 · 비율은 각 데이터셋의 표본을 기준으로 계산합니다.</p>
    <div className="admin-metrics">{groups.map(group => <article className="vf-stat-card" key={group.file}><span>{group.title} · {group.metric}</span><strong>{ratio(group.numerator, group.rows.length)}</strong><small>해당 CSV 행 기준</small></article>)}</div>
    {groups.map(group => <Panel title={group.title} eyebrow={group.file} key={group.file}><p>{group.note}</p><p className="vf-muted">{group.rows.length}개 실험 행 · 원본 결과와 점수 · 전 행 표시</p><DatasetTable rows={group.rows} label={group.title} /></Panel>)}
    <Panel title="특징 압축별 탐지 비교"><div className="admin-metrics">{(['lr_detected', 'cd_detected', 'mf_detected'] as const).map(key => <article className="vf-stat-card" key={key}><span>{key}</span><strong>{ratio(data.featureSqueezing.filter(row => row[key]).length, data.featureSqueezing.length)}</strong></article>)}</div><p className="vf-muted">risk_score_add: 데이터셋에 기록된 위험 점수</p></Panel>
    <Panel title="학습 기록" eyebrow="training_history.json"><Fields value={{ epochs: data.trainingHistory.epochs, lr: data.trainingHistory.lr, margin: data.trainingHistory.margin, asr_before: data.trainingHistory.asr_before, asr_best: data.trainingHistory.asr_best }} /><p className="vf-muted">ASR은 원본 기록값입니다. 학습 모집단의 분모가 제공되지 않아 운영 성공률로 환산하지 않습니다.</p><DatasetTable rows={data.trainingHistory.history} label="epoch별 학습 기록" /></Panel>
  </>;
}
export function ExperimentRecords({ defense, hc }: { defense?: DefenseData; hc?: HcData }) {
  return <><Panel title="데이터 출처" eyebrow="RESEARCH ARTIFACTS"><div className="vf-source-list"><article><h3>forensics / CSV·JSON</h3><p>공격 실험, 위험 세션, 탐지 룰. 실험 계정과 타임스탬프입니다.</p></article><article><h3>defense / CSV·JSON</h3><p>앙상블·적대적 학습·특징 압축의 독립 실험 결과와 학습 기록.</p></article><article><h3>hc160 / JSON fixture</h3><p>세션·게이트·시스템 상태 시연. API를 통해 읽어도 정적 자료입니다.</p></article></div><details><summary>데이터 연결·검증 범위</summary><p>실시간 인증 이력 API는 미연결입니다. 모의 로그인은 실제 관리자 권한 통제가 아닙니다. 실제 FULL 정상 승인 및 공격 방어 성능 검증은 완료되지 않았습니다. 시간적 일관성의 방어 실험 결과는 제공되지 않습니다.</p></details></Panel>
    {hc && <><Panel title="정적 fixture의 스키마·출처"><Fields value={{ schema_version: hc.sessionResult.schema_version, ...hc.sessionResult.decision_provenance }} /><p>schema_version은 응답 형식입니다. 각 게이트의 artifact_version은 별도의 실행/산출물 버전입니다.</p><DatasetTable rows={hc.sessionResult.gates.map(gate => ({ gate_id: gate.gate_id, ...gate.provenance }))} label="게이트 산출물 버전" /></Panel><Panel title="기록된 시스템 상태" eyebrow="system-status.json · STATIC FIXTURE"><p className="vf-muted">현재 서버 상태·실시간 지연 측정이 아닙니다. null은 미측정 값입니다.</p><DatasetTable rows={hc.systemStatus} label="정적 시스템 상태" /></Panel></>}
    {defense && <Panel title="공격 전달 산출물·모델" eyebrow="attack_handoff_jpeg_index.csv"><p className="vf-muted">제공된 model / pretrained / 공격 조건 / 산출물 경로를 그대로 표시합니다.</p><DatasetTable rows={defense.handoff} label="실험 전달 산출물" /></Panel>}
  </>;
}
