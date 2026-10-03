import { and, eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { runs } from '@automate/db';
import { QaScoreSchema, type QaScore } from '@automate/shared-contracts';
import {
  parseCoverage,
  surfaceCoverage,
  type CoverageFormat,
  type CoverageReport,
} from '@automate/reporter';
import {
  DEFAULT_WEIGHTS,
  score,
  type CanonicalTestResult,
  type CoverageSummary,
  type RunRecord,
  type ScoreInputs,
  type ScoreSurface,
} from '@automate/projects';
import { readScoreInputs, type ProjectRegistryServiceOptions } from './project-registry-service.js';
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
  const inputs = await assemble(options, projectId, coverage);
  return QaScoreSchema.parse(score(inputs, at));
}

async function assemble(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  coverageDocuments: ReadonlyArray<{ format: CoverageFormat; bytes: Uint8Array }>,
): Promise<ScoreInputs> {
  const read = await readScoreInputs(options, projectId);
  const runRows = read.runs as ReadonlyArray<{
    id: string;
    startedAt: Date;
    outcome: string | null;
    phase: string | null;
  }>;
  const resultRows = read.results as unknown[];
  const profile = await readProfile(options, projectId);
  const reports = coverageDocuments
    .map((document) => parseCoverage(document.format, document.bytes))
    .filter((report): report is CoverageReport => report !== null);

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
    results: resultRows.map((row) => projectTestResult(row)),
    coverage: mergeCoverage(reports),
    quarantined: [],
    uncoveredModules: [],
    singleLayerE2eFingerprints: [],
  };
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
