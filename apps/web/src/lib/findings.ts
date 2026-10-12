import type { AnalyticsSummary, ApiClient, QuarantineEntry } from './api';
import type { QaClient } from './qa-client.js';
import type {
  QaFlakyResponse,
  QaGapsResponse,
  QaHollowResponse,
  QaScore,
  QaStructureResponse,
} from './qa.js';

/**
 * The findings engine: seven reads in, a ranked list of statements out.
 *
 * ## Why this lives in `lib/` and not in a screen
 *
 * The rules below are the product — a zero caps the geometric mean, a flaky cell
 * is a decision, a hollow test is a lie. They were written inside the MAIN
 * dashboard and then inside the insights screen, and the two copies had already
 * drifted apart in their doc comments. One engine, one home: a screen renders
 * what it is given, and the derivation is testable without rendering anything.
 *
 * ## Every rule names its source and its citation
 *
 * A finding without the read it came from is a guess, and a finding without the
 * values that decided it is a guess the reader cannot check. `source` is the
 * endpoint; `citation` is the values. Both are asserted in `findings.test.ts`,
 * because an engine that cannot say where it got a number is an engine nobody
 * should act on.
 */

/** One endpoint's answer, or the sentence explaining why there is none. */
export interface Reading<T> {
  value: T | null;
  failure: string | null;
}

/**
 * The seven reads the cockpit takes, settled independently.
 *
 * **Every field is nullable for exactly one reason: the read failed.** There is
 * no field the API omits — `/qa/hollow` answers `{ cells: [] }` when there are
 * none, and `/qa/structure` answers `{ findings: [] }`, so a null value is
 * always "we could not ask" and never "the answer was nothing". The two reads
 * that used to arrive nullable for the opposite reason are why this comment
 * exists: `loadSeven` caught their rejections and turned a dead endpoint into
 * an empty answer, which is a screen that renders "no hollow tests" about an
 * endpoint that never answered. `Promise.allSettled` settles the difference —
 * a read that failed is `failure`, a read that answered is `value`, and the two
 * are not interchangeable.
 */
export interface FindingsSnapshot {
  analytics: Reading<AnalyticsSummary>;
  score: Reading<QaScore>;
  flaky: Reading<QaFlakyResponse>;
  gaps: Reading<QaGapsResponse>;
  quarantine: Reading<QuarantineEntry[]>;
  hollow: Reading<QaHollowResponse>;
  structure: Reading<QaStructureResponse>;
}

/**
 * One derived finding: a statement about the suite, with what supports it.
 *
 * `severity` is the action's urgency, not the number's size. A flaky cell is
 * `critical` because it blocks a decision; a thin category is `warning` because
 * it is a trend, not a blocker.
 */
export interface Finding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  statement: string;
  /** The endpoint the rule read, e.g. `qa/score`. */
  source: string;
  /** The values that decided it, e.g. `cappedBy=security · cappingValue=0`. */
  citation: string;
  action: string;
}

/**
 * One rule: a snapshot in, a finding out, or nothing at all.
 *
 * ## Why each rule is its own function
 *
 * This used to be one `deriveFindings` body with seven `if` blocks, and the
 * body grew past the repository's complexity ceiling the moment the sixth rule
 * went in — the same warning a second screen would have brought. Extracted, each
 * rule is a named judgement with its own doc comment and its own test, and the
 * engine is a list rather than a wall. **Order is the list's order, and the list
 * is the severity order**, so the verdict card reads most urgent first without
 * the body having to say so.
 */
type FindingRule = (snapshot: FindingsSnapshot) => Finding | null;

/** Rule 1: a zero caps the geometric mean. */
function zeroCapsMean(snapshot: FindingsSnapshot): Finding | null {
  const score = snapshot.score.value;
  if (score === null || score.cappingValue !== 0) return null;
  return {
    id: 'zero-caps-mean',
    severity: 'critical',
    title: 'One zero caps the total',
    statement: `${score.cappedBy} is at 0.00. Because the total is a weighted geometric mean, one zero caps it — the other rows cannot average it away.`,
    source: 'qa/score',
    citation: `cappedBy=${score.cappedBy} · cappingValue=0`,
    action: 'Close the zero row first. Nothing else moves the total as much.',
  };
}

/** Rule 2: flaky cells are decisions, not trends. */
function flakyDecision(snapshot: FindingsSnapshot): Finding | null {
  const cells = snapshot.flaky.value?.cells ?? [];
  if (cells.length === 0) return null;
  const worst = cells.slice().sort((left, right) => right.flakeRate - left.flakeRate)[0];
  const singular = cells.length === 1;
  return {
    id: 'flaky-decision',
    severity: 'critical',
    title: `${cells.length} flaky cell${singular ? '' : 's'} ${singular ? 'needs' : 'need'} a decision`,
    statement: `Same fingerprint, same commit, different outcome. ${worst.cell} flakes at ${(worst.flakeRate * 100).toFixed(1)}% — weak evidence never quarantines a test on its own, so a human has to decide.`,
    source: 'qa/flaky',
    citation: `${cells.length} cells · worst ${worst.cell} at ${(worst.flakeRate * 100).toFixed(1)}%`,
    action:
      'Fix the flake, or quarantine the fingerprints. Do not ignore it — a flaky suite teaches you to ignore red.',
  };
}

/** Rule 3: hollow tests are lies the pass rate tells. */
function hollowTests(snapshot: FindingsSnapshot): Finding | null {
  const cells = snapshot.hollow.value?.cells ?? [];
  if (cells.length === 0) return null;
  const singular = cells.length === 1;
  return {
    id: 'hollow-tests',
    severity: 'warning',
    title: `${cells.length} hollow test${singular ? '' : 's'} ${singular ? 'inflates' : 'inflate'} the pass rate`,
    statement: `Green, and contributing nothing. A hollow test raises the pass rate and lowers no other number, so the headline looks better than the suite is.`,
    source: 'qa/hollow',
    citation: `${cells.length} cells · ${cells.map((cell) => cell.cell).join(', ')}`,
    action: 'Delete the hollow tests, or give them an assertion that can fail.',
  };
}

/** Rule 4: structural findings are reported, never scored. */
function structuralFindings(snapshot: FindingsSnapshot): Finding | null {
  const findings = snapshot.structure.value?.findings ?? [];
  const first = findings[0];
  if (first === undefined) return null;
  return {
    id: 'structural-findings',
    severity: 'warning',
    title: `${findings.length} structural finding${findings.length === 1 ? '' : 's'}`,
    statement: first.statement,
    source: 'qa/structure',
    citation: `${findings.length} findings · impact ${first.impact.toFixed(2)}`,
    action:
      'Read the structural findings beside the score — they are reported, never scored, so they do not move the total.',
  };
}

/** Rule 5: gaps without a closure are not tasks. */
function gapQueue(snapshot: FindingsSnapshot): Finding | null {
  const closable = (snapshot.gaps.value?.gaps ?? []).filter(
    (gap) => gap.cheapestClosure.length > 0,
  );
  const best = closable.slice().sort((left, right) => right.potential - left.potential)[0];
  if (best === undefined) return null;
  return {
    id: 'gap-queue',
    severity: 'info',
    title: `${closable.length} closable gap${closable.length === 1 ? '' : 's'}`,
    statement: `${best.cell} is worth up to +${(best.potential * 100).toFixed(0)} points: ${best.cheapestClosure}.`,
    source: 'qa/gaps',
    citation: `${closable.length} gaps · best ${best.cell} worth +${(best.potential * 100).toFixed(0)} pts`,
    action:
      'Work the queue top-down. A gap with no closure is a cell with a low number, not a task.',
  };
}

/** Rule 6: quarantine entries pending a decision. */
function quarantinePending(snapshot: FindingsSnapshot): Finding | null {
  const pending = (snapshot.quarantine.value ?? []).filter((entry) => entry.status === 'pending');
  if (pending.length === 0) return null;
  const singular = pending.length === 1;
  return {
    id: 'quarantine-pending',
    severity: 'warning',
    title: `${pending.length} quarantined test${singular ? '' : 's'} ${singular ? 'awaits' : 'await'} a verdict`,
    statement:
      'Quarantined but undecided, so they still count in the pass rate. Approving removes them; rejecting restores them.',
    source: 'dashboard/quarantine',
    citation: `${pending.length} pending · ${pending.map((entry) => entry.testTitle).join(', ')}`,
    action: 'Decide each one. A quarantine that never gets a verdict is a test nobody owns.',
  };
}

/** Rule 7: the pass rate is a number, not an answer. */
function passRate(snapshot: FindingsSnapshot): Finding | null {
  const analytics = snapshot.analytics.value;
  if (analytics === null) return null;
  return {
    id: 'pass-rate',
    severity: 'info',
    title: 'Pass rate',
    statement: `${analytics.passRate.toFixed(1)}% across ${analytics.totalRuns} runs. ${analytics.avgDurationMs === null ? 'Average duration not measured.' : `Average duration ${analytics.avgDurationMs}ms.`}`,
    source: 'dashboard/analytics/summary',
    citation: `passRate=${analytics.passRate} · totalRuns=${analytics.totalRuns}`,
    action:
      'Read the pass rate beside the flake rate. A high pass rate with high flake is a suite that passes by luck.',
  };
}

/**
 * The rules, in the order they are read.
 *
 * **Severity descending, then by how much a decision costs.** A reader who acts
 * on the first line and stops has still seen the thing that matters; adding a
 * rule is appending to this list, and the ordering claim is asserted in
 * `findings.test.ts` rather than trusted to the editor.
 */
const RULES: readonly FindingRule[] = [
  zeroCapsMean,
  flakyDecision,
  hollowTests,
  structuralFindings,
  gapQueue,
  quarantinePending,
  passRate,
];

/**
 * Derive findings from a settled snapshot.
 *
 * **Pure, and named for what it does.** The rules are the product:
 * a zero caps the geometric mean, a flaky cell is a decision, a
 * hollow test is a lie, and a gap without a closure is not a task.
 */
export function deriveFindings(snapshot: FindingsSnapshot): readonly Finding[] {
  return RULES.map((rule) => rule(snapshot)).filter(
    (finding): finding is Finding => finding !== null,
  );
}

/**
 * The seven reads, settled independently, into findings.
 *
 * ## Why the reads live beside the engine and not in a screen
 *
 * **Every screen that shows findings was settling these seven itself.** The
 * cockpit had `loadSeven`, the insights screen had `loadFindings`, and the two
 * had already drifted: one caught a rejection and answered "no hollow cells"
 * about an endpoint that never responded, and the other did not. Both are now
 * this function, so a dead endpoint arrives as a `failure` on every screen that
 * renders one, in the same words.
 *
 * A `failure` is never coerced to an empty answer. `Promise.allSettled` is what
 * holds the distinction — a read that failed says so, and a screen that cannot
 * tell the two apart is a screen that reports a dead endpoint as a clean bill.
 */
export async function readFindings(
  api: ApiClient,
  qa: QaClient,
  projectId: string | undefined,
  signal: AbortSignal,
): Promise<{ findings: readonly Finding[]; failures: readonly string[] }> {
  if (projectId === undefined) return { findings: [], failures: [] };
  // The read labels, in the same order as the settled results below. A screen
  // that needs to say *which* reads are down needs the names, and the names are
  // the endpoints the reader actually called.
  const sources = [
    'dashboard/analytics/summary',
    'qa/score',
    'qa/flaky',
    'qa/gaps',
    'dashboard/quarantine',
    'qa/hollow',
    'qa/structure',
  ] as const;
  const settled = await Promise.allSettled([
    api.getAnalyticsSummary({ signal }),
    qa.getScore(projectId),
    qa.getFlaky(projectId),
    qa.getGaps(projectId),
    api.getQuarantine({ signal }),
    qa.getHollow(projectId),
    qa.getStructure(projectId),
  ]);
  // The names of the reads that did not answer. A screen that has to say *which*
  // of the seven is down needs them, and the filter is a plain `!== null` because
  // the mapped element is already `string | null`.
  const failures = settled
    .map((result, index) => (result.status === 'rejected' ? (sources[index] ?? 'unknown') : null))
    .filter((source) => source !== null);
  const value = <T>(position: number): T => {
    const result = settled[position];
    return result !== undefined && result.status === 'fulfilled'
      ? (result.value as T)
      : (undefined as unknown as T);
  };
  const failure = (position: number): string | null => {
    const result = settled[position];
    if (result === undefined || result.status === 'fulfilled') return null;
    return result.reason instanceof Error ? result.reason.message : 'not available';
  };
  const snapshot: FindingsSnapshot = {
    analytics: {
      value: (value(0) as AnalyticsSummary | undefined) ?? null,
      failure: failure(0),
    },
    score: { value: (value(1) as QaScore | undefined) ?? null, failure: failure(1) },
    flaky: { value: (value(2) as QaFlakyResponse | undefined) ?? null, failure: failure(2) },
    gaps: { value: (value(3) as QaGapsResponse | undefined) ?? null, failure: failure(3) },
    quarantine: { value: (value(4) as QuarantineEntry[] | undefined) ?? null, failure: failure(4) },
    hollow: { value: (value(5) as QaHollowResponse | undefined) ?? null, failure: failure(5) },
    structure: {
      value: (value(6) as QaStructureResponse | undefined) ?? null,
      failure: failure(6),
    },
  };
  return { findings: deriveFindings(snapshot), failures };
}
