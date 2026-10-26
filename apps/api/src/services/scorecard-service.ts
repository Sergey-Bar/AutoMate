import { and, asc, count, desc, eq, isNotNull, ne } from 'drizzle-orm';
import {
  diffCoverageResults,
  healthFindings,
  healthReports,
  healthSnapshots,
  projects,
  vexDocuments,
} from '@automate/db';
import {
  clusterFailures,
  flakeCost,
  supplyChainScorecard,
  testEffectivenessScorecard,
  type SupplyChainScorecardInput,
  type TestEffectivenessInput,
} from '@automate/reporting';
import {
  DimensionMetricSchema,
  HEALTH_DIMENSIONS,
  HEATMAP_PROJECT_LIMIT,
  HealthGradeSchema,
  SBOM_REPORT_FORMATS,
  SCORECARD_IDS,
  type HealthGrade,
  type PortfolioHeatmap,
  type Scorecard,
  type ScorecardId,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';
import { belongsTo, failureInputsOf, flakeObservationsOf } from '../execution/insights.js';
import type { ExecutionRun } from '../execution/types.js';
import { AI_CODE_GRADE_WINDOW_DAYS, portfolioAiCode } from './ai-code-service.js';
import { DELIVERY_GRADE_WINDOW_DAYS, portfolioDelivery } from './delivery-service.js';
import { projectEvals } from './eval-service.js';
import {
  branchFor,
  projectRow,
  type HealthStoreOptions,
  type ProjectRow,
} from './health-findings.js';
import { effectiveState } from './repo-health-service.js';
import { LICENCE_TOOL, readSupplyChainPolicy } from './supply-chain-service.js';

/**
 * The supply-chain and test-effectiveness scorecards, gathered from what the upload door
 * stored. The builders in `@automate/reporting` decide; this module only reads.
 *
 * Every read is scoped to the caller's workspace twice over: `projectRow` refuses a project
 * from another workspace as "no such project", and every query filters on `workspace_id`.
 */
export type ScorecardOptions = HealthStoreOptions & {
  now?: () => Date;
  /**
   * The workspace's run history since a moment, in any order. Absent: this install has no run
   * store here, and the flake and failure readings are `not_configured`.
   */
  history?: ((since: Date) => Promise<readonly ExecutionRun[]>) | undefined;
};

/** The window the supply-chain card reports over. Its readings are not windowed. */
export const SUPPLY_CHAIN_WINDOW_DAYS = 30;
/** The run history the test-effectiveness card reads. */
export const TEST_EFFECTIVENESS_WINDOW_DAYS = 14;
/** "The latest commits": the computed diff-coverage results read, newest first. */
export const DIFF_COVERAGE_COMMITS = 10;

const DAY_MS = 86_400_000;
const SBOM_FORMATS: ReadonlySet<string> = new Set(SBOM_REPORT_FORMATS);

const ToolRunsSchema = z.array(z.object({ dimensions: z.array(z.string()) }).passthrough());

interface LatestReport {
  format: string;
  receivedAt: Date;
  dimensions: readonly string[];
  metrics: readonly z.infer<typeof DimensionMetricSchema>[];
}

/** The newest report of each kind on the branch. */
async function latestReports(
  options: HealthStoreOptions,
  projectId: string,
  branch: string,
): Promise<LatestReport[]> {
  const rows = await options.db
    .selectDistinctOn([healthReports.toolKey], {
      format: healthReports.format,
      receivedAt: healthReports.receivedAt,
      tools: healthReports.tools,
      metrics: healthReports.metrics,
    })
    .from(healthReports)
    .where(
      and(
        eq(healthReports.workspaceId, options.workspaceId),
        eq(healthReports.projectId, projectId),
        eq(healthReports.branch, branch),
      ),
    )
    .orderBy(healthReports.toolKey, desc(healthReports.sequence));
  return rows.map((row) => {
    const tools = ToolRunsSchema.safeParse(row.tools);
    const metrics = z.array(DimensionMetricSchema).safeParse(row.metrics);
    return {
      format: row.format,
      receivedAt: row.receivedAt,
      dimensions: tools.success ? tools.data.flatMap((run) => run.dimensions) : [],
      metrics: metrics.success ? metrics.data : [],
    };
  });
}

/** A named metric's score from the newest report of a format, or `null`. */
function metricScore(reports: readonly LatestReport[], format: string, metric: string) {
  const report = reports.find((entry) => entry.format === format);
  return report?.metrics.find((entry) => entry.metric === metric)?.score ?? null;
}

interface FindingCounts {
  vulnerabilities: { open: number; fixableCritical: number; all: number; vexDecided: number };
  licences: { open: number; denied: number };
}

/** Open vulnerability and licence findings on the branch, read through effective state. */
async function findingCounts(
  options: HealthStoreOptions,
  projectId: string,
  branch: string,
  now: Date,
): Promise<FindingCounts> {
  const rows = await options.db
    .select({
      kind: healthFindings.kind,
      toolKey: healthFindings.toolKey,
      ruleId: healthFindings.ruleId,
      severity: healthFindings.severity,
      fixAvailable: healthFindings.fixAvailable,
      state: healthFindings.state,
      triageExpiresAt: healthFindings.triageExpiresAt,
      triagedBy: healthFindings.triagedBy,
    })
    .from(healthFindings)
    .where(
      and(
        eq(healthFindings.workspaceId, options.workspaceId),
        eq(healthFindings.projectId, projectId),
        eq(healthFindings.branch, branch),
        ne(healthFindings.state, 'fixed'),
      ),
    );
  const counts: FindingCounts = {
    vulnerabilities: { open: 0, fixableCritical: 0, all: 0, vexDecided: 0 },
    licences: { open: 0, denied: 0 },
  };
  for (const row of rows) {
    const open = effectiveState(row.state, row.triageExpiresAt, now) === 'open';
    if (row.toolKey === LICENCE_TOOL) {
      if (!open) continue;
      counts.licences.open += 1;
      if (row.ruleId === 'licence/denied') counts.licences.denied += 1;
      continue;
    }
    if (row.kind !== 'vulnerability') continue;
    tallyVulnerability(counts.vulnerabilities, row, open);
  }
  return counts;
}

function tallyVulnerability(
  tally: FindingCounts['vulnerabilities'],
  row: { severity: string; fixAvailable: boolean | null; triagedBy: string | null },
  open: boolean,
): void {
  tally.all += 1;
  if (!open) {
    if (row.triagedBy?.startsWith('vex:') === true) tally.vexDecided += 1;
    return;
  }
  tally.open += 1;
  if (row.severity === 'critical' && row.fixAvailable === true) tally.fixableCritical += 1;
}

async function vexDocumentCount(options: HealthStoreOptions, projectId: string): Promise<number> {
  const [row] = await options.db
    .select({ total: count() })
    .from(vexDocuments)
    .where(
      and(eq(vexDocuments.workspaceId, options.workspaceId), eq(vexDocuments.projectId, projectId)),
    );
  return Number(row?.total ?? 0);
}

/** What the supply-chain card reads, for one project on one branch. */
export async function supplyChainInputs(
  options: HealthStoreOptions,
  project: ProjectRow,
  branch: string,
  now: Date,
): Promise<SupplyChainScorecardInput> {
  const [reports, findings, documents, policy] = await Promise.all([
    latestReports(options, project.id, branch),
    findingCounts(options, project.id, branch, now),
    vexDocumentCount(options, project.id),
    readSupplyChainPolicy(options, project.id),
  ]);
  const sboms = reports.filter((report) => SBOM_FORMATS.has(report.format));
  const slsa = metricScore(reports, 'slsa-provenance', 'slsa-level');
  const scanned =
    sboms.length > 0 || reports.some((report) => report.dimensions.includes('dependencies'));
  const sbomAt = sboms.reduce<Date | null>(
    (latest, report) =>
      latest === null || report.receivedAt > latest ? report.receivedAt : latest,
    null,
  );
  return {
    slsaLevel: slsa === null ? null : Math.round((slsa * 3) / 100),
    licences: policy !== null && sboms.length > 0 ? findings.licences : null,
    vulnerabilities: scanned ? findings.vulnerabilities : null,
    vex: {
      documents,
      vulnerabilities: findings.vulnerabilities.all,
      decided: findings.vulnerabilities.vexDecided,
    },
    sbomAt,
  };
}

/** `GET /api/v1/projects/:id/supply-chain/scorecard?branch=` */
export async function supplyChainScorecardFor(
  options: ScorecardOptions,
  projectId: string,
  requestedBranch?: string,
): Promise<Scorecard> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, requestedBranch);
  return supplyChainScorecard(await supplyChainInputs(options, project, branch, now), {
    now,
    windowDays: SUPPLY_CHAIN_WINDOW_DAYS,
  });
}

/** The latest computed diff-coverage results on the branch, summed. */
async function recentDiffCoverage(
  options: HealthStoreOptions,
  projectId: string,
  branch: string,
): Promise<TestEffectivenessInput['diffCoverage']> {
  const rows = await options.db
    .select({ covered: diffCoverageResults.covered, executable: diffCoverageResults.executable })
    .from(diffCoverageResults)
    .where(
      and(
        eq(diffCoverageResults.workspaceId, options.workspaceId),
        eq(diffCoverageResults.projectId, projectId),
        eq(diffCoverageResults.branch, branch),
        isNotNull(diffCoverageResults.computedAt),
      ),
    )
    .orderBy(desc(diffCoverageResults.receivedAt), desc(diffCoverageResults.id))
    .limit(DIFF_COVERAGE_COMMITS);
  if (rows.length === 0) return null;
  return {
    commits: rows.length,
    covered: rows.reduce((sum, row) => sum + (row.covered ?? 0), 0),
    executable: rows.reduce((sum, row) => sum + (row.executable ?? 0), 0),
  };
}

/** Flakes and failure causes over the run history, through the insights page's own mappers. */
export function historyReadings(
  runs: readonly ExecutionRun[],
): Pick<TestEffectivenessInput, 'flakes' | 'failures'> {
  const oldestFirst = [...runs].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const observations = flakeObservationsOf(oldestFirst);
  const costs = flakeCost(observations);
  const flaky = new Set(costs.filter((cost) => cost.flakyScore > 0).map((cost) => cost.testKey));
  // A run a flaky test could have blocked: its gate failed, and the test did not cleanly pass.
  const blocked = new Set(
    observations
      .filter(
        (seen) =>
          seen.runBlocked &&
          flaky.has(seen.testKey) &&
          seen.status !== 'passed' &&
          seen.status !== 'skipped',
      )
      .map((seen) => seen.runId),
  );
  const clusters = clusterFailures(failureInputsOf(oldestFirst), { maxClusters: 1 });
  const top = clusters.clusters[0];
  return {
    flakes: {
      tests: costs.length,
      flaky: flaky.size,
      retriesSpent: costs.reduce((sum, cost) => sum + cost.retriesSpent, 0),
      wastedMs: costs.reduce((sum, cost) => sum + cost.wastedMs, 0),
      blockedRuns: blocked.size,
    },
    failures: {
      failures: clusters.totals.failures,
      causes: clusters.totals.causes,
      topCause: top === undefined ? null : top.sampleMessage,
    },
  };
}

/** The run history the card reads, or `null` when this install has none. */
async function windowRuns(options: ScorecardOptions, now: Date) {
  if (options.history === undefined) return null;
  return options.history(new Date(now.getTime() - TEST_EFFECTIVENESS_WINDOW_DAYS * DAY_MS));
}

/** The card for one project from a history already read, so a portfolio reads it once. */
export async function testEffectivenessCard(
  options: HealthStoreOptions,
  project: ProjectRow,
  branch: string,
  now: Date,
  runs: readonly ExecutionRun[] | null,
): Promise<Scorecard> {
  const [reports, diffCoverage] = await Promise.all([
    latestReports(options, project.id, branch),
    recentDiffCoverage(options, project.id, branch),
  ]);
  const history =
    runs === null
      ? { flakes: null, failures: null }
      : historyReadings(runs.filter((run) => belongsTo(run, project.id)));
  return testEffectivenessScorecard(
    {
      mutationScore: metricScore(reports, 'stryker-mutation', 'mutation-score'),
      diffCoverage,
      ...history,
    },
    { now, windowDays: TEST_EFFECTIVENESS_WINDOW_DAYS },
  );
}

/** `GET /api/v1/projects/:id/test-effectiveness/scorecard?branch=` */
export async function testEffectivenessScorecardFor(
  options: ScorecardOptions,
  projectId: string,
  requestedBranch?: string,
): Promise<Scorecard> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, requestedBranch);
  return testEffectivenessCard(options, project, branch, now, await windowRuns(options, now));
}

// ─── The portfolio heatmap ───────────────────────────────────────────────────

/** The agent-quality card a project is judged by: its worst eval suite, failing first. */
export function worstSuiteCard(cards: readonly Scorecard[]): Scorecard | null {
  const rank = (card: Scorecard) => (card.status === 'fail' ? 0 : 1);
  return (
    [...cards].sort(
      (left, right) => rank(left) - rank(right) || (left.score ?? 101) - (right.score ?? 101),
    )[0] ?? null
  );
}

const cell = (card: Pick<Scorecard, 'status' | 'score'>) => ({
  status: card.status,
  score: card.score,
});

const NOT_CONFIGURED = { status: 'not_configured' as const, score: null };

/**
 * `GET /api/v1/portfolio/heatmap`: per project, every grade dimension from its latest snapshot
 * and every scorecard's status and score. Bounded to {@link HEATMAP_PROJECT_LIMIT} projects by
 * name, and says when it was truncated; the run history is read once for all of them.
 */
export async function portfolioHeatmap(options: ScorecardOptions): Promise<PortfolioHeatmap> {
  const now = options.now?.() ?? new Date();
  const [rows, totals] = await Promise.all([
    options.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, options.workspaceId))
      .orderBy(asc(projects.name))
      .limit(HEATMAP_PROJECT_LIMIT),
    options.db
      .select({ total: count() })
      .from(projects)
      .where(eq(projects.workspaceId, options.workspaceId)),
  ]);
  const [delivery, aiCode, runs] = await Promise.all([
    portfolioDelivery(options, DELIVERY_GRADE_WINDOW_DAYS),
    portfolioAiCode(options, AI_CODE_GRADE_WINDOW_DAYS),
    windowRuns(options, now),
  ]);
  const entries: PortfolioHeatmap['projects'][number][] = [];
  for (const { id } of rows) {
    const project = await projectRow(options, id);
    const branch = branchFor(project);
    const [grade, supply, tests, evals] = await Promise.all([
      latestGrade(options, project.id, branch),
      supplyChainInputs(options, project, branch, now).then((input) =>
        supplyChainScorecard(input, { now, windowDays: SUPPLY_CHAIN_WINDOW_DAYS }),
      ),
      testEffectivenessCard(options, project, branch, now, runs),
      projectEvals(options, project.id),
    ]);
    const deliveryRow = delivery.projects.find((entry) => entry.projectId === project.id);
    const aiRow = aiCode.projects.find((entry) => entry.projectId === project.id);
    const agents = worstSuiteCard(evals.suites.map((suite) => suite.scorecard));
    const scorecards: Record<ScorecardId, { status: Scorecard['status']; score: number | null }> = {
      delivery: deliveryRow === undefined ? NOT_CONFIGURED : cell(deliveryRow.dora),
      flow: deliveryRow === undefined ? NOT_CONFIGURED : cell(deliveryRow.flow),
      'supply-chain': cell(supply),
      'test-effectiveness': cell(tests),
      'ai-code': aiRow === undefined ? NOT_CONFIGURED : cell(aiRow.scorecard),
      'agent-quality': agents === null ? NOT_CONFIGURED : cell(agents),
    };
    entries.push({
      projectId: project.id,
      name: project.name,
      slug: project.slug,
      branch,
      score: grade?.grade.score ?? null,
      letter: grade?.grade.letter ?? null,
      lastReportAt: grade?.takenAt.toISOString() ?? null,
      dimensions: HEALTH_DIMENSIONS.map((dimension) => {
        const entry = grade?.grade.dimensions.find((item) => item.dimension === dimension);
        return {
          dimension,
          measured: entry?.measured ?? false,
          score: entry?.score ?? null,
          letter: entry?.letter ?? null,
        };
      }),
      scorecards: SCORECARD_IDS.map((scorecard) => ({ id: scorecard, ...scorecards[scorecard] })),
    });
  }
  const total = Number(totals[0]?.total ?? 0);
  return {
    evaluatedAt: now.toISOString(),
    dimensions: [...HEALTH_DIMENSIONS],
    scorecards: [...SCORECARD_IDS],
    total,
    limit: HEATMAP_PROJECT_LIMIT,
    truncated: total > entries.length,
    projects: entries,
  };
}

/** The latest grade snapshot on the branch, parsed; `null` before any report. */
export async function latestGrade(
  options: HealthStoreOptions,
  projectId: string,
  branch: string,
): Promise<{ grade: HealthGrade; takenAt: Date } | null> {
  const [row] = await options.db
    .select({ grade: healthSnapshots.grade, takenAt: healthSnapshots.takenAt })
    .from(healthSnapshots)
    .where(
      and(
        eq(healthSnapshots.workspaceId, options.workspaceId),
        eq(healthSnapshots.projectId, projectId),
        eq(healthSnapshots.branch, branch),
      ),
    )
    .orderBy(desc(healthSnapshots.takenAt))
    .limit(1);
  if (row === undefined) return null;
  const parsed = HealthGradeSchema.safeParse(row.grade);
  return parsed.success ? { grade: parsed.data, takenAt: row.takenAt } : null;
}
