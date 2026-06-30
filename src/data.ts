import type {
  AttackFamilyRow,
  AttackSession,
  DashboardOverview,
  RiskSession,
  RuleDefinitionFile,
  RuleHitSummary,
} from './types';

const DATA_BASE = '/forensics';

const defaultNumberFields = new Set([
  'sessions',
  'accepted_after_attack',
  'attack_accept_rate',
  'critical',
  'high',
  'medium',
  'low',
  'avg_risk_score',
  'epsilon',
  'similarity_before',
  'similarity_after_attack',
  'threshold_margin',
  'risk_score',
  'alpha',
  'steps',
  'queries_used',
  'similarity_gain',
  'threshold',
  'l2',
  'linf',
  'time_sec',
]);

const defaultBooleanFields = new Set([
  'accepted_before',
  'attack_success_before_defense',
  'is_adaptive',
]);

function parseCsv(
  text: string,
  options: { numberFields?: Set<string>; booleanFields?: Set<string> } = {},
) {
  const numberFields = options.numberFields ?? defaultNumberFields;
  const booleanFields = options.booleanFields ?? defaultBooleanFields;
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(current);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      current = '';
      continue;
    }

    current += char;
  }

  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }

  const [headers, ...body] = rows;
  return body.map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => {
        const raw = cells[index] ?? '';
        if (booleanFields.has(header)) {
          return [header, raw.toLowerCase() === 'true'];
        }
        if (numberFields.has(header)) {
          return [header, raw === '' ? null : Number(raw)];
        }
        return [header, raw];
      }),
    ),
  );
}

async function fetchText(path: string) {
  const response = await fetch(`${DATA_BASE}/${path}`);
  if (!response.ok) {
    throw new Error(`${path} 파일을 불러오지 못했습니다.`);
  }
  return response.text();
}

async function fetchCsv<T>(path: string, options?: Parameters<typeof parseCsv>[1]) {
  const text = await fetchText(path);
  return parseCsv(text, options) as T[];
}

export async function loadDashboardData() {
  const [overview, familyRows, topRiskSessions, attackSessions, ruleSummary, ruleFile] =
    await Promise.all([
      fetch(`${DATA_BASE}/dashboard_overview.json`).then((response) => response.json() as Promise<DashboardOverview>),
      fetchCsv<AttackFamilyRow>('attack_family_matrix.csv'),
      fetchCsv<RiskSession>('top_risk_sessions.csv', {
        booleanFields: new Set([...defaultBooleanFields, 'accepted_after_attack']),
      }),
      fetchCsv<AttackSession>('attack_sessions.csv', {
        booleanFields: new Set([...defaultBooleanFields, 'accepted_after_attack']),
      }),
      fetchCsv<RuleHitSummary>('rule_hit_summary.csv'),
      fetch(`${DATA_BASE}/attack_detection_rules.json`).then((response) => response.json() as Promise<RuleDefinitionFile>),
    ]);

  return {
    overview,
    familyRows,
    topRiskSessions: topRiskSessions.sort((a, b) => b.risk_score - a.risk_score),
    attackSessions,
    ruleSummary,
    rules: ruleFile.rules,
  };
}
