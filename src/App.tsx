import { useEffect, useMemo, useState } from 'react';
import { loadDashboardData, loadDefenseDashboardData } from './data';
import type {
  AttackFamily,
  AttackFamilyRow,
  AttackSession,
  DashboardOverview,
  DefenseAdvTrainingRow,
  DefenseEnsembleRow,
  DefenseFeatureSqueezingRow,
  DefenseHandoffRow,
  RiskLevel,
  RiskSession,
  RuleDefinition,
  RuleHitSummary,
  TrainingHistory,
} from './types';

type DashboardData = Awaited<ReturnType<typeof loadDashboardData>>;
type DefenseDashboardData = Awaited<ReturnType<typeof loadDefenseDashboardData>>;
type AcceptedFilter = 'all' | 'accepted' | 'rejected';
type DashboardMode = 'attack' | 'defense';
type AccountRiskRow = {
  accountId: string;
  attempts: number;
  accepted: number;
  avgRiskScore: number;
  highCritical: number;
};

const riskLevels: Array<RiskLevel | 'all'> = ['all', 'critical', 'high', 'medium', 'low'];
const attackFamilies: Array<AttackFamily | 'all'> = ['all', 'pgd', 'fgsm', 'square', 'adaptive'];

const familyNotes: Record<AttackFamily, string> = {
  pgd: '모델 내부 정보를 알고 반복적으로 이미지를 조금씩 바꾸는 강한 공격입니다.',
  fgsm: '한 번의 계산으로 이미지를 바꾸는 빠른 기준 공격입니다.',
  square: '모델 내부를 모르는 상태에서 여러 번 물어보며 성공 여부를 찾는 공격입니다.',
  adaptive: '방어 로직을 알고 있다고 가정하고 우회를 시도하는 공격 시나리오입니다.',
};

const familyLabels: Record<AttackFamily, string> = {
  pgd: 'PGD',
  fgsm: 'FGSM',
  square: 'Square',
  adaptive: 'Adaptive',
};

const riskDescriptions: Record<RiskLevel, string> = {
  critical: '공격 성공 가능성과 위험 신호가 모두 매우 높은 세션입니다.',
  high: '운영자가 우선 확인해야 하는 고위험 세션입니다.',
  medium: '추가 관찰이 필요한 중간 위험 세션입니다.',
  low: '현재 기준에서는 낮은 위험으로 분류된 세션입니다.',
};

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return new Intl.NumberFormat('ko-KR', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '-';
  }
  return `${formatNumber(value * 100, 2)}%`;
}

function formatDateTime(value: string) {
  if (!value) {
    return '-';
  }
  return value.replace('T', ' ').replace('+09:00', '');
}

function splitRules(ruleHits: string) {
  return ruleHits.split(';').filter(Boolean);
}

function InfoTooltip({ text }: { text: string }) {
  return (
    <span className="tooltip" tabIndex={0} aria-label={text}>
      ?
      <span role="tooltip">{text}</span>
    </span>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <article className={`stat-card ${tone ?? ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function TopBar({
  activeMode,
  onModeChange,
}: {
  activeMode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
}) {
  return (
    <header className="top-bar">
      <div className="brand-block">
        <strong>FaceAuth</strong>
        <small>Forensics</small>
      </div>
      <div className="mode-switch" aria-label="Dashboard mode">
        <button className={activeMode === 'attack' ? 'active' : ''} type="button" onClick={() => onModeChange('attack')}>
          Attack
        </button>
        <button className={activeMode === 'defense' ? 'active' : ''} type="button" onClick={() => onModeChange('defense')}>
          Defense
        </button>
      </div>
      <nav className="top-nav" aria-label="Dashboard sections">
        <a href="#overview" className="active">Overview</a>
        <a href="#families">Attack Types</a>
        <a href="#sessions">Risk Sessions</a>
        <a href="#accounts">Accounts</a>
        <a href="#timeline">Timeline</a>
        <a href="#rules">Rules</a>
      </nav>
    </header>
  );
}

function OverviewCards({ overview }: { overview: DashboardOverview }) {
  return (
    <section className="overview-grid" id="overview" aria-label="Overview">
      <StatCard label="전체 공격 세션 수" value={formatNumber(overview.total_sessions)} />
      <StatCard label="공격 성공 수" value={formatNumber(overview.accepted_after_attack)} tone="success" />
      <StatCard label="공격 성공률" value={formatPercent(overview.attack_accept_rate)} tone="success" />
      <StatCard label="High/Critical 위험 세션" value={formatNumber(overview.high_or_critical_sessions)} tone="warning" />
      <StatCard label="Critical 세션" value={formatNumber(overview.critical_sessions)} tone="danger" />
      <StatCard label="평균 Risk Score" value={formatNumber(overview.avg_risk_score, 2)} />
    </section>
  );
}

function RiskDistribution({ row }: { row: AttackFamilyRow }) {
  const total = row.critical + row.high + row.medium + row.low;
  const segments = [
    ['critical', row.critical],
    ['high', row.high],
    ['medium', row.medium],
    ['low', row.low],
  ] as const;

  return (
    <div className="stacked-bar" aria-label={`${row.attack_family} risk distribution`}>
      {segments.map(([level, count]) => (
        <span
          key={level}
          className={`risk-${level}`}
          style={{ width: `${(count / total) * 100}%` }}
          title={`${level}: ${count}`}
        />
      ))}
    </div>
  );
}

function AttackFamilyComparison({ rows }: { rows: AttackFamilyRow[] }) {
  const maxSessions = Math.max(...rows.map((row) => row.sessions));

  return (
    <section className="panel" id="families">
      <div className="section-heading">
        <div>
          <p>Attack Families</p>
          <h2>공격 유형별 비교</h2>
        </div>
      </div>
      <div className="family-grid">
        {rows.map((row) => (
          <article className={`family-card family-${row.attack_family}`} key={row.attack_family}>
            <div className="family-title">
              <div>
                <strong>
                  {familyLabels[row.attack_family]}
                  <InfoTooltip text={familyNotes[row.attack_family]} />
                </strong>
                <span>{familyNotes[row.attack_family]}</span>
              </div>
              <b>{formatPercent(row.attack_accept_rate)}</b>
            </div>
            <div className="metric-row">
              <span>세션 수</span>
              <strong>{formatNumber(row.sessions)}</strong>
            </div>
            <div className="bar-track">
              <span style={{ width: `${(row.sessions / maxSessions) * 100}%` }} />
            </div>
            <div className="metric-row">
              <span>평균 risk score</span>
              <strong>{formatNumber(row.avg_risk_score, 2)}</strong>
            </div>
            <RiskDistribution row={row} />
            <div className="risk-legend compact">
              <span title={riskDescriptions.critical}>Critical {row.critical}</span>
              <span title={riskDescriptions.high}>High {row.high}</span>
              <span title={riskDescriptions.medium}>Medium {row.medium}</span>
              <span title={riskDescriptions.low}>Low {row.low}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function FilterButton<T extends string>({
  value,
  active,
  onClick,
}: {
  value: T;
  active: boolean;
  onClick: (value: T) => void;
}) {
  return (
    <button className={active ? 'active' : ''} type="button" onClick={() => onClick(value)}>
      {value}
    </button>
  );
}

function RiskSessionsTable({
  sessions,
  selectedId,
  onSelect,
}: {
  sessions: RiskSession[];
  selectedId: string;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>session_id</th>
            <th>timestamp</th>
            <th>account_id</th>
            <th>source_identity</th>
            <th>target_identity</th>
            <th>
              attack_family <InfoTooltip text="PGD, FGSM, Square, Adaptive 공격 유형입니다. 각 유형 카드를 hover하면 뜻을 볼 수 있습니다." />
            </th>
            <th>epsilon</th>
            <th>similarity_after_attack</th>
            <th>threshold_margin</th>
            <th>accepted_after_attack</th>
            <th>risk_score</th>
            <th>risk_level</th>
            <th>rule_hits</th>
            <th>adv_file</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((session) => (
            <tr
              key={session.session_id}
              className={selectedId === session.session_id ? 'selected' : ''}
              onClick={() => onSelect(session.session_id)}
            >
              <td>{session.session_id}</td>
              <td>{formatDateTime(session.timestamp)}</td>
              <td>{session.account_id}</td>
              <td>{session.source_identity}</td>
              <td>{session.target_identity}</td>
              <td title={familyNotes[session.attack_family]}>{familyLabels[session.attack_family]}</td>
              <td>{formatNumber(session.epsilon, 4)}</td>
              <td>{formatNumber(session.similarity_after_attack, 4)}</td>
              <td>{formatNumber(session.threshold_margin, 4)}</td>
              <td>{session.accepted_after_attack ? 'accepted' : 'rejected'}</td>
              <td>{session.risk_score}</td>
              <td>
                <span className={`pill risk-${session.risk_level}`}>{session.risk_level}</span>
              </td>
              <td>{splitRules(session.rule_hits).join(', ')}</td>
              <td className="path-cell" title={session.adv_file}>{session.adv_file}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionDetail({
  session,
  rulesById,
}: {
  session: AttackSession | undefined;
  rulesById: Map<string, RuleDefinition>;
}) {
  if (!session) {
    return (
      <aside className="detail-panel empty">
        <h2>세션 상세 보기</h2>
        <p>왼쪽 테이블에서 세션을 선택하세요.</p>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <div className="detail-header">
        <div>
          <p>Session Detail</p>
          <h2>{session.session_id}</h2>
        </div>
        <span className={`pill risk-${session.risk_level}`}>{session.risk_level}</span>
      </div>

      <div className="identity-route">
        <strong>{session.source_identity}</strong>
        <span>→</span>
        <strong>{session.target_identity}</strong>
      </div>

      <dl className="detail-grid">
        <div>
          <dt>공격 유형</dt>
          <dd>
            {familyLabels[session.attack_family]}
            <InfoTooltip text={familyNotes[session.attack_family]} />
          </dd>
        </div>
        <div>
          <dt>Epsilon</dt>
          <dd>{formatNumber(session.epsilon, 4)}</dd>
        </div>
        <div>
          <dt>Similarity Before</dt>
          <dd>{formatNumber(session.similarity_before, 4)}</dd>
        </div>
        <div>
          <dt>Similarity After</dt>
          <dd>{formatNumber(session.similarity_after_attack, 4)}</dd>
        </div>
        <div>
          <dt>Threshold</dt>
          <dd>{formatNumber(session.threshold, 4)}</dd>
        </div>
        <div>
          <dt>Threshold Margin</dt>
          <dd>{formatNumber(session.threshold_margin, 4)}</dd>
        </div>
        <div>
          <dt>공격 성공</dt>
          <dd>{session.accepted_after_attack ? 'accepted' : 'rejected'}</dd>
        </div>
        <div>
          <dt>Risk Score</dt>
          <dd>{session.risk_score}</dd>
        </div>
      </dl>

      <div className="rule-list">
        <h3>Rule Hit 설명</h3>
        {splitRules(session.rule_hits).map((ruleId) => {
          const rule = rulesById.get(ruleId);
          return (
            <article key={ruleId}>
              <div>
                <strong>{ruleId}</strong>
                <span>{rule?.name ?? 'Unknown rule'}</span>
              </div>
              <p>{rule?.description ?? '룰 정의 파일에 설명이 없습니다.'}</p>
            </article>
          );
        })}
      </div>

      <div className="evidence-paths">
        <h3>Evidence Paths</h3>
        <code>source: {session.source_file}</code>
        <code>target: {session.target_enroll_file}</code>
        <code>{session.adv_file}</code>
        <code>{session.perturbation_file}</code>
      </div>
    </aside>
  );
}

function AccountRiskPanel({ rows }: { rows: AccountRiskRow[] }) {
  return (
    <section className="panel split-panel" id="accounts">
      <div className="section-heading">
        <div>
          <p>Accounts</p>
          <h2>계정별 위험도</h2>
        </div>
      </div>
      <div className="table-wrap compact-table">
        <table>
          <thead>
            <tr>
              <th>account_id</th>
              <th>공격 시도</th>
              <th>공격 성공</th>
              <th>평균 risk score</th>
              <th>critical/high</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.accountId}>
                <td>{row.accountId}</td>
                <td>{formatNumber(row.attempts)}</td>
                <td>{formatNumber(row.accepted)}</td>
                <td>{formatNumber(row.avgRiskScore, 2)}</td>
                <td>{formatNumber(row.highCritical)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TimelinePanel({ sessions }: { sessions: AttackSession[] }) {
  return (
    <section className="panel split-panel" id="timeline">
      <div className="section-heading">
        <div>
          <p>Timeline</p>
          <h2>공격 세션 Timeline</h2>
        </div>
      </div>
      <ol className="timeline-list">
        {sessions.slice(0, 12).map((session) => (
          <li key={session.session_id}>
            <time>{formatDateTime(session.timestamp).slice(11, 16)}</time>
            <strong>{session.session_id}</strong>
            <span>{familyLabels[session.attack_family]}</span>
            <span className={`pill risk-${session.risk_level}`}>{session.risk_level}</span>
            <span>{session.accepted_after_attack ? 'accepted' : 'rejected'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function defensePct(numerator: number, denominator: number) {
  return denominator === 0 ? '0.00%' : formatPercent(numerator / denominator);
}

function DefenseOverviewCards({
  advTraining,
  featureSqueezing,
}: {
  advTraining: DefenseAdvTrainingRow[];
  featureSqueezing: DefenseFeatureSqueezingRow[];
}) {
  const total = advTraining.length;
  const blocked = advTraining.filter((row) => row.defense_success).length;
  const passed = advTraining.filter((row) => row.accepted_after_defense).length;
  const detected = featureSqueezing.filter((row) => row.is_attack_detected).length;
  const risky = featureSqueezing.filter((row) => row.risk_score_add >= 20).length;

  return (
    <section className="overview-grid defense-overview" id="defense-overview" aria-label="Defense overview">
      <StatCard label="총 인증 시도" value={formatNumber(total)} />
      <StatCard label="차단 수" value={formatNumber(blocked)} tone="success" />
      <StatCard label="통과 수" value={formatNumber(passed)} />
      <StatCard label="방어 성공률" value={defensePct(blocked, total)} tone="success" />
      <StatCard label="공격 탐지 수" value={formatNumber(detected)} tone="warning" />
      <StatCard label="위험 세션" value={formatNumber(risky)} tone="danger" />
    </section>
  );
}

function DefensePipelinePanel({
  ensemble,
  advTraining,
  featureSqueezing,
}: {
  ensemble: DefenseEnsembleRow[];
  advTraining: DefenseAdvTrainingRow[];
  featureSqueezing: DefenseFeatureSqueezingRow[];
}) {
  const total = advTraining.length;
  const stage2Blocked = ensemble.filter((row) => !row.ensemble_accepted).length;
  const stage3Blocked = advTraining.filter((row) => !row.accepted_after_defense).length;
  const stage4Detected = featureSqueezing.filter((row) => row.is_attack_detected).length;
  const stages = [
    { label: '1단계 시간적 일관성', value: total, total, status: '정상', note: '정적 이미지 탐지 시 즉시 차단' },
    { label: '2단계 앙상블 투표', value: stage2Blocked, total: ensemble.length, status: '정상', note: 'ROI / Smoothing / Randomized 다수결' },
    { label: '3단계 적대적 학습', value: stage3Blocked, total, status: '정상', note: 'fine-tuned FaceNet 재검증' },
    { label: '4단계 특징압축 포렌식', value: stage4Detected, total: featureSqueezing.length, status: '감시중', note: '3종 squeezer 기반 탐지' },
  ];

  return (
    <section className="panel" id="defense-pipeline">
      <div className="section-heading">
        <div>
          <p>Defense Pipeline</p>
          <h2>방어 파이프라인 상태</h2>
        </div>
      </div>
      <div className="pipeline-list">
        {stages.map((stage) => (
          <article key={stage.label}>
            <div>
              <strong>{stage.label}</strong>
              <span>{stage.note}</span>
            </div>
            <div className="pipeline-meter">
              <span style={{ width: `${(stage.value / Math.max(stage.total, 1)) * 100}%` }} />
            </div>
            <b>{formatNumber(stage.value)} / {formatNumber(stage.total)} ({defensePct(stage.value, stage.total)})</b>
            <em>{stage.status}</em>
          </article>
        ))}
      </div>
    </section>
  );
}

function DefenseSessionLog({
  rows,
}: {
  rows: Array<{
    adv: DefenseAdvTrainingRow;
    ensemble?: DefenseEnsembleRow;
    fs?: DefenseFeatureSqueezingRow;
    handoff?: DefenseHandoffRow;
  }>;
}) {
  return (
    <section className="panel" id="defense-sessions">
      <div className="section-heading">
        <div>
          <p>Defense Sessions</p>
          <h2>세션별 상세 로그</h2>
        </div>
        <span>{formatNumber(rows.length)} rows</span>
      </div>
      <div className="table-wrap defense-log-table">
        <table>
          <thead>
            <tr>
              <th>sample_id</th>
              <th>stage1_blocked</th>
              <th>stage2_blocked</th>
              <th>stage3_blocked</th>
              <th>stage4_detected</th>
              <th>risk_score</th>
              <th>final_result</th>
              <th>sim_score</th>
              <th>source</th>
              <th>target</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map(({ adv, ensemble, fs, handoff }) => {
              const stage2Blocked = ensemble ? !ensemble.ensemble_accepted : false;
              const stage3Blocked = !adv.accepted_after_defense;
              const finalResult = stage2Blocked || stage3Blocked ? 'BLOCKED' : 'PASSED';
              return (
                <tr key={adv.sample_id}>
                  <td>{adv.sample_id}</td>
                  <td>simulated</td>
                  <td>{stage2Blocked ? 'true' : 'false'}</td>
                  <td>{stage3Blocked ? 'true' : 'false'}</td>
                  <td>{fs?.is_attack_detected ? 'true' : 'false'}</td>
                  <td>{fs?.risk_score_add ?? 0}</td>
                  <td>
                    <span className={`pill ${finalResult === 'BLOCKED' ? 'risk-low' : 'risk-critical'}`}>{finalResult}</span>
                  </td>
                  <td>{formatNumber(adv.sim_adv_target, 4)}</td>
                  <td>{handoff?.source_name ?? '-'}</td>
                  <td>{handoff?.target_name ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FeatureSqueezingPanel({ rows }: { rows: DefenseFeatureSqueezingRow[] }) {
  const total = rows.length;
  const squeezers = [
    { key: 'lr', label: 'Low Resolution', detected: rows.filter((row) => row.lr_detected).length, description: '32x32 축소로 고주파 perturbation 제거' },
    { key: 'cd', label: 'Color Depth', detected: rows.filter((row) => row.cd_detected).length, description: '4-bit 양자화로 미세 픽셀 변화 소거' },
    { key: 'mf', label: 'Median Filter', detected: rows.filter((row) => row.mf_detected).length, description: '3x3 필터로 국소 perturbation 평활화' },
  ];
  const topRiskRows = [...rows].sort((a, b) => b.risk_score_add - a.risk_score_add || b.max_sim_diff - a.max_sim_diff).slice(0, 8);

  return (
    <section className="panel" id="feature-squeezing">
      <div className="section-heading">
        <div>
          <p>Feature Squeezing</p>
          <h2>특징 압축 포렌식</h2>
        </div>
      </div>
      <div className="squeezer-grid">
        {squeezers.map((squeezer) => (
          <article key={squeezer.key}>
            <strong>{squeezer.label}</strong>
            <b>{defensePct(squeezer.detected, total)}</b>
            <span>{squeezer.description}</span>
          </article>
        ))}
      </div>
      <div className="table-wrap compact-table">
        <table>
          <thead>
            <tr>
              <th>sample_id</th>
              <th>risk_score_add</th>
              <th>lr_sim_diff</th>
              <th>cd_sim_diff</th>
              <th>mf_sim_diff</th>
              <th>max_sim_diff</th>
            </tr>
          </thead>
          <tbody>
            {topRiskRows.map((row) => (
              <tr key={row.sample_id}>
                <td>{row.sample_id}</td>
                <td>{row.risk_score_add}</td>
                <td>{formatNumber(row.lr_sim_diff, 4)}</td>
                <td>{formatNumber(row.cd_sim_diff, 4)}</td>
                <td>{formatNumber(row.mf_sim_diff, 4)}</td>
                <td>{formatNumber(row.max_sim_diff, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdvTrainingPanel({ history }: { history: TrainingHistory }) {
  return (
    <section className="panel" id="adv-training">
      <div className="section-heading">
        <div>
          <p>Model Status</p>
          <h2>적대적 학습 모델 상태</h2>
        </div>
      </div>
      <div className="model-summary">
        <div>
          <span>모델 버전</span>
          <strong>best_adv_trained.pt</strong>
        </div>
        <div>
          <span>학습 전 ASR</span>
          <strong>{formatPercent(history.asr_before)}</strong>
        </div>
        <div>
          <span>학습 후 ASR</span>
          <strong>{formatPercent(history.asr_best)}</strong>
        </div>
        <div>
          <span>방어 성공률</span>
          <strong>{formatPercent(1 - history.asr_best)}</strong>
        </div>
      </div>
      <div className="training-history">
        {history.history.map((epoch) => (
          <article key={epoch.epoch} className={epoch.asr === history.asr_best ? 'best' : ''}>
            <span>Epoch {epoch.epoch}</span>
            <strong>Loss {formatNumber(epoch.loss, 4)}</strong>
            <b>ASR {formatPercent(epoch.asr)}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function DefenseDashboard({ data }: { data: DefenseDashboardData }) {
  const ensembleById = useMemo(() => new Map(data.ensemble.map((row) => [row.sample_id, row])), [data.ensemble]);
  const fsById = useMemo(() => new Map(data.featureSqueezing.map((row) => [row.sample_id, row])), [data.featureSqueezing]);
  const handoffById = useMemo(() => new Map(data.handoff.map((row) => [row.sample_id, row])), [data.handoff]);
  const sessionRows = useMemo(
    () =>
      data.advTraining.map((adv) => ({
        adv,
        ensemble: ensembleById.get(adv.sample_id),
        fs: fsById.get(adv.sample_id),
        handoff: handoffById.get(adv.sample_id),
      })),
    [data.advTraining, ensembleById, fsById, handoffById],
  );

  return (
    <>
      <header className="app-header">
        <div>
          <p>Financial FaceAuth Defense</p>
          <h1>Defense Pipeline</h1>
          <span className="header-description">4단계 방어 파이프라인의 차단 성능, 위험도, 포렌식 탐지 근거를 점검합니다.</span>
        </div>
        <div className="header-meta">
          <span className="status-dot">Static experiment</span>
          <span>{formatNumber(data.advTraining.length)} samples</span>
          <span>Updated 2026-07-07</span>
        </div>
      </header>
      <DefenseOverviewCards advTraining={data.advTraining} featureSqueezing={data.featureSqueezing} />
      <DefensePipelinePanel ensemble={data.ensemble} advTraining={data.advTraining} featureSqueezing={data.featureSqueezing} />
      <DefenseSessionLog rows={sessionRows} />
      <div className="secondary-grid">
        <FeatureSqueezingPanel rows={data.featureSqueezing} />
        <AdvTrainingPanel history={data.trainingHistory} />
      </div>
    </>
  );
}

function RuleStatistics({
  summary,
  rulesById,
}: {
  summary: RuleHitSummary[];
  rulesById: Map<string, RuleDefinition>;
}) {
  return (
    <section className="panel" id="rules">
      <div className="section-heading">
        <div>
          <p>Detection Rules</p>
          <h2>탐지 룰 통계</h2>
        </div>
      </div>
      <div className="table-wrap rules-table">
        <table>
          <thead>
            <tr>
              <th>rule_id</th>
              <th>name</th>
              <th>severity</th>
              <th>hit 수</th>
              <th>룰별 공격 성공률</th>
              <th>description</th>
            </tr>
          </thead>
          <tbody>
            {summary.map((row) => {
              const rule = rulesById.get(row.rule_id);
              return (
                <tr key={row.rule_id}>
                  <td>{row.rule_id}</td>
                  <td>{rule?.name ?? '-'}</td>
                  <td>
                    <span className={`pill risk-${rule?.severity ?? 'medium'}`} title={rule ? riskDescriptions[rule.severity] : undefined}>
                      {rule?.severity ?? '-'}
                    </span>
                  </td>
                  <td>{formatNumber(row.sessions)}</td>
                  <td>{formatPercent(row.attack_accept_rate)}</td>
                  <td>{rule?.description ?? '-'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AttackDashboard({ data }: { data: DashboardData }) {
  const [riskFilter, setRiskFilter] = useState<RiskLevel | 'all'>('all');
  const [familyFilter, setFamilyFilter] = useState<AttackFamily | 'all'>('all');
  const [acceptedFilter, setAcceptedFilter] = useState<AcceptedFilter>('all');
  const [selectedId, setSelectedId] = useState(data.topRiskSessions[0]?.session_id ?? '');

  const rulesById = useMemo(
    () => new Map(data.rules.map((rule) => [rule.id, rule])),
    [data.rules],
  );

  const attackSessionsById = useMemo(
    () => new Map(data.attackSessions.map((session) => [session.session_id, session])),
    [data.attackSessions],
  );

  const filteredSessions = useMemo(
    () =>
      data.topRiskSessions.filter((session) => {
        const riskMatches = riskFilter === 'all' || session.risk_level === riskFilter;
        const familyMatches = familyFilter === 'all' || session.attack_family === familyFilter;
        const acceptedMatches =
          acceptedFilter === 'all' ||
          (acceptedFilter === 'accepted' && session.accepted_after_attack) ||
          (acceptedFilter === 'rejected' && !session.accepted_after_attack);
        return riskMatches && familyMatches && acceptedMatches;
      }),
    [acceptedFilter, data.topRiskSessions, familyFilter, riskFilter],
  );

  useEffect(() => {
    if (filteredSessions.length > 0 && !filteredSessions.some((session) => session.session_id === selectedId)) {
      setSelectedId(filteredSessions[0].session_id);
    }
  }, [filteredSessions, selectedId]);

  const selectedSession = attackSessionsById.get(selectedId);
  const accountRiskRows = useMemo(() => {
    const rows = new Map<string, { accepted: number; attempts: number; highCritical: number; riskTotal: number }>();
    data.attackSessions.forEach((session) => {
      const row = rows.get(session.account_id) ?? {
        accepted: 0,
        attempts: 0,
        highCritical: 0,
        riskTotal: 0,
      };
      row.attempts += 1;
      row.accepted += session.accepted_after_attack ? 1 : 0;
      row.highCritical += session.risk_level === 'critical' || session.risk_level === 'high' ? 1 : 0;
      row.riskTotal += session.risk_score;
      rows.set(session.account_id, row);
    });

    return Array.from(rows.entries())
      .map(([accountId, row]) => ({
        accountId,
        attempts: row.attempts,
        accepted: row.accepted,
        avgRiskScore: row.riskTotal / row.attempts,
        highCritical: row.highCritical,
      }))
      .sort((a, b) => b.highCritical - a.highCritical || b.avgRiskScore - a.avgRiskScore)
      .slice(0, 10);
  }, [data.attackSessions]);

  const timelineSessions = useMemo(
    () =>
      [...data.attackSessions]
        .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        .filter((session) => session.risk_level === 'critical' || session.risk_level === 'high'),
    [data.attackSessions],
  );

  return (
    <>
        <header className="app-header">
          <div>
            <p>Financial FaceAuth Operations</p>
            <h1>Attack Forensics</h1>
            <span className="header-description">공격 세션의 성공 여부, 위험도, 탐지 룰 근거를 운영 관점에서 점검합니다.</span>
          </div>
          <div className="header-meta">
            <span className="status-dot">Live dataset</span>
            <span>{formatNumber(data.overview.total_sessions)} sessions</span>
            <span>Updated 2026-06-28</span>
          </div>
        </header>

        <OverviewCards overview={data.overview} />
        <AttackFamilyComparison rows={data.familyRows} />

        <section className="panel" id="sessions">
          <div className="section-heading">
            <div>
              <p>Risk Sessions</p>
              <h2>위험 세션 테이블</h2>
            </div>
            <span>{formatNumber(filteredSessions.length)} rows</span>
          </div>

          <div className="filters">
            <div>
              <span>risk_level</span>
              {riskLevels.map((value) => (
                <FilterButton
                  key={value}
                  value={value}
                  active={riskFilter === value}
                  onClick={setRiskFilter}
                />
              ))}
            </div>
            <div>
              <span>attack_family</span>
              {attackFamilies.map((value) => (
                <FilterButton key={value} value={value} active={familyFilter === value} onClick={setFamilyFilter} />
              ))}
            </div>
            <div>
              <span>accepted_after_attack</span>
              {(['all', 'accepted', 'rejected'] as AcceptedFilter[]).map((value) => (
                <FilterButton key={value} value={value} active={acceptedFilter === value} onClick={setAcceptedFilter} />
              ))}
            </div>
          </div>

          <div className="session-layout">
            <RiskSessionsTable sessions={filteredSessions} selectedId={selectedId} onSelect={setSelectedId} />
            <SessionDetail session={selectedSession} rulesById={rulesById} />
          </div>
        </section>

        <div className="secondary-grid">
          <AccountRiskPanel rows={accountRiskRows} />
          <TimelinePanel sessions={timelineSessions} />
        </div>

        <RuleStatistics summary={data.ruleSummary} rulesById={rulesById} />
    </>
  );
}

export function App() {
  const [attackData, setAttackData] = useState<DashboardData | null>(null);
  const [defenseData, setDefenseData] = useState<DefenseDashboardData | null>(null);
  const [activeMode, setActiveMode] = useState<DashboardMode>('attack');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadDashboardData(), loadDefenseDashboardData()])
      .then(([attack, defense]) => {
        setAttackData(attack);
        setDefenseData(defense);
      })
      .catch((error: Error) => setError(error.message));
  }, []);

  if (error) {
    return <div className="state-message">데이터 로드 실패: {error}</div>;
  }

  if (!attackData || !defenseData) {
    return <div className="state-message">대시보드 데이터를 불러오는 중입니다.</div>;
  }

  return (
    <div className="console-shell">
      <TopBar activeMode={activeMode} onModeChange={setActiveMode} />
      <main className="console-main">
        {activeMode === 'attack' ? <AttackDashboard data={attackData} /> : <DefenseDashboard data={defenseData} />}
      </main>
    </div>
  );
}
