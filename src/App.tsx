import { useEffect, useMemo, useState } from 'react';
import { loadDashboardData } from './data';
import type {
  AttackFamily,
  AttackFamilyRow,
  AttackSession,
  DashboardOverview,
  RiskLevel,
  RiskSession,
  RuleDefinition,
  RuleHitSummary,
} from './types';

type DashboardData = Awaited<ReturnType<typeof loadDashboardData>>;
type AcceptedFilter = 'all' | 'accepted' | 'rejected';

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

function OverviewCards({ overview }: { overview: DashboardOverview }) {
  return (
    <section className="overview-grid" aria-label="Overview">
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
    <section className="panel">
      <div className="section-heading">
        <div>
          <p>Attack Families</p>
          <h2>공격 유형별 비교</h2>
        </div>
      </div>
      <div className="family-grid">
        {rows.map((row) => (
          <article className="family-card" key={row.attack_family}>
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
            <th>account_id</th>
            <th>source_identity</th>
            <th>target_identity</th>
            <th>
              attack_family <InfoTooltip text="PGD, FGSM, Square, Adaptive 공격 유형입니다. 각 유형 카드를 hover하면 뜻을 볼 수 있습니다." />
            </th>
            <th>similarity_after_attack</th>
            <th>threshold_margin</th>
            <th>accepted_after_attack</th>
            <th>risk_score</th>
            <th>risk_level</th>
            <th>rule_hits</th>
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
              <td>{session.account_id}</td>
              <td>{session.source_identity}</td>
              <td>{session.target_identity}</td>
              <td title={familyNotes[session.attack_family]}>{familyLabels[session.attack_family]}</td>
              <td>{formatNumber(session.similarity_after_attack, 4)}</td>
              <td>{formatNumber(session.threshold_margin, 4)}</td>
              <td>{session.accepted_after_attack ? 'accepted' : 'rejected'}</td>
              <td>{session.risk_score}</td>
              <td>
                <span className={`pill risk-${session.risk_level}`}>{session.risk_level}</span>
              </td>
              <td>{splitRules(session.rule_hits).join(', ')}</td>
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
        <code>{session.adv_file}</code>
        <code>{session.perturbation_file}</code>
      </div>
    </aside>
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
    <section className="panel">
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

function Dashboard({ data }: { data: DashboardData }) {
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

  return (
    <main>
      <header className="app-header">
        <div>
          <p>Financial FaceAuth Operations</p>
          <h1>Attack Forensics Dashboard</h1>
          <span className="header-description">공격 세션의 성공 여부, 위험도, 탐지 룰 근거를 한 화면에서 점검합니다.</span>
        </div>
        <div className="header-meta">
          <span>2,000 sessions</span>
          <span>2026-06-28 KST</span>
        </div>
      </header>

      <OverviewCards overview={data.overview} />
      <AttackFamilyComparison rows={data.familyRows} />

      <section className="panel">
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

      <RuleStatistics summary={data.ruleSummary} rulesById={rulesById} />
    </main>
  );
}

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadDashboardData().then(setData).catch((error: Error) => setError(error.message));
  }, []);

  if (error) {
    return <div className="state-message">데이터 로드 실패: {error}</div>;
  }

  if (!data) {
    return <div className="state-message">포렌식 데이터를 불러오는 중입니다.</div>;
  }

  return <Dashboard data={data} />;
}
