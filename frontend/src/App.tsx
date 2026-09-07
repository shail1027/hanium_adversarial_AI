import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { loadDashboardData, loadDefenseDashboardData, loadHc160DashboardData } from './data';
import { login, startFaceAuth, verifyFaceAuth } from './api';
import type { FaceAuthStartResponse, FaceAuthVerifyResponse, LoginResponse } from './api';
import type {
  AttackFamily,
  AttackFamilyRow,
  AttackSession,
  DashboardOverview,
  DefenseAdvTrainingRow,
  DefenseEnsembleRow,
  DefenseFeatureSqueezingRow,
  DefenseHandoffRow,
  HcFinalDecision,
  HcGateResult,
  HcGateStatus,
  HcSessionSummary,
  HcSystemStatusRow,
  RiskLevel,
  RiskSession,
  RuleDefinition,
  RuleHitSummary,
  TrainingHistory,
} from './types';

type DashboardData = Awaited<ReturnType<typeof loadDashboardData>>;
type DefenseDashboardData = Awaited<ReturnType<typeof loadDefenseDashboardData>>;
type Hc160DashboardData = Awaited<ReturnType<typeof loadHc160DashboardData>>;
type AcceptedFilter = 'all' | 'accepted' | 'rejected';
type DashboardMode = 'attack' | 'defense' | 'hc160';
type HcHistoryFilter = HcFinalDecision | 'all' | 'step_up' | 'error';
type AccountRiskRow = {
  accountId: string;
  attempts: number;
  accepted: number;
  avgRiskScore: number;
  highCritical: number;
};

const riskLevels: Array<RiskLevel | 'all'> = ['all', 'critical', 'high', 'medium', 'low'];
const attackFamilies: Array<AttackFamily | 'all'> = ['all', 'pgd', 'fgsm', 'square', 'adaptive'];

const hcHistoryFilters: HcHistoryFilter[] = ['all', 'ACCEPT', 'STEP_UP', 'REJECT', 'ERROR', 'step_up', 'error'];

const gateDescriptions: Record<string, string> = {
  L0: 'nonce, 캡처 출처, 가상 카메라, 얼굴 검출, 품질 검사 계층입니다.',
  L1: '반복 프레임, 카메라 모션, 조명/동작 챌린지 계층입니다.',
  L2: 'FaceNet 기반 신원 margin을 확인하는 계층입니다.',
  L2B: '합성 이미지와 딥페이크 위험 신호를 확인하는 계층입니다.',
  L3: '앙상블과 적대적 위험 점수를 표시하는 계층입니다. 최종 판정으로 변환하지 않습니다.',
  L4: '시도 횟수, STEP-UP 누적, 질의 예산을 확인하는 계층입니다.',
};

const decisionLabels: Record<HcFinalDecision, string> = {
  ACCEPT: '인증 완료',
  STEP_UP: '추가 인증 필요',
  REJECT: '인증 거부',
  ERROR: '처리 오류',
};

function LoginScreen({ onLogin }: { onLogin: (user: LoginResponse) => void }) {
  const [username, setUsername] = useState('user');
  const [password, setPassword] = useState('demo');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      const user = await login(username, password);
      onLogin(user);
    } catch {
      setMessage('서버 연결에 실패했습니다. FastAPI 서버가 실행 중인지 확인하세요.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-panel">
        <div>
          <p>FaceAuth Demo</p>
          <h1>금융 얼굴인증 시연</h1>
          <span>일반 사용자는 얼굴인증 플로우로, 관리자는 운영 대시보드로 진입합니다.</span>
        </div>
        <form onSubmit={handleSubmit}>
          <label>
            <span>아이디</span>
            <input value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label>
            <span>비밀번호</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {message && <p className="form-message">{message}</p>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? '로그인 중' : '로그인'}
          </button>
        </form>
        <div className="demo-accounts">
          <button type="button" onClick={() => setUsername('user')}>일반 사용자</button>
          <button type="button" onClick={() => setUsername('admin')}>관리자</button>
        </div>
      </section>
    </main>
  );
}

type DemoScenario = 'normal' | 'attack' | 'quality_fail' | 'timeout';

const scenarioLabels: Record<DemoScenario, string> = {
  normal: '데모 영상 인증',
  attack: '공격 탐지',
  quality_fail: '품질 실패',
  timeout: '타임아웃',
};

function UserAuthShell({ user, onLogout }: { user: LoginResponse; onLogout: () => void }) {
  const [started, setStarted] = useState<FaceAuthStartResponse | null>(null);
  const [result, setResult] = useState<FaceAuthVerifyResponse | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleStart() {
    setIsWorking(true);
    setMessage(null);
    setResult(null);
    try {
      setStarted(await startFaceAuth(user.display_name));
    } catch {
      setMessage('인증 세션을 시작하지 못했습니다. 백엔드 서버를 확인하세요.');
    } finally {
      setIsWorking(false);
    }
  }

  async function handleVerify(scenario: DemoScenario) {
    if (!started) {
      return;
    }
    setIsWorking(true);
    setMessage(null);
    try {
      setResult(await verifyFaceAuth(started.session_id, scenario));
    } catch {
      setMessage('인증 결과를 가져오지 못했습니다. 백엔드 서버를 확인하세요.');
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <main className="user-shell">
      <section className="panel user-card face-auth-card">
        <div className="section-heading">
          <div>
            <p>Customer FaceAuth</p>
            <h1>{user.display_name}</h1>
            <span className="header-description">현재 정상 인증은 모델팀이 전달한 데모 영상으로 HC160 CLI를 실행합니다.</span>
          </div>
          <button type="button" onClick={onLogout}>로그아웃</button>
        </div>

        <div className="camera-preview" aria-label="Demo video authentication status">
          <div>
            <span />
            <strong>{isWorking ? '데모 영상 기반 인증 실행 중' : started ? '데모 인증 세션 준비됨' : '얼굴인증 시연 대기'}</strong>
            <p>
              {isWorking
                ? 'FastAPI가 HC160 CLI에 demo video를 전달해 실제 모델 판정을 요청하고 있습니다.'
                : started?.challenge ?? '시작 버튼을 눌러 인증 세션을 생성하세요. 브라우저 카메라는 아직 사용하지 않습니다.'}
            </p>
          </div>
        </div>

        <div className="auth-actions">
          <button type="button" onClick={handleStart} disabled={isWorking}>
            {started ? '세션 다시 시작' : '데모 인증 세션 시작'}
          </button>
          {started && (
            <div>
              {(Object.keys(scenarioLabels) as DemoScenario[]).map((scenario) => (
                <button type="button" key={scenario} onClick={() => handleVerify(scenario)} disabled={isWorking}>
                  {scenarioLabels[scenario]}
                </button>
              ))}
            </div>
          )}
        </div>

        {message && <p className="form-message">{message}</p>}

        {result && (
          <section className={`auth-result result-${result.session.final_decision.toLowerCase()}`}>
            <div>
              <span className={`pill ${decisionTone(result.session.final_decision)}`}>{result.session.final_decision}</span>
              <strong>{result.user_message}</strong>
              <p>session_id: {result.session.session_id}</p>
            </div>
            <div className="user-result-grid">
              <div>
                <span>다음 행동</span>
                <strong>{result.next_action}</strong>
              </div>
              <div>
                <span>처리 상태</span>
                <strong>{result.session.status}</strong>
              </div>
              <div>
                <span>처리 시간</span>
                <strong>{formatNumber(result.session.latency_ms)}ms</strong>
              </div>
              <div>
                <span>질의 예산</span>
                <strong>{result.session.query_budget.used}/{result.session.query_budget.limit}</strong>
              </div>
            </div>
            <div className="customer-gate-list">
              {result.session.gates
                .filter((gate) => gate.status !== 'PASS')
                .map((gate) => (
                  <span key={gate.gate_id}>
                    {gate.gate_id}: {gate.status}{gate.reason_code ? ` / ${gate.reason_code}` : ''}
                  </span>
                ))}
            </div>
            {result.attack_detected && (
              <div className="solution-box">
                <h2>경고 및 솔루션</h2>
                {result.solutions.map((solution) => (
                  <span key={solution}>{solution}</span>
                ))}
              </div>
            )}
            {!result.attack_detected && result.solutions.length > 0 && (
              <div className="solution-box">
                <h2>다음 조치</h2>
                {result.solutions.map((solution) => (
                  <span key={solution}>{solution}</span>
                ))}
              </div>
            )}
          </section>
        )}
      </section>
    </main>
  );
}

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
  user,
  onLogout,
}: {
  activeMode: DashboardMode;
  onModeChange: (mode: DashboardMode) => void;
  user: LoginResponse;
  onLogout: () => void;
}) {
  const navItems =
    activeMode === 'hc160'
      ? [
          ['#hc-overview', 'Current Session'],
          ['#hc-gates', 'L0-L4 Gates'],
          ['#hc-history', 'Session History'],
          ['#hc-system', 'System Status'],
        ]
      : activeMode === 'defense'
        ? [
            ['#defense-overview', 'Overview'],
            ['#defense-pipeline', 'Pipeline'],
            ['#defense-sessions', 'Sessions'],
            ['#risk-score', 'Risk Score'],
            ['#feature-squeezing', 'Squeezing'],
          ]
        : [
            ['#overview', 'Overview'],
            ['#families', 'Attack Types'],
            ['#sessions', 'Risk Sessions'],
            ['#accounts', 'Accounts'],
            ['#timeline', 'Timeline'],
            ['#rules', 'Rules'],
          ];

  return (
    <header className="top-bar">
      <div className="brand-block">
        <strong>FaceAuth</strong>
        <small>{activeMode === 'hc160' ? 'HC160' : 'Forensics'}</small>
      </div>
      <div className="mode-switch" aria-label="Dashboard mode">
        <button className={activeMode === 'attack' ? 'active' : ''} type="button" onClick={() => onModeChange('attack')}>
          Attack
        </button>
        <button className={activeMode === 'defense' ? 'active' : ''} type="button" onClick={() => onModeChange('defense')}>
          Defense
        </button>
        <button className={activeMode === 'hc160' ? 'active' : ''} type="button" onClick={() => onModeChange('hc160')}>
          HC160
        </button>
      </div>
      <nav className="top-nav" aria-label="Dashboard sections">
        {navItems.map(([href, label], index) => (
          <a href={href} className={index === 0 ? 'active' : ''} key={href}>
            {label}
          </a>
        ))}
      </nav>
      <div className="admin-session">
        <span>{user.display_name}</span>
        <button type="button" onClick={onLogout}>로그아웃</button>
      </div>
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

function RiskScoreGuidePanel() {
  const rules = [
    { event: 'Feature Squeezing 1개 squeezer 탐지', score: '+10', level: '주의' },
    { event: 'Feature Squeezing 2개 squeezer 탐지', score: '+20', level: '주의' },
    { event: 'Feature Squeezing 3개 squeezer 탐지', score: '+30', level: '위험' },
    { event: '2단계 앙상블에서 차단됨', score: '+40', level: '위험' },
    { event: '1단계 시간적 일관성에서 차단됨', score: '+50', level: '위험' },
  ];

  return (
    <section className="panel" id="risk-score">
      <div className="section-heading">
        <div>
          <p>Risk Score</p>
          <h2>위험도 스코어 기준</h2>
        </div>
      </div>
      <div className="risk-score-guide">
        {rules.map((rule) => (
          <article key={rule.event}>
            <span>{rule.event}</span>
            <strong>{rule.score}</strong>
            <b>{rule.level}</b>
          </article>
        ))}
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
          <span>Epochs</span>
          <strong>{history.epochs}</strong>
        </div>
        <div>
          <span>Learning Rate</span>
          <strong>{history.lr}</strong>
        </div>
        <div>
          <span>Margin</span>
          <strong>{history.margin}</strong>
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
        <RiskScoreGuidePanel />
        <FeatureSqueezingPanel rows={data.featureSqueezing} />
      </div>
      <div className="secondary-grid defense-analysis-grid">
        <AdvTrainingPanel history={data.trainingHistory} />
      </div>
    </>
  );
}

function decisionTone(decision: HcFinalDecision) {
  if (decision === 'ACCEPT') {
    return 'risk-low';
  }
  if (decision === 'STEP_UP') {
    return 'risk-high';
  }
  return 'risk-critical';
}

function gateTone(status: HcGateStatus) {
  if (status === 'PASS') {
    return 'risk-low';
  }
  if (status === 'FAIL' || status === 'TIMEOUT') {
    return 'risk-critical';
  }
  if (status === 'ERROR' || status === 'UNAVAILABLE') {
    return 'risk-high';
  }
  return 'risk-medium';
}

function gateLayer(gateId: string) {
  if (gateId.startsWith('L2B')) {
    return 'L2B';
  }
  return gateId.split('_')[0] ?? gateId;
}

function Hc160Overview({ data }: { data: Hc160DashboardData }) {
  const { sessionResult } = data;
  const remaining = Math.max(sessionResult.query_budget.limit - sessionResult.query_budget.used, 0);

  return (
    <section className="hc-overview" id="hc-overview">
      <article className="panel hc-current-session">
        <div className="section-heading">
          <div>
            <p>Current Session</p>
            <h2>{sessionResult.session_id}</h2>
          </div>
          <span className={`pill ${decisionTone(sessionResult.final_decision)}`}>{sessionResult.final_decision}</span>
        </div>
        <div className="decision-board">
          <div>
            <span>처리 상태</span>
            <strong>{sessionResult.status}</strong>
          </div>
          <div>
            <span>최종 판정</span>
            <strong>{decisionLabels[sessionResult.final_decision]}</strong>
          </div>
          <div>
            <span>전체 처리 시간</span>
            <strong>{formatNumber(sessionResult.latency_ms)}ms</strong>
          </div>
          <div>
            <span>시도 / 남은 예산</span>
            <strong>{sessionResult.attempt_count}회 / {remaining}회</strong>
          </div>
        </div>
        <dl className="detail-grid hc-meta-grid">
          <div>
            <dt>Created At</dt>
            <dd>{formatDateTime(sessionResult.created_at)}</dd>
          </div>
          <div>
            <dt>Completed At</dt>
            <dd>{formatDateTime(sessionResult.completed_at ?? '')}</dd>
          </div>
          <div>
            <dt>Policy Version</dt>
            <dd>{sessionResult.decision_provenance.policy_version}</dd>
          </div>
          <div>
            <dt>Calibration Artifact</dt>
            <dd>{sessionResult.decision_provenance.calibration_artifact_id}</dd>
          </div>
        </dl>
      </article>

      <article className="panel step-up-panel">
        <div className="section-heading">
          <div>
            <p>Step-up</p>
            <h2>추가 인증 상태</h2>
          </div>
          <span>{sessionResult.query_budget.exceeded ? 'Budget exceeded' : `${remaining} attempts left`}</span>
        </div>
        {sessionResult.final_decision === 'STEP_UP' ? (
          <>
            <strong>백엔드 판정에 따라 추가 인증이 필요합니다.</strong>
            <p>대체 인증 수단을 제시하고, 남은 시도 횟수 안에서 다음 단계를 진행합니다.</p>
            <div className="step-actions" aria-label="Available step-up methods">
              <span>OTP</span>
              <span>ARS</span>
              <span>계좌 비밀번호 재확인</span>
            </div>
          </>
        ) : (
          <>
            <strong>{decisionLabels[sessionResult.final_decision]}</strong>
            <p>현재 응답의 최종 판정을 그대로 표시합니다.</p>
          </>
        )}
      </article>
    </section>
  );
}

function GateTimeline({ gates }: { gates: HcGateResult[] }) {
  return (
    <section className="panel" id="hc-gates">
      <div className="section-heading">
        <div>
          <p>Layered Defense</p>
          <h2>L0~L4 계층별 방어 상태</h2>
        </div>
        <span>backend result only</span>
      </div>
      <div className="gate-timeline">
        {gates.map((gate) => {
          const layer = gateLayer(gate.gate_id);
          return (
            <article key={gate.gate_id}>
              <div className="gate-layer">
                <strong>{layer}</strong>
                <InfoTooltip text={gateDescriptions[layer] ?? '백엔드가 반환한 gate 결과입니다.'} />
              </div>
              <div className="gate-body">
                <div>
                  <strong>{gate.label ?? gate.gate_id}</strong>
                  <span>{gate.gate_id}</span>
                </div>
                <dl>
                  <div>
                    <dt>Status</dt>
                    <dd><span className={`pill ${gateTone(gate.status)}`}>{gate.status}</span></dd>
                  </div>
                  <div>
                    <dt>Role</dt>
                    <dd>{gate.role}</dd>
                  </div>
                  <div>
                    <dt>Latency</dt>
                    <dd>{gate.latency_ms === null ? 'UNAVAILABLE' : `${formatNumber(gate.latency_ms)}ms`}</dd>
                  </div>
                  <div>
                    <dt>Reason</dt>
                    <dd>{gate.reason_code ?? '-'}</dd>
                  </div>
                </dl>
                <div className="provenance-row">
                  <code>{gate.provenance.artifact_id}</code>
                  <code>{gate.provenance.model_version}</code>
                  <code>{gate.provenance.policy_version}</code>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Hc160History({ rows }: { rows: HcSessionSummary[] }) {
  const [filter, setFilter] = useState<HcHistoryFilter>('all');
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (filter === 'all') {
          return true;
        }
        if (filter === 'step_up') {
          return row.step_up;
        }
        if (filter === 'error') {
          return row.has_error;
        }
        return row.final_decision === filter;
      }),
    [filter, rows],
  );

  return (
    <section className="panel" id="hc-history">
      <div className="section-heading">
        <div>
          <p>Session History</p>
          <h2>세션 이력 및 감사 요약</h2>
        </div>
        <span>{formatNumber(filteredRows.length)} rows</span>
      </div>
      <div className="filters hc-filters">
        <div>
          <span>final_decision / event</span>
          {hcHistoryFilters.map((value) => (
            <FilterButton key={value} value={value} active={filter === value} onClick={setFilter} />
          ))}
        </div>
      </div>
      <div className="table-wrap hc-history-table">
        <table>
          <thead>
            <tr>
              <th>created_at</th>
              <th>session_id</th>
              <th>status</th>
              <th>final_decision</th>
              <th>latency</th>
              <th>attempts</th>
              <th>step_up</th>
              <th>error</th>
              <th>failed_gate</th>
              <th>policy/model/artifact</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={row.session_id}>
                <td>{formatDateTime(row.created_at)}</td>
                <td>{row.session_id}</td>
                <td>{row.status}</td>
                <td><span className={`pill ${decisionTone(row.final_decision)}`}>{row.final_decision}</span></td>
                <td>{formatNumber(row.latency_ms)}ms</td>
                <td>{row.attempt_count}</td>
                <td>{row.step_up ? 'true' : 'false'}</td>
                <td>{row.has_error ? 'true' : 'false'}</td>
                <td>{row.failed_gate ?? '-'}</td>
                <td>{row.policy_version} / {row.model_version} / {row.artifact_version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SystemStatusPanel({ rows }: { rows: HcSystemStatusRow[] }) {
  return (
    <section className="panel" id="hc-system">
      <div className="section-heading">
        <div>
          <p>System Status</p>
          <h2>시스템 상태</h2>
        </div>
      </div>
      <div className="system-grid">
        {rows.map((row) => (
          <article key={row.component}>
            <div>
              <strong>{row.component}</strong>
              <span className={`pill ${row.status === 'OK' ? 'risk-low' : 'risk-high'}`}>{row.status}</span>
            </div>
            <dl>
              <div>
                <dt>Last OK</dt>
                <dd>{formatDateTime(row.last_ok_at)}</dd>
              </div>
              <div>
                <dt>Errors</dt>
                <dd>{row.error_count}</dd>
              </div>
              <div>
                <dt>P50 / P95</dt>
                <dd>
                  {row.latency_p50_ms === null ? 'MEASUREMENT_PENDING' : `${row.latency_p50_ms}ms / ${row.latency_p95_ms}ms`}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

function Hc160Dashboard({ data }: { data: Hc160DashboardData }) {
  return (
    <>
      <header className="app-header">
        <div>
          <p>HC160 Operations</p>
          <h1>Session Result Dashboard</h1>
          <span className="header-description">
            백엔드가 계산한 인증 결과와 L0~L4 계층 상태를 운영자 화면에서 안전하게 표시합니다.
          </span>
        </div>
        <div className="header-meta">
          <span className="status-dot">API contract mock</span>
          <span>schema {data.sessionResult.schema_version}</span>
          <span>No client-side decision</span>
        </div>
      </header>
      <Hc160Overview data={data} />
      <GateTimeline gates={data.sessionResult.gates} />
      <Hc160History rows={data.sessionSummaries} />
      <SystemStatusPanel rows={data.systemStatus} />
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
  const [hc160Data, setHc160Data] = useState<Hc160DashboardData | null>(null);
  const [activeMode, setActiveMode] = useState<DashboardMode>('attack');
  const [currentUser, setCurrentUser] = useState<LoginResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadDashboardData(), loadDefenseDashboardData(), loadHc160DashboardData()])
      .then(([attack, defense, hc160]) => {
        setAttackData(attack);
        setDefenseData(defense);
        setHc160Data(hc160);
      })
      .catch((error: Error) => setError(error.message));
  }, []);

  if (error) {
    return <div className="state-message">데이터 로드 실패: {error}</div>;
  }

  if (!currentUser) {
    return <LoginScreen onLogin={setCurrentUser} />;
  }

  if (currentUser.role === 'user') {
    return <UserAuthShell user={currentUser} onLogout={() => setCurrentUser(null)} />;
  }

  if (!attackData || !defenseData || !hc160Data) {
    return <div className="state-message">대시보드 데이터를 불러오는 중입니다.</div>;
  }

  return (
    <div className="console-shell">
      <TopBar activeMode={activeMode} onModeChange={setActiveMode} user={currentUser} onLogout={() => setCurrentUser(null)} />
      <main className="console-main">
        {activeMode === 'attack' && <AttackDashboard data={attackData} />}
        {activeMode === 'defense' && <DefenseDashboard data={defenseData} />}
        {activeMode === 'hc160' && <Hc160Dashboard data={hc160Data} />}
      </main>
    </div>
  );
}
