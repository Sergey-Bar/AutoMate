import type { DigestItem, QaGapsResponse, ReadinessReason, ReleaseReadinessCard } from './qa.js';

/**
 * "Can I ship, what is wrong, what is good" — the Overview's three answers, as data.
 *
 * Pure, so the ranking is a unit test rather than something a reader infers from a
 * screenshot. The readiness verdict is computed on the server (`evaluateReadiness` in
 * `@automate/reporting`); this only orders what it said and joins the week's digest and
 * the score's gap queue to it.
 *
 * ## The order is the argument
 *
 * What is wrong leads with what *blocks* (`no-go`), then what *warns* (`caution`), then
 * what nobody measured (`unknown` — never silently a pass), then the week's bad news, then
 * the gaps ranked by what closing them is worth. Every item carries the evidence it was
 * read from and one next action, so the list is a queue rather than a complaint.
 */

export type FindingTone = 'bad' | 'warn' | 'unknown' | 'good';

/** A page a finding can send the reader to: a route pattern, and its params if it has any. */
export type FindingAction =
  | {
      label: string;
      to:
        | '/dashboard/runs'
        | '/dashboard/analytics'
        | '/dashboard/insights'
        | '/dashboard/map'
        | '/dashboard/quarantine'
        | '/dashboard/runner';
    }
  | { label: string; to: '/dashboard/gaps/$projectId'; params: { projectId: string } };

/** The concrete path an action opens. */
export function hrefOf(action: FindingAction): string {
  return 'params' in action
    ? action.to.replace('$projectId', encodeURIComponent(action.params.projectId))
    : action.to;
}

export interface Finding {
  id: string;
  tone: FindingTone;
  title: string;
  evidence: string;
  action: FindingAction;
}

export interface HealthSummary {
  verdict: ReleaseReadinessCard['verdict'] | null;
  headline: string;
  wrong: Finding[];
  good: Finding[];
}

/** How many findings a column shows before "Show all". */
export const WRONG_SHOWN = 5;

const REASON_ACTION: Record<ReadinessReason['code'], Finding['action']> = {
  gate: { label: 'Open runs', to: '/dashboard/runs' },
  'pass-rate': { label: 'See the trend', to: '/dashboard/analytics' },
  flaky: { label: 'See flaky tests', to: '/dashboard/insights' },
  coverage: { label: 'Find the gap', to: '/dashboard/map' },
  quarantine: { label: 'Review quarantine', to: '/dashboard/quarantine' },
  activity: { label: 'Launch a run', to: '/dashboard/runner' },
};

const DIGEST_ACTION: Record<DigestItem['kind'], Finding['action']> = {
  'new-flaky': { label: 'See flaky tests', to: '/dashboard/insights' },
  'newly-slow': { label: 'See slow tests', to: '/dashboard/insights' },
  'new-failure': { label: 'Open runs', to: '/dashboard/runs' },
  'pass-rate': { label: 'See the trend', to: '/dashboard/analytics' },
  coverage: { label: 'Open the map', to: '/dashboard/map' },
  runs: { label: 'Open runs', to: '/dashboard/runs' },
};

const LEVEL_RANK: Record<ReadinessReason['level'], number> = {
  'no-go': 0,
  caution: 1,
  unknown: 2,
  go: 3,
};

const LEVEL_TONE: Record<ReadinessReason['level'], FindingTone> = {
  'no-go': 'bad',
  caution: 'warn',
  unknown: 'unknown',
  go: 'good',
};

function fromReason(reason: ReadinessReason): Finding {
  return {
    id: `reason-${reason.code}`,
    tone: LEVEL_TONE[reason.level],
    title: reason.message,
    evidence: reason.evidence,
    action: REASON_ACTION[reason.code],
  };
}

function fromDigest(item: DigestItem, index: number): Finding {
  return {
    id: `digest-${item.kind}-${String(index)}`,
    tone: item.tone === 'good' ? 'good' : 'bad',
    title: item.text,
    evidence: 'Since the previous window',
    action: DIGEST_ACTION[item.kind],
  };
}

export function summarizeHealth({
  projectId,
  readiness,
  digest,
  gaps,
}: {
  projectId: string;
  readiness: ReleaseReadinessCard | null;
  digest: readonly DigestItem[];
  gaps: QaGapsResponse | null;
}): HealthSummary {
  const reasons = [...(readiness?.reasons ?? [])].sort(
    (left, right) => LEVEL_RANK[left.level] - LEVEL_RANK[right.level],
  );
  const news = digest.map((item, index) => ({ item, finding: fromDigest(item, index) }));
  const queue = [...(gaps?.gaps ?? [])]
    .sort((left, right) => right.potential - left.potential || left.cell.localeCompare(right.cell))
    .map(
      (gap): Finding => ({
        id: `gap-${gap.cell}`,
        tone: 'warn',
        title: gap.cheapestClosure,
        evidence: `${gap.cell} · +${(gap.potential * 100).toFixed(0)} pts`,
        action: { label: 'Fix', to: '/dashboard/gaps/$projectId', params: { projectId } },
      }),
    );

  const wrong = [
    ...reasons.filter((reason) => reason.level !== 'go').map(fromReason),
    ...news.filter(({ item }) => item.tone === 'bad').map(({ finding }) => finding),
    ...queue,
  ];
  const good = [
    ...reasons.filter((reason) => reason.level === 'go').map(fromReason),
    ...news.filter(({ item }) => item.tone === 'good').map(({ finding }) => finding),
  ];

  const worst = reasons[0];
  const headline =
    readiness === null
      ? 'Release readiness has not been read'
      : worst === undefined || worst.level === 'go'
        ? 'Every readiness check passes'
        : worst.message;

  return { verdict: readiness?.verdict ?? null, headline, wrong, good };
}
