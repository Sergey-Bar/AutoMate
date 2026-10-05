import { ScoreDeltaSchema, type QaScore, type ScoreDelta } from '@automate/shared-contracts';

/**
 * The provenance diff — **what moved, and what moved it**.
 *
 * ## Why this is not "the old total and the new total"
 *
 * A dashboard that renders `62 → 58` satisfies every assertion it makes while
 * telling the reader nothing they can act on: they already knew the number went
 * down, and they still do not know whether to fix a suite, a flaky test or a
 * coverage target. Plan §3.7 says the answer is "Security `D` fell because 3 target
 * files gained no coverage after commit `abc`", and this module is what turns a
 * change in `D` into that sentence.
 *
 * ## Every contribution names a component and cites a row
 *
 * Two failure modes, and the first is stopped by construction: `describeCellChange`
 * can only be reached with a component name, so there is no path through this file
 * that produces `depth: 0.1` as a whole sentence. The second — a contribution with
 * an empty `evidence` array — is refused by `ScoreDeltaSchema`, because a number
 * with no story is worse than no diff at all.
 *
 * ## Deterministic, and it refuses nonsense
 *
 * Same two readings, same diff — asserted, because a diff that changes when re-run
 * is a diff nobody can review. And it refuses a diff across projects, backwards in
 * time, or between two readings of the same rows, because the first two produce a
 * subtraction between two unrelated numbers and the third produces a subtraction of a
 * number against itself. See `assertDistinctWindows`.
 */

/** A component of a cell, in the order a reader would check them. */
const COMPONENTS = ['presence', 'depth', 'stability', 'signal'] as const;
type Component = (typeof COMPONENTS)[number];

interface CellView {
  key: string;
  score: number;
  presence: number;
  depth: number;
  stability: number;
  signal: number;
  inputs: {
    failedFingerprints: readonly string[];
    flakyFingerprints: readonly string[];
    hollowFingerprints: readonly string[];
  };
}

/** A whole-number difference, so `40 to 0` never reads as `40 to 0.0000001`. */
function fixed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * The component that moved **most**, and by how much.
 *
 * Largest first, and `presence` wins outright over anything else of equal
 * magnitude: a category that **disappeared** is what a reader must hear first, and
 * a cell whose score fell by 0.01 because a flake rate rose is not.
 */
function dominantChange(
  before: CellView,
  after: CellView,
): { component: Component; from: number; to: number } | null {
  let worst: { component: Component; from: number; to: number; magnitude: number } | null = null;
  for (const component of COMPONENTS) {
    const from = before[component];
    const to = after[component];
    if (from === to) continue;
    const magnitude = Math.abs(to - from);
    if (worst === null || magnitude > worst.magnitude || component === 'presence') {
      worst = { component, from, to, magnitude };
    }
  }
  return worst === null ? null : { component: worst.component, from: worst.from, to: worst.to };
}

/** One sentence naming the component and the counts behind it. */
function describeCellChange(
  key: string,
  change: { component: Component; from: number; to: number },
): string {
  const direction = change.to < change.from ? 'fell' : 'rose';
  switch (change.component) {
    case 'presence':
      return `${key} ${change.to > 0 ? 'gained' : 'lost'} a suite: presence ${fixed(change.from)} → ${fixed(change.to)}.`;
    case 'depth':
      return `${key} depth ${direction} from ${fixed(change.from)} to ${fixed(change.to)} — fewer executed tests or less measured coverage.`;
    case 'stability':
      return `${key} stability ${direction} from ${fixed(change.from)} to ${fixed(change.to)} — a fingerprint is flaking on one commit.`;
    case 'signal':
      return `${key} signal ${direction} from ${fixed(change.from)} to ${fixed(change.to)} — a test is passing without asserting anything.`;
  }
}

/** Everything a reader could open to check this cell's claim. */
function evidenceFor(cell: CellView, runsRead: number): string[] {
  return [
    ...new Set([
      `cell:${cell.key}`,
      ...cell.inputs.flakyFingerprints.map((fingerprint) => `test:${fingerprint}`),
      ...cell.inputs.hollowFingerprints.map((fingerprint) => `hollow:${fingerprint}`),
      `runs:${fixed(runsRead)}`,
    ]),
  ];
}

/** The structural copy this module reads. Narrower than `QaScore` on purpose. */
function cellsOf(reading: QaScore): Map<string, CellView> {
  return new Map(
    reading.cells.map((cell) => [
      cell.key,
      {
        key: cell.key,
        score: cell.score,
        presence: cell.presence,
        depth: cell.depth,
        stability: cell.stability,
        signal: cell.signal,
        inputs: {
          failedFingerprints: [...cell.inputs.failedFingerprints],
          flakyFingerprints: [...cell.inputs.flakyFingerprints],
          hollowFingerprints: [...cell.inputs.hollowFingerprints],
        },
      },
    ]),
  );
}

/**
 * The diff between two readings of the same project.
 *
 * `before` must be the earlier reading. A diff computed backwards reports the same
 * magnitudes with the wrong directions, which is worse than refusing: a reader
 * would be told a coverage target "rose" when it fell.
 */
export function diffScores(before: QaScore, after: QaScore): ScoreDelta {
  if (before.projectId !== after.projectId) {
    throw new Error(
      `Cannot diff two different projects: ${before.projectId} and ${after.projectId}. ` +
        "A subtraction between unrelated numbers attributes one project's change to another.",
    );
  }
  if (new Date(after.at).getTime() < new Date(before.at).getTime()) {
    throw new Error(
      `Cannot diff backwards: ${after.at} is before ${before.at}. A reversed diff reports the ` +
        'same magnitudes with the wrong directions.',
    );
  }

  const previousCells = cellsOf(before);
  const contributions: ScoreDelta['contributions'] = [];

  for (const cell of cellsOf(after).values()) {
    const previous = previousCells.get(cell.key);
    if (previous === undefined) continue;
    const change = dominantChange(previous, cell);
    if (change === null) continue;
    contributions.push({
      scope: 'cell',
      key: cell.key,
      before: round(previous.score),
      after: round(cell.score),
      cause: describeCellChange(cell.key, change),
      evidence: evidenceFor(cell, after.provenance.runsRead),
    });
  }

  contributions.push(...rowContributions(before, after), ...capContribution(before, after));

  if (before.pyramid.shape !== after.pyramid.shape) {
    contributions.push({
      scope: 'pyramid',
      key: 'pyramid-shape',
      before: round(before.pyramid.shape),
      after: round(after.pyramid.shape),
      cause: `The suite shape ${after.pyramid.shape < before.pyramid.shape ? 'drifted further from' : 'moved towards'} the target: ${fixed(before.pyramid.shape)} → ${fixed(after.pyramid.shape)}.`,
      evidence: [
        `score:${after.projectId}@${after.at}`,
        // `null` is the honest reference when the project declared no target: the
        // chart drew one, nobody chose it.
        after.pyramid.declaredTarget === null
          ? 'pyramid:no-declared-target'
          : `pyramid:target-${fixed(after.pyramid.declaredTarget.unit)}`,
      ],
    });
  }

  assertDistinctWindows(before, after, contributions);

  return ScoreDeltaSchema.parse({
    projectId: after.projectId,
    from: before.at,
    to: after.at,
    previousTotal: round(before.total),
    currentTotal: round(after.total),
    previousCappedBy: before.cappedBy,
    currentCappedBy: after.cappedBy,
    contributions,
  });
}

/**
 * Refuses a diff whose two ends read the same rows.
 *
 * ## Why this guard exists at all
 *
 * `readScoreInputs` had no time parameter, so `qaScore(options, id, since)` and
 * `qaScore(options, id, now)` read **every row** and `at` was stamped on as a label.
 * The route then subtracted one from the other and served the result — and because
 * `ScoreDeltaSchema` requires every contribution to cite `evidence`, what reached the
 * client was a confident, sourced, wrong answer. This guard is the third one; the
 * other two (cross-project, backwards) were already there, and the case that was
 * actually happening had none.
 *
 * ## What counts as proof, and why nothing weaker would do
 *
 * `QaScore` carries **counts**, not row identities — `provenance.runsRead` and
 * `provenance.resultsRead` — so equal counts plus an empty contribution list is the
 * strongest statement the payload permits: two readings, the same number of rows, and
 * nothing that moved. Anything weaker lets the original defect straight through.
 *
 * Equal counts **alone** would not be proof, and is deliberately not used: two
 * readings with the same number of runs and results but different outcomes are a
 * real change, and `diff.test.ts` asserts that case still diffs.
 *
 * ## "Nothing changed" and "I compared nothing to nothing" are different answers
 *
 * A project with no runs at either end has nothing to say about its health. A
 * project with runs whose window did not advance has been told its `since` selected
 * nothing — which over HTTP is what *every* request looked like before `at` filtered
 * anything. The second is a broken comparison and must not render as the first.
 */
function assertDistinctWindows(
  before: QaScore,
  after: QaScore,
  contributions: readonly ScoreDelta['contributions'][number][],
): void {
  const sameCounts =
    before.provenance.runsRead === after.provenance.runsRead &&
    before.provenance.resultsRead === after.provenance.resultsRead;
  if (!sameCounts || contributions.length > 0) return;

  const empty = before.provenance.runsRead === 0 && before.provenance.resultsRead === 0;
  throw new Error(
    empty
      ? `Refusing to diff ${before.projectId} against itself: both readings have no runs and ` +
          'no results, so this is nothing to nothing rather than a change. There is no ' +
          'earlier reading to compare with until the project has run something.'
      : `Refusing to diff ${before.projectId} against itself: both readings read ` +
          `${String(after.provenance.resultsRead)} result(s) from ${String(after.provenance.runsRead)} run(s) and nothing moved, ` +
          'so the same rows are on both sides of the subtraction. Pick a `since` that ' +
          'selects a different window.',
  );
}

/** A row whose mean moved, with the rows' own names as evidence. */
function rowContributions(before: QaScore, after: QaScore): ScoreDelta['contributions'] {
  const contributions: ScoreDelta['contributions'] = [];
  for (const row of after.rows) {
    const previous = before.rows.find((candidate) => candidate.id === row.id);
    if (previous === undefined || previous.value === row.value) continue;
    contributions.push({
      scope: 'row',
      key: row.id,
      before: round(previous.value),
      after: round(row.value),
      cause: `The ${row.id} row ${row.value < previous.value ? 'fell' : 'rose'} from ${fixed(previous.value)} to ${fixed(row.value)}.`,
      evidence: [`row:${row.id}`],
    });
  }
  return contributions;
}

/**
 * A change of limiting row.
 *
 * The limiter changing is a different event from the total changing, and a diff
 * that hides it leaves a reader with a number whose cause has silently been
 * replaced — which is the whole reason the cap is carried in every payload.
 */
function capContribution(before: QaScore, after: QaScore): ScoreDelta['contributions'] {
  if (before.cappedBy === after.cappedBy) return [];
  return [
    {
      scope: 'cap',
      key: after.cappedBy,
      before: 1,
      after: 0,
      cause: `The limiting row moved from ${before.cappedBy} to ${after.cappedBy}.`,
      evidence: [`cap:${before.cappedBy}`, `cap:${after.cappedBy}`],
    },
  ];
}

/**
 * Rounded to four places.
 *
 * Enough that a diff of two readings a day apart shows a real change and not
 * floating-point noise, and not so many that a reader sees precision the score
 * does not have.
 */
function round(value: number): number {
  return Number(value.toFixed(4));
}
