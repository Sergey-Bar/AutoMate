import { and, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { runs } from '@automate/db';
import { QaScoreSchema, type QaScore } from '@automate/shared-contracts';
import {
  COVERAGE_FORMATS,
  parseCoverage,
  surfaceCoverage,
  type CoverageFormat,
  type CoverageReport,
} from '@automate/reporter';
import {
  DEFAULT_WEIGHTS,
  isExecuted,
  score,
  type CanonicalTestResult,
  type CoverageSummary,
  type RunRecord,
  type ScoreInputs,
  type ScoreSurface,
} from '@automate/projects';
import { readScoreInputs, type ProjectRegistryServiceOptions } from './project-registry-service.js';
import { uncoveredModulesFrom, type DeclaredCoverageGlob } from './coverage-ingestion.js';
import { SCORE_TREND_POINTS } from './derived-score-points.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

/**
 * Runs the score for a project, from the rows the repository already holds.
 *
 * ## Nothing is stored
 *
 * There is no `health_scores` row and this function does not want one. A stored
 * total would be a **fourth** blocking number that has to agree with the coverage
 * floor, the performance threshold and the gate tier — the `no-second-authority`
 * shape, wearing a dashboard. Recomputing from the rows costs a query per request
 * and buys the property the plan actually needs: **deleting this service changes
 * no verdict and no gate**.
 *
 * ## Every number is traceable, or it is not printed
 *
 * `QaScoreSchema.parse` is the last step, not a formality. A cell whose components
 * do not add up, or a row whose weight is not in `[0,1]`, throws here rather than
 * reaching a dashboard — because a score that cannot be recomputed from its own
 * inputs is the one failure mode this whole section exists to prevent.
 */
export async function qaScore(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  at: string,
  coverage: ReadonlyArray<{ format: CoverageFormat; bytes: Uint8Array }> = [],
): Promise<QaScore> {
  // **`at` is threaded into the read, not just stamped on the result.** It used to be
  // only the latter, which meant a diff of two readings read every row twice and
  // subtracted a number from itself; `score()` states that `inputs` is the whole
  // window, so the window has to be cut here or not at all.
  const inputs = await assemble(options, projectId, coverage, at);
  // The photograph is written **before** the series is read, so this window is
  // the newest point of its own trend rather than a point that appears on the
  // next page load. `score()` is pure and the trend is not one of its inputs to
  // the total, so calling it here without the series and again below with it is
  // the same number twice — which is the cheapest honest way to have the total
  // in hand before the row that records it exists.
  const read = score({ ...inputs }, at);
  await recordPhotograph(options, projectId, read, at);
  const trend = await earlierWindows(options, projectId, coverage, inputs, at);
  return QaScoreSchema.parse(score({ ...inputs, trend }, at));
}

/**
 * The photograph of one reading, if this install has somewhere to put it.
 *
 * **A failure to photograph is not a failure to score.** The score is computed
 * on every request from the runs, exactly as it was before this table existed;
 * the point is what makes the trend long enough to chart. So a store that is
 * absent, or a write that fails, leaves the score answered and the chart short —
 * and the alternative (a 500 on `GET /qa/score`) would make the primary answer
 * hostage to the auxiliary one. The two failure modes are not symmetric and the
 * choice is deliberate.
 *
 * **And the `catch` below is what makes that paragraph true.** It was a comment
 * with no code behind it for one wave: five formerly pure GET endpoints carried
 * a hard database-write dependency, so a deploy running ahead of migration 0027,
 * a restored pre-0027 dump, or a pool failure answered 500 from the read path.
 * A logged-and-continued write costs a shorter chart; the opposite costs the
 * whole endpoint.
 */
async function recordPhotograph(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  read: QaScore,
  at: string,
): Promise<void> {
  if (options.scorePoints === undefined) return;
  try {
    await options.scorePoints.record({
      projectId,
      workspaceId: options.workspaceId,
      at,
      total: read.total,
      // The cells as the score published them, frozen: the photograph's job is to
      // say *why* the total was what it was, and the score already has that object.
      labels: Object.fromEntries(read.cells.map((cell) => [cell.key, cell.score])),
    });
  } catch (error: unknown) {
    // The same shape the outbox retention sweep and the realtime pump use: a
    // message string and the error beside it, because a photograph that failed to
    // write is an operational fact worth a log line and nothing worse.
    console.error('derived score point not written', error);
  }
}

/**
 * The totals of the windows before this one, oldest first.
 *
 * ## One earlier window, and the cost is the reason
 *
 * Each window is two queries and a full re-score, so a six-point series on a
 * dashboard is twelve extra queries per page load to answer a chart that reads
 * the same at two points as at six. The list is the shape it needs to be, so the
 * day the reads are batched the only change is how long the list gets — and
 * until then, an empty list means "one run has happened" rather than a fabricated
 * flat line.
 */
async function earlierWindows(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  coverage: ReadonlyArray<{ format: CoverageFormat; bytes: Uint8Array }>,
  inputs: ScoreInputs,
  at: string,
): Promise<ScoreInputs['trend']> {
  // **The photographs first, because they are the series this trend is.** A
  // store that is configured answers from the table: up to `SCORE_TREND_POINTS`
  // windows, oldest first, with no re-score of any of them — which is the whole
  // point of storing them. Reading the earlier windows arithmetically was the
  // old path and it cost one full re-score per point.
  if (options.scorePoints !== undefined) {
    const points = await options.scorePoints.listRecent(
      projectId,
      options.workspaceId,
      SCORE_TREND_POINTS,
    );
    const requestedAt = Date.parse(at);
    // The windows **strictly before** this one. `score()` appends the current
    // total itself, so this window's own point — written moments ago — must not
    // come back as an earlier one, and neither may a point from a window later
    // than the one being read (which is what a diff read at an older instant
    // would otherwise chart as history).
    return points
      .filter((point) => Date.parse(point.at) < requestedAt)
      .map((point) => ({ at: point.at, total: point.total }));
  }
  const starts = inputs.runs
    .map((run) => Date.parse(run.startedAt))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  // One run is not a trend: with a single window there is nothing to compare to, and
  // the honest series is none rather than a point repeated.
  if (starts.length < 2) return [];
  // The median run start, biased to the **earlier** half: for two runs that is the
  // first, which is the only choice that puts the older window strictly before the
  // current one. The upper middle would pick the newer run and read the same window
  // twice, which is the diff-subtracts-from-itself defect this function exists to avoid.
  const previousAt = new Date(starts[Math.floor((starts.length - 1) / 2)]).toISOString();
  if (previousAt >= at) return [];
  try {
    const previousInputs = await assemble(options, projectId, coverage, previousAt);
    return [{ at: previousAt, total: score(previousInputs, previousAt).total }];
  } catch {
    // A project deleted between the two reads is a 404 for the older window, and a
    // trend is not worth the whole score request.
    return [];
  }
}

async function assemble(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  coverageDocuments: ReadonlyArray<{ format: CoverageFormat; bytes: Uint8Array }>,
  at: string,
): Promise<ScoreInputs> {
  const read = await readScoreInputs(options, projectId, at);
  const runRows = read.runs as ReadonlyArray<{
    id: string;
    startedAt: Date;
    outcome: string | null;
    phase: string | null;
  }>;
  const resultRows = read.results as unknown[];
  const profile = await readProfile(options, projectId);
  // Coverage the caller passed, plus whatever this project's own runs uploaded.
  //
  // **The union is the point, and the empty case is the failure this fixes.**
  // `assemble` accepted a coverage list and every caller passed `[]`, so `depth`
  // was `unknown` on every cell of every screen — a fifth of the score answering
  // "no idea" beside a printed total. The documents now come from the run's own
  // artifacts, matched by the profile's declared globs and parsed with the format
  // each glob declares. A repository that declares no coverage glob still gets
  // nothing, and that is the honest answer: nothing was declared, so nothing is
  // measured.
  const uploaded = await readUploadedCoverage(options, projectId, at);
  const documents = [...coverageDocuments, ...uploaded];
  const reports = documents
    .map((document) => parseCoverage(document.format, document.bytes))
    .filter((report): report is CoverageReport => report !== null);
  const results = resultRows.map((row) => projectTestResult(row));

  return {
    projectId,
    profile: {
      detectorVersion: profile.detectorVersion,
      excludedCells: profile.excludedCells,
      targets: profile.targets,
      // Configuration, never the module constants. A weight the user cannot reach
      // is a weight the user cannot argue with.
      weights: DEFAULT_WEIGHTS,
    },
    runs: runRows.map((row) => projectRunRecord(row)),
    results,
    coverage: mergeCoverage(reports),
    // The quarantine table carries a **test title**, not a fingerprint, so joining
    // it to `quarantined` would be a guess that moves a score. It is left empty
    // until the quarantine row records the fingerprint it is about — see
    // `packages/projects/src/score/types.ts`, where `quarantined` is documented as
    // never inferred.
    quarantined: [],
    // A module is uncovered when the coverage report names a file with
    // executable lines and none covered — read out of the report rather than out
    // of a second source scan, because a scan that disagreed with the report
    // would be a second authority for the same number. **A file the report never
    // named is unknown, not uncovered**, and `depth` stays `unknown` there
    // rather than being counted as a hole nobody measured.
    uncoveredModules: uncoveredModulesFrom(reports.flatMap((report) => report.files)).map(
      (module) => module.path,
    ),
    singleLayerE2eFingerprints: singleLayerE2e(results),
  };
}

/**
 * The coverage documents this project's own runs uploaded, parsed and ready.
 *
 * The run it reads is the **newest in the window**, not every run: a coverage
 * report describes the state of the code when it was taken, and a suite that ran
 * forty times has forty reports about forty different trees. Reading the newest
 * is the rule the window already implies — the score is about the code as it now
 * stands, not about the history of every measurement.
 *
 * A run with no artifacts, a project with no declared coverage globs, and an
 * install with no artifact store all produce an empty list. None of the three is
 * an error: the first two mean nobody declared a measurement, and the third
 * means the deployment cannot take one.
 */
async function readUploadedCoverage(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  at: string,
): Promise<ReadonlyArray<{ format: CoverageFormat; bytes: Uint8Array }>> {
  if (options.readCoverageDocuments === undefined) return [];
  const { getProject } = await import('./project-registry-service.js');
  const project = await getProject(options, projectId);
  // **A format this build cannot parse is dropped here, once.** The profile is a
  // file a customer writes, and its schema accepts any non-empty string as a
  // `format` — so a glob may name one of the six formats `parseCoverage`
  // implements, or it may name a seventh that does not exist. Handing that down
  // would be a parse that produces nothing, and reporting it as an empty report
  // would report a measurement that failed as one that produced zero.
  //
  // The list is `packages/reporter`'s own, so there is one authority for what can
  // be parsed rather than one here and one there. The predicate — rather than a
  // cast on the array — is what makes the narrowing survive TypeScript's check,
  // so a caller cannot later read a `format` that is not one of the six.
  const parseable = new Set<string>(COVERAGE_FORMATS);
  const declared = (project.profile.coverageGlobs ?? []).filter(
    (glob): glob is DeclaredCoverageGlob => parseable.has(glob.format),
  );
  if (declared.length === 0) return [];
  // The newest run in the window is the one whose coverage describes this code.
  const read = await readScoreInputs(options, projectId, at);
  const runs = read.runs as ReadonlyArray<{ id: string; startedAt: Date }>;
  const newest = runs
    .slice()
    .sort((left, right) => right.startedAt.getTime() - left.startedAt.getTime())[0];
  if (newest === undefined) return [];
  return options.readCoverageDocuments(newest.id, declared);
}

/**
 * Fingerprints that run at the e2e layer **and** in a unit suite.
 *
 * The one input the score cannot derive for itself, and the one the database
 * already holds: an e2e test that also exists as a unit test is a duplication the
 * structure of the results reveals without any extra read. Computed here rather
 * than in `packages/projects` because the rule is about *this repository's*
 * results, not about the score's arithmetic.
 */
export function singleLayerE2e(results: readonly CanonicalTestResult[]): string[] {
  // `isExecuted` comes from `packages/projects`, because the rule about what
  // "executed" means is the score's rule. A second copy here would drift the
  // first time a new non-executed outcome was added.
  const executed = results.filter((result) => isExecuted(result.outcome));
  const unitFingerprints = new Set(
    executed.filter((result) => result.category === 'unit').map((result) => result.fingerprint),
  );
  return [
    ...new Set(
      executed.filter((result) => result.category === 'e2e').map((result) => result.fingerprint),
    ),
  ].filter((fingerprint) => unitFingerprints.has(fingerprint));
}

/**
 * Coverage from every supplied document, split across the three surfaces.
 *
 * The classifier is a **convention stated here rather than guessed per file**:
 * `src/api`, `src/routes` and anything under `server` is backend; `src/ui`,
 * `src/web`, `src/components` and `src/pages` is frontend; everything else is
 * platform. A real install replaces this with the project's own declaration —
 * `automate.config.json` is where that belongs — and until it does, the honest
 * thing is a documented default rather than a per-file guess that would move
 * files between surfaces on a rename.
 */
export function classifySurface(path: string): ScoreSurface {
  if (/(^|\/)(api|routes|server|backend|handlers?)\//u.test(path)) return 'backend';
  if (/(^|\/)(ui|web|components?|pages?|frontend)\//u.test(path)) return 'frontend';
  return 'platform';
}

export function mergeCoverage(reports: readonly CoverageReport[]): CoverageSummary | null {
  if (reports.length === 0) return null;
  const merged: Record<ScoreSurface, number | null> = {
    backend: null,
    frontend: null,
    platform: null,
  };
  for (const report of reports) {
    const split = surfaceCoverage(report, classifySurface);
    for (const surface of Object.keys(merged) as ScoreSurface[]) {
      const value = split[surface];
      // Only a document that *measured* a surface can contribute to it. Averaging a
      // `null` as zero would make a Python-only coverage run report the frontend as
      // measurably uncovered, which is the claim the `null` exists to avoid.
      if (value === null) continue;
      merged[surface] = merged[surface] === null ? value : (merged[surface] + value) / 2;
    }
  }
  return { bySurface: merged };
}

/**
 * A `runs` row, as the score's own shape.
 *
 * `countsTowardsQuality` is the whole point of this projection. A run that died
 * because the machine fell over — `infra_failed`, `timed_out`, `runner_lost` — did
 * not produce evidence about the code, and the score reports those separately in
 * `provenance.infraFailedRate` rather than letting them lower a pass rate.
 */
export function projectRunRecord(row: {
  id: string;
  startedAt: Date;
  outcome: string | null;
  phase: string | null;
}): RunRecord {
  const outcome = row.outcome;
  return {
    runId: row.id,
    startedAt: row.startedAt.toISOString(),
    projectId: '',
    outcome,
    countsTowardsQuality: outcome !== null && !INFRA_OUTCOMES.has(outcome),
    coverageBySurface: null,
  };
}

/** The run outcomes that are the infrastructure's, not the code's. */
const INFRA_OUTCOMES = new Set(['infra_failed', 'timed_out', 'runner_lost', 'cancelled']);

/**
 * One canonical result, projected to the fields the score reads.
 *
 * Projected rather than cast, and the reason is worth stating: `canonical_run_results`
 * holds whatever a producer sent, and a producer that starts sending a field the score
 * has no opinion about must not silently change the score. Everything the score needs
 * is named here, so a change to the score's inputs is a change to this function and
 * shows up in a diff.
 */
export function projectTestResult(value: unknown): CanonicalTestResult {
  const document = (typeof value === 'object' && value !== null ? value : {}) as Record<
    string,
    unknown
  >;
  const identity = record(document['identity']);
  const metadata = record(document['metadata']);
  const attempts = Array.isArray(document['attempts']) ? document['attempts'] : [];
  const last = record(attempts[attempts.length - 1] ?? {});

  return {
    fingerprint: String(metadata['fingerprint'] ?? last['testId'] ?? 'unattributed'),
    runId: String(identity['runId'] ?? ''),
    commitSha: nullableString(record(document['provenance'])['commitSha']),
    // `null`, never a default of `unit`. A reporter that declares no category has
    // not placed its test in the unit row; guessing would put every unlabelled test
    // in one column and make that column look over-built for reasons nobody chose.
    category: nullableCategory(metadata['category']),
    surface: nullableSurface(metadata['surface']),
    outcome: nullableOutcome(last['status']),
    durationMs: nullableNumber(last['durationMs']),
    assertionCount: nullableNumber(metadata['assertionCount']),
    trivialAssertionCount: nullableNumber(metadata['trivialAssertionCount']),
    touchedIo: typeof metadata['touchedIo'] === 'boolean' ? metadata['touchedIo'] : null,
  };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

const CATEGORIES = new Set(['unit', 'integration', 'e2e', 'performance', 'security']);
const SURFACES = new Set<ScoreSurface>(['backend', 'frontend', 'platform']);
const OUTCOMES = new Set([
  'passed',
  'failed',
  'flaky',
  'skipped',
  'blocked',
  'unknown',
  'timedOut',
  'cancelled',
]);

function nullableCategory(value: unknown): CanonicalTestResult['category'] {
  return typeof value === 'string' && CATEGORIES.has(value)
    ? (value as CanonicalTestResult['category'])
    : null;
}

function nullableSurface(value: unknown): ScoreSurface | null {
  return typeof value === 'string' && SURFACES.has(value as ScoreSurface)
    ? (value as ScoreSurface)
    : null;
}

function nullableOutcome(value: unknown): CanonicalTestResult['outcome'] {
  return typeof value === 'string' && OUTCOMES.has(value)
    ? (value as CanonicalTestResult['outcome'])
    : 'unknown';
}

async function readProfile(
  options: ProjectRegistryServiceOptions,
  projectId: string,
): Promise<{
  detectorVersion: number;
  excludedCells: ScoreInputs['profile']['excludedCells'];
  targets: ScoreInputs['profile']['targets'];
}> {
  const { getProject } = await import('./project-registry-service.js');
  const project = await getProject(options, projectId);
  return {
    detectorVersion: project.detectorVersion,
    excludedCells: project.profile.excludedCells,
    targets: project.profile.targets,
  };
}

/**
 * Stops a run, and records why.
 *
 * A stop with no recorded reason is an interruption nobody can tell apart from a
 * crash, and the difference matters the first time somebody asks why a run finished
 * halfway through.
 */
export async function stopRun(
  db: AnyPgDb,
  workspaceId: string,
  runId: string,
  reason: string,
): Promise<{ runId: string; previousPhase: string; reason: string }> {
  const rows = await db
    .select({ id: runs.id, phase: runs.phase, outcome: runs.outcome })
    .from(runs)
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)));
  const row = rows[0];
  if (row === undefined) {
    throw new DomainError(ErrorCode.RUN_NOT_FOUND, 'No such run');
  }
  if (row.outcome !== null) {
    throw new DomainError(
      ErrorCode.INVALID_STATE_TRANSITION,
      `Run ${runId} already finished with outcome ${row.outcome}`,
    );
  }
  await db
    .update(runs)
    .set({ outcome: 'cancelled', phase: 'cancelled' })
    .where(and(eq(runs.workspaceId, workspaceId), eq(runs.id, runId)));
  return { runId, previousPhase: row.phase ?? 'unknown', reason };
}
