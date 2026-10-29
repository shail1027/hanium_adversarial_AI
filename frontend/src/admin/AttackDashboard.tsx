import { useMemo, useState } from 'react';
import type { loadDashboardData } from '../data';
import type { AttackFamily, AttackFamilyRow, AttackSession, RiskLevel, RiskSession, RuleDefinition, RuleHitSummary } from '../types';
import { filterAttacks, ratio } from './model';
type DashboardData = Awaited<ReturnType<typeof loadDashboardData>>;
type AcceptedFilter = 'all' | 'accepted' | 'rejected';
type AccountRiskRow = { accountId: string; attempts: number; accepted: number; avgRiskScore: number; highCritical: number };
const riskLevels: Array<RiskLevel | 'all'> = ['all', 'critical', 'high', 'medium', 'low'];
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
    <span className="vf-tooltip" tabIndex={0} aria-label={text}>
      ?
      <span role="vf-tooltip">{text}</span>
    </span>
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
    <div className="vf-stacked-bar" aria-label={`${row.attack_family} risk distribution`}>
      {segments.map(([level, count]) => (
        <span
          key={level}
          className={`vf-risk-${level}`}
          style={{ width: `${(count / Math.max(total, 1)) * 100}%` }}
          title={`${level}: ${count}`}
        />
      ))}
    </div>
  );
}

function AttackFamilyComparison({ rows }: { rows: AttackFamilyRow[] }) {
  const maxSessions = Math.max(0, ...rows.map((row) => row.sessions));

  return (
    <section className="vf-panel" id="families">
      <div className="vf-section-heading">
        <div>
          <p>Attack Families</p>
          <h2>공격 유형별 비교</h2>
        </div>
      </div>
      <div className="vf-family-grid">
        {rows.map((row) => (
          <article className={`vf-family-card vf-family-${row.attack_family}`} key={row.attack_family}>
            <div className="vf-family-title">
              <div>
                <strong>
                  {familyLabels[row.attack_family]}
                  <InfoTooltip text={familyNotes[row.attack_family]} />
                </strong>
                <span>{familyNotes[row.attack_family]}</span>
              </div>
              <b>{ratio(row.accepted_after_attack, row.sessions)}</b>
            </div>
            <div className="vf-metric-row">
              <span>세션 수</span>
              <strong>{formatNumber(row.sessions)}</strong>
            </div>
            <div className="vf-bar-track">
              <span style={{ width: `${(row.sessions / Math.max(maxSessions, 1)) * 100}%` }} />
            </div>
            <div className="vf-metric-row">
              <span>평균 risk score</span>
              <strong>{formatNumber(row.avg_risk_score, 2)}</strong>
            </div>
            <RiskDistribution row={row} />
            <div className="vf-risk-legend compact">
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
    <button className={active ? 'active' : ''} type="button" aria-pressed={active} onClick={() => onClick(value)}>
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
    <div tabIndex={0} role="region" aria-label="실험 결과 표" className="vf-table-wrap">
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
              <td><button type="button" aria-pressed={selectedId === session.session_id} onClick={() => onSelect(session.session_id)}>{session.session_id}</button></td>
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
                <span className={`vf-pill vf-risk-${session.risk_level}`}>{session.risk_level}</span>
              </td>
              <td>{splitRules(session.rule_hits).join(', ')}</td>
              <td className="vf-path-cell" title={session.adv_file}>{session.adv_file}</td>
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
      <aside className="vf-detail-panel empty">
        <h2>세션 상세 보기</h2>
        <p>왼쪽 테이블에서 세션을 선택하세요.</p>
      </aside>
    );
  }

  return (
    <aside className="vf-detail-panel">
      <div className="vf-detail-header">
        <div>
          <p>Session Detail</p>
          <h2>{session.session_id}</h2>
        </div>
        <span className={`vf-pill vf-risk-${session.risk_level}`}>{session.risk_level}</span>
      </div>

      <div className="vf-identity-route">
        <strong>{session.source_identity}</strong>
        <span>→</span>
        <strong>{session.target_identity}</strong>
      </div>

      <dl className="vf-detail-grid">
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

      <div className="vf-rule-list">
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

      <details><summary>전체 공격 조건·측정값</summary><dl className="vf-detail-grid">{Object.entries(session).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value === null ? '자료 없음 (null)' : String(value)}</dd></div>)}</dl></details>
      <div className="vf-evidence-paths">
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
    <section className="vf-panel vf-split-panel" id="accounts">
      <div className="vf-section-heading">
        <div>
          <p>Accounts</p>
          <h2>실험 계정별 위험도</h2>
        </div>
      </div>
      <div tabIndex={0} role="region" aria-label="실험 결과 표" className="vf-table-wrap vf-compact-table">
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
    <section className="vf-panel vf-split-panel" id="timeline">
      <div className="vf-section-heading">
        <div>
          <p>Timeline</p>
          <h2>기록된 실험 타임라인</h2>
        </div>
      </div>
      <ol className="vf-timeline-list">
        {sessions.slice(0, 12).map((session) => (
          <li key={session.session_id}>
            <time>{formatDateTime(session.timestamp).slice(11, 16)}</time>
            <strong>{session.session_id}</strong>
            <span>{familyLabels[session.attack_family]}</span>
            <span className={`vf-pill vf-risk-${session.risk_level}`}>{session.risk_level}</span>
            <span>{session.accepted_after_attack ? 'accepted' : 'rejected'}</span>
          </li>
        ))}
      </ol>
    </section>
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
    <section className="vf-panel" id="rules">
      <div className="vf-section-heading">
        <div>
          <p>Detection Rules</p>
          <h2>탐지 룰 통계</h2>
        </div>
      </div>
      <div tabIndex={0} role="region" aria-label="실험 결과 표" className="vf-table-wrap vf-rules-table">
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
                    <span className={`vf-pill vf-risk-${rule?.severity ?? 'medium'}`} title={rule ? riskDescriptions[rule.severity] : undefined}>
                      {rule?.severity ?? '-'}
                    </span>
                  </td>
                  <td>{formatNumber(row.sessions)}</td>
                  <td>{ratio(row.accepted_after_attack, row.sessions)}</td>
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

export function AttackDashboard({ data }: { data: DashboardData }) {
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

  const filteredSessions = useMemo(() => filterAttacks(data.topRiskSessions, riskFilter, familyFilter, acceptedFilter), [data.topRiskSessions, riskFilter, familyFilter, acceptedFilter]);
  const visibleId = filteredSessions.some(row => row.session_id === selectedId) ? selectedId : filteredSessions[0]?.session_id;
  const selectedSession = visibleId ? attackSessionsById.get(visibleId) : undefined;
  const attackFamilies: Array<AttackFamily | 'all'> = ['all', ...new Set(data.attackSessions.map(row => row.attack_family))];
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
        <p className="vf-muted">공격 데이터셋 · 조건별 비교와 세션 상세 분석</p>
        <AttackFamilyComparison rows={data.familyRows} />

        <section className="vf-panel" id="sessions">
          <div className="vf-section-heading">
            <div>
              <p>Risk Sessions</p>
              <h2>위험 세션 테이블</h2>
            </div>
            <span>{formatNumber(filteredSessions.length)} rows</span>
          </div>

          <div className="vf-filters">
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

          {filteredSessions.length === 0 && <p role="status">조건에 맞는 실험 세션이 없습니다.</p>}
          <div className="vf-session-layout">
            <RiskSessionsTable sessions={filteredSessions} selectedId={visibleId ?? ''} onSelect={setSelectedId} />
            <SessionDetail session={selectedSession} rulesById={rulesById} />
          </div>
        </section>

        <div className="vf-secondary-grid">
          <AccountRiskPanel rows={accountRiskRows} />
          <TimelinePanel sessions={timelineSessions} />
        </div>

        <RuleStatistics summary={data.ruleSummary} rulesById={rulesById} />
    </>
  );
}
