import { and, asc, count, desc, eq, gte, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { healthFindings, healthReports, healthSnapshots, projects, schedules } from '@automate/db';
import {
  CODEOWNERS_PATHS,
  evaluateHealthGate,
  grade,
  healthScannersFor,
  ownerOf,
  parseCodeowners,
  type GateVerdict,
  type OwnerRule,
  type FindingObservation,
  type FindingToolRun,
  type HealthScanner,
  type RepositorySource,
} from '@automate/projects';
import {
  HealthReportError,
  parseHealthMetrics,
  parseSarif,
  type MetricFormat,
  type ScannerRun,
} from '@automate/reporter';
import {
  DimensionMetricSchema,
  HEALTH_DIMENSIONS,
  HEALTH_REPORT_FORMATS,
  HealthGradeSchema,
  HealthPolicySchema,
  HealthToolSchema,
  type CanonicalFinding,
  type DimensionMetric,
  type FindingState,
  type HealthDimension,
  type HealthFinding,
  type HealthFindingsPage,
  type HealthGrade,
  type HealthHistory,
  type HealthPolicy,
  type HealthReportFormat,
  type HealthReportSummary,
  type HealthScanStarted,
  type HealthUploadResult,
  type Portfolio,
  type PortfolioEntry,
  type ProjectHealth,
  type TriageFindingBody,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';
import { qaScore } from './qa-score-service.js';
import { AlertSettingsSchema } from './health-integrations.js';

/**
 * Repository health: reports in, findings carried across them, the grade out.
 *
 * ## A finding's life is decided by the next report of the same kind
 *
 * Every report has a `toolKey` — the format, plus the tool names for SARIF. A finding that
 * the next report with the same key on the same branch does not mention is `fixed`; one
 * that comes back is `open` again. A person's decision (`suppressed`, `accepted`,
 * `false_positive`) is never overwritten by a report: a finding someone accepted stays
 * accepted when it is seen again, and stops counting only until its expiry.
 *
 * ## Every read names the workspace first
 *
 * All three tables are hard-scoped, and every query here filters on `workspace_id` before
 * the project, so a project id from another workspace finds nothing.
 */
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

/** What the Tests dimension reads: the QA score, and how many tests fail. */
export interface TestsReading {
  metric: DimensionMetric;
  failingTests: number;
}

export interface RepoHealthOptions extends Options {
  /** The existing QA score as the Tests dimension, or `null` when no run has been recorded. */
  testsReading?: (projectId: string) => Promise<TestsReading | null>;
  /**
   * A file in a local repository, for CODEOWNERS. Absent, or a git-sourced project: only an
   * uploaded CODEOWNERS (`PUT /health/codeowners`) assigns owners.
   */
  readRepositoryFile?: (repoPath: string, path: string) => Promise<string | null>;
  /** Called after every stored report, with what changed. Alerts hang off it. */
  onReport?: (event: ReportEvent) => Promise<void>;
  now?: () => Date;
}

/** What one report changed, for the alerting that reads it. */
export interface ReportEvent {
  projectId: string;
  project: string;
  branch: string;
  onDefaultBranch: boolean;
  previous: { letter: HealthGrade['letter']; score: number | null } | null;
  current: HealthGrade;
  added: CanonicalFinding[];
  settings: HealthSettings;
}

/** The `health` key of `projects.settings`: what an operator configured in the dashboard. */
export const HealthSettingsSchema = z.object({
  codeowners: z.string().max(200_000).optional(),
  alerts: AlertSettingsSchema.optional(),
  schedule: z.enum(['daily', 'weekly']).nullable().optional(),
});
export type HealthSettings = z.infer<typeof HealthSettingsSchema>;

const HISTORY_DAYS = 90;
const TREND_DAYS = 30;
const DAY_MS = 86_400_000;
const INSERT_CHUNK = 500;
const ScannerRunListSchema = z.array(
  z.object({ tool: HealthToolSchema, dimensions: z.array(z.enum(HEALTH_DIMENSIONS)) }),
);

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  defaultBranch: string | null;
  repoPath: string | null;
  repositoryUrl: string | null;
  profile: Record<string, unknown>;
  settings: Record<string, unknown>;
}

async function projectRow(options: Options, projectId: string): Promise<ProjectRow> {
  // A malformed id is "no such project", not a database error about uuid syntax.
  if (!/^[0-9a-f-]{36}$/iu.test(projectId)) {
    throw new DomainError(ErrorCode.NOT_FOUND, `No project ${projectId}`);
  }
  const rows = await options.db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      defaultBranch: projects.defaultBranch,
      repoPath: projects.repoPath,
      repositoryUrl: projects.repositoryUrl,
      profile: projects.profile,
      settings: projects.settings,
    })
    .from(projects)
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No project ${projectId}`);
  return row;
}

/** The branch a read means when it names none: the project's default, else `main`. */
export function branchFor(project: Pick<ProjectRow, 'defaultBranch'>, requested?: string): string {
  const branch = requested?.trim();
  return branch !== undefined && branch.length > 0
    ? branch.slice(0, 255)
    : (project.defaultBranch ?? 'main');
}

function policyOf(project: ProjectRow): HealthPolicy | undefined {
  const parsed = HealthPolicySchema.safeParse(project.profile['health']);
  return parsed.success ? parsed.data : undefined;
}

/** A suppression or acceptance past its expiry counts again, without anyone rewriting it. */
export function effectiveState(state: string, expiresAt: Date | null, now: Date): FindingState {
  if ((state === 'suppressed' || state === 'accepted') && expiresAt !== null && expiresAt <= now) {
    return 'open';
  }
  return state as FindingState;
}

function toolKeyFor(format: HealthReportFormat, tools: readonly ScannerRun[]): string {
  if (format !== 'sarif') return format;
  const names = [...new Set(tools.map((run) => run.tool.name))].sort();
  return `sarif:${names.join('+') || 'unknown'}`;
}

function parseReport(
  format: HealthReportFormat,
  bytes: Uint8Array,
  sourceRoot: string | undefined,
): { tools: ScannerRun[]; findings: CanonicalFinding[]; metrics: DimensionMetric[] } {
  try {
    if (format === 'sarif') {
      const parsed = parseSarif(bytes, sourceRoot === undefined ? {} : { sourceRoot });
      return { ...parsed, metrics: [] };
    }
    return { tools: [], findings: [], metrics: parseHealthMetrics(format as MetricFormat, bytes) };
  } catch (error) {
    if (error instanceof HealthReportError) {
      throw new DomainError(
        error.code === 'too_large' ? ErrorCode.PAYLOAD_TOO_LARGE : ErrorCode.INVALID_REQUEST_BODY,
        error.message,
      );
    }
    throw error;
  }
}

export interface UploadInput {
  projectId: string;
  format: HealthReportFormat;
  bytes: Uint8Array;
  branch?: string | undefined;
  commitSha?: string | undefined;
  source: 'ci' | 'runner' | 'manual';
  sourceRoot?: string | undefined;
}

/**
 * Stores one report and carries every finding in it forward.
 *
 * Idempotent in effect: uploading the same report twice adds a report row and changes no
 * finding — every one is `persisting` the second time.
 */
export async function ingestHealthReport(
  options: RepoHealthOptions,
  input: UploadInput,
): Promise<HealthUploadResult> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, input.projectId);
  const branch = branchFor(project, input.branch);
  const parsed = parseReport(input.format, input.bytes, input.sourceRoot);
  const toolKey = toolKeyFor(input.format, parsed.tools);
  const scope = and(
    eq(healthFindings.workspaceId, options.workspaceId),
    eq(healthFindings.projectId, project.id),
    eq(healthFindings.branch, branch),
  );

  // The grade as it stood before this report, which is what an alert compares against. Read
  // live rather than from the last snapshot: two snapshots taken in one instant have no order.
  const before = {
    grade: await computeGrade(options, project, branch, now),
    everReported: (await latestReports(options, project.id, branch)).length > 0,
  };
  const inserted = await options.db
    .insert(healthReports)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      branch,
      commitSha: input.commitSha?.slice(0, 64) ?? null,
      source: input.source,
      format: input.format,
      toolKey,
      tools: parsed.tools,
      metrics: parsed.metrics,
      findingCount: parsed.findings.length,
      receivedAt: now,
    })
    .returning({ id: healthReports.id });
  const reportId = (inserted[0] as { id: string }).id;

  let created = 0;
  let persisting = 0;
  let fixed = 0;
  const added: CanonicalFinding[] = [];
  if (input.format === 'sarif') {
    const rules = await ownerRules(options, project);
    const existing = await options.db
      .select({ fingerprint: healthFindings.fingerprint, state: healthFindings.state })
      .from(healthFindings)
      .where(and(scope, eq(healthFindings.toolKey, toolKey)));
    const known = new Map(existing.map((row) => [row.fingerprint, row.state]));
    const present = new Set(parsed.findings.map((finding) => finding.fingerprint));
    for (const finding of parsed.findings) {
      if (known.has(finding.fingerprint)) persisting += 1;
      else {
        created += 1;
        added.push(finding);
      }
    }
    for (let start = 0; start < parsed.findings.length; start += INSERT_CHUNK) {
      const chunk = parsed.findings.slice(start, start + INSERT_CHUNK);
      await options.db
        .insert(healthFindings)
        .values(
          chunk.map((finding) => ({
            workspaceId: options.workspaceId,
            projectId: project.id,
            branch,
            fingerprint: finding.fingerprint,
            toolKey,
            tool: finding.tool,
            ruleId: finding.ruleId,
            kind: finding.kind,
            severity: finding.severity,
            dimension: finding.dimension,
            path: finding.path,
            line: finding.line,
            message: finding.message,
            helpUri: finding.helpUri,
            fixAvailable: finding.fixAvailable,
            owner: rules === null ? null : ownerOf(rules, finding.path),
            firstSeenAt: now,
            lastSeenAt: now,
            lastReportId: reportId,
          })),
        )
        .onConflictDoUpdate({
          target: [
            healthFindings.workspaceId,
            healthFindings.projectId,
            healthFindings.branch,
            healthFindings.fingerprint,
          ],
          set: {
            toolKey: sql`excluded.tool_key`,
            severity: sql`excluded.severity`,
            kind: sql`excluded.kind`,
            dimension: sql`excluded.dimension`,
            path: sql`excluded.path`,
            line: sql`excluded.line`,
            message: sql`excluded.message`,
            helpUri: sql`excluded.help_uri`,
            fixAvailable: sql`excluded.fix_available`,
            lastSeenAt: sql`excluded.last_seen_at`,
            lastReportId: sql`excluded.last_report_id`,
            // A person's assignment outlives CODEOWNERS; CODEOWNERS fills what nobody assigned.
            owner: sql`COALESCE(${healthFindings.owner}, excluded.owner)`,
            // A fixed finding that comes back is open again; a person's decision is kept.
            state: sql`CASE WHEN ${healthFindings.state} = 'fixed' THEN 'open' ELSE ${healthFindings.state} END`,
          },
        });
    }
    const gone = [...known.entries()]
      .filter(([fingerprint, state]) => state === 'open' && !present.has(fingerprint))
      .map(([fingerprint]) => fingerprint);
    fixed = gone.length;
    for (let start = 0; start < gone.length; start += INSERT_CHUNK) {
      await options.db
        .update(healthFindings)
        .set({ state: 'fixed' })
        .where(
          and(scope, inArray(healthFindings.fingerprint, gone.slice(start, start + INSERT_CHUNK))),
        );
    }
  }

  const current = await computeGrade(options, project, branch, now);
  await recordSnapshot(options, project.id, branch, current, now);
  await options.onReport?.({
    projectId: project.id,
    project: project.name,
    branch,
    onDefaultBranch: branch === branchFor(project),
    previous: before.everReported
      ? { letter: before.grade.letter, score: before.grade.score }
      : null,
    current,
    added,
    settings: settingsOf(project),
  });
  return {
    reportId,
    branch,
    toolKey,
    findings: { new: created, persisting, fixed },
    metrics: parsed.metrics.length,
    grade: current,
  };
}

/** The latest report of each kind on the branch: the set the grade is computed from. */
async function latestReports(options: Options, projectId: string, branch: string) {
  return options.db
    .selectDistinctOn([healthReports.toolKey])
    .from(healthReports)
    .where(
      and(
        eq(healthReports.workspaceId, options.workspaceId),
        eq(healthReports.projectId, projectId),
        eq(healthReports.branch, branch),
      ),
    )
    .orderBy(healthReports.toolKey, desc(healthReports.sequence));
}

function toolRuns(raw: unknown): FindingToolRun[] {
  const parsed = ScannerRunListSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function metricsOf(raw: unknown): DimensionMetric[] {
  const parsed = z.array(DimensionMetricSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}

async function computeGrade(
  options: RepoHealthOptions,
  project: ProjectRow,
  branch: string,
  now: Date,
): Promise<HealthGrade> {
  const reports = await latestReports(options, project.id, branch);
  const findingTools = reports.flatMap((report) => toolRuns(report.tools));
  const metrics = reports.flatMap((report) => metricsOf(report.metrics));
  const keys = reports
    .filter((report) => report.format === 'sarif')
    .map((report) => report.toolKey);
  const rows =
    keys.length === 0
      ? []
      : await options.db
          .select()
          .from(healthFindings)
          .where(
            and(
              eq(healthFindings.workspaceId, options.workspaceId),
              eq(healthFindings.projectId, project.id),
              eq(healthFindings.branch, branch),
              inArray(healthFindings.toolKey, keys),
              ne(healthFindings.state, 'fixed'),
            ),
          );
  const findings: FindingObservation[] = rows.map((row) => ({
    fingerprint: row.fingerprint,
    tool: row.tool,
    ruleId: row.ruleId,
    kind: row.kind as FindingObservation['kind'],
    severity: row.severity as FindingObservation['severity'],
    dimension: row.dimension as HealthDimension,
    path: row.path,
    line: row.line,
    message: row.message,
    helpUri: row.helpUri,
    fixAvailable: row.fixAvailable,
    state: effectiveState(row.state, row.triageExpiresAt, now),
  }));
  const tests = branch === branchFor(project) ? await options.testsReading?.(project.id) : null;
  return HealthGradeSchema.parse(
    grade({
      findingTools,
      findings,
      metrics: tests === null || tests === undefined ? metrics : [...metrics, tests.metric],
      failingTests: tests?.failingTests ?? null,
      policy: policyOf(project),
    }),
  );
}

async function recordSnapshot(
  options: Options,
  projectId: string,
  branch: string,
  current: HealthGrade,
  at: Date,
): Promise<void> {
  await options.db.insert(healthSnapshots).values({
    workspaceId: options.workspaceId,
    projectId,
    branch,
    takenAt: at,
    score: current.score,
    letter: current.letter,
    grade: current as unknown as Record<string, unknown>,
  });
}

function reportSummary(row: typeof healthReports.$inferSelect): HealthReportSummary {
  return {
    id: row.id,
    format: row.format as HealthReportFormat,
    source: row.source as HealthReportSummary['source'],
    toolKey: row.toolKey,
    tools: [
      ...toolRuns(row.tools).map((run) => run.tool),
      ...metricsOf(row.metrics).map((metric) => metric.tool),
    ].filter(
      (tool, index, all) =>
        all.findIndex((other) => other.name === tool.name && other.version === tool.version) ===
        index,
    ),
    commitSha: row.commitSha,
    findingCount: row.findingCount,
    receivedAt: row.receivedAt.toISOString(),
  };
}

export async function projectHealth(
  options: RepoHealthOptions,
  projectId: string,
  requestedBranch?: string,
): Promise<ProjectHealth> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, requestedBranch);
  const current = await computeGrade(options, project, branch, now);
  const reports = await latestReports(options, project.id, branch);
  return {
    projectId: project.id,
    name: project.name,
    branch,
    evaluatedAt: now.toISOString(),
    grade: current,
    reports: [...reports].sort((left, right) => right.sequence - left.sequence).map(reportSummary),
  };
}

export interface FindingFilters {
  branch?: string | undefined;
  dimension?: HealthDimension | undefined;
  severity?: CanonicalFinding['severity'] | undefined;
  state?: FindingState | undefined;
  tool?: string | undefined;
  /** Substring of the path, the rule or the message. */
  q?: string | undefined;
  limit: number;
  offset: number;
}

function findingFrom(row: typeof healthFindings.$inferSelect, now: Date): HealthFinding {
  return {
    id: row.id,
    branch: row.branch,
    fingerprint: row.fingerprint,
    tool: row.tool,
    ruleId: row.ruleId,
    kind: row.kind as HealthFinding['kind'],
    severity: row.severity as HealthFinding['severity'],
    dimension: row.dimension as HealthDimension,
    path: row.path,
    line: row.line,
    message: row.message,
    helpUri: row.helpUri,
    fixAvailable: row.fixAvailable,
    state: effectiveState(row.state, row.triageExpiresAt, now),
    triageReason: row.triageReason,
    triageExpiresAt: row.triageExpiresAt?.toISOString() ?? null,
    triagedBy: row.triagedBy,
    owner: row.owner,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

const SEVERITY_ORDER = sql`CASE ${healthFindings.severity} WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END`;

export async function listFindings(
  options: RepoHealthOptions,
  projectId: string,
  filters: FindingFilters,
): Promise<HealthFindingsPage> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, filters.branch);
  const conditions: SQL[] = [
    eq(healthFindings.workspaceId, options.workspaceId),
    eq(healthFindings.projectId, project.id),
    eq(healthFindings.branch, branch),
  ];
  if (filters.dimension !== undefined)
    conditions.push(eq(healthFindings.dimension, filters.dimension));
  if (filters.severity !== undefined)
    conditions.push(eq(healthFindings.severity, filters.severity));
  if (filters.tool !== undefined) conditions.push(eq(healthFindings.tool, filters.tool));
  if (filters.state !== undefined) {
    // The filter is on the state that counts, so an expired acceptance is found under `open`.
    const expired = sql`(${healthFindings.state} IN ('suppressed', 'accepted') AND ${healthFindings.triageExpiresAt} IS NOT NULL AND ${healthFindings.triageExpiresAt} <= ${now})`;
    conditions.push(
      filters.state === 'open'
        ? sql`(${healthFindings.state} = 'open' OR ${expired})`
        : filters.state === 'suppressed' || filters.state === 'accepted'
          ? sql`(${healthFindings.state} = ${filters.state} AND NOT ${expired})`
          : eq(healthFindings.state, filters.state),
    );
  }
  if (filters.q !== undefined && filters.q.trim().length > 0) {
    const pattern = `%${filters.q.trim().replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
    conditions.push(
      sql`(${healthFindings.path} ILIKE ${pattern} OR ${healthFindings.ruleId} ILIKE ${pattern} OR ${healthFindings.message} ILIKE ${pattern})`,
    );
  }
  const where = and(...conditions);
  const [rows, totals] = await Promise.all([
    options.db
      .select()
      .from(healthFindings)
      .where(where)
      .orderBy(
        SEVERITY_ORDER,
        asc(healthFindings.path),
        asc(healthFindings.line),
        asc(healthFindings.id),
      )
      .limit(filters.limit)
      .offset(filters.offset),
    options.db.select({ total: count() }).from(healthFindings).where(where),
  ]);
  return {
    findings: rows.map((row) => findingFrom(row, now)),
    total: Number(totals[0]?.total ?? 0),
    offset: filters.offset,
    limit: filters.limit,
  };
}

export async function healthHistory(
  options: RepoHealthOptions,
  projectId: string,
  requestedBranch?: string,
  days = HISTORY_DAYS,
): Promise<HealthHistory> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, requestedBranch);
  const rows = await options.db
    .select()
    .from(healthSnapshots)
    .where(
      and(
        eq(healthSnapshots.workspaceId, options.workspaceId),
        eq(healthSnapshots.projectId, project.id),
        eq(healthSnapshots.branch, branch),
        gte(healthSnapshots.takenAt, new Date(now.getTime() - days * DAY_MS)),
      ),
    )
    .orderBy(asc(healthSnapshots.takenAt));
  return {
    projectId: project.id,
    branch,
    points: rows.map((row) => {
      const stored = HealthGradeSchema.safeParse(row.grade);
      return {
        at: row.takenAt.toISOString(),
        score: row.score,
        letter: row.letter as HealthHistory['points'][number]['letter'],
        dimensions: stored.success
          ? Object.fromEntries(
              stored.data.dimensions.map((entry) => [entry.dimension, entry.score]),
            )
          : {},
      };
    }),
  };
}

/**
 * Every project in the workspace, read from its latest snapshot on its default branch.
 *
 * The portfolio reads snapshots rather than re-grading every project, so opening it costs
 * one query per project rather than a full grade each; every upload and every triage
 * decision writes a fresh snapshot, so the latest one is the current grade.
 */
export async function portfolio(options: RepoHealthOptions): Promise<Portfolio> {
  const now = options.now?.() ?? new Date();
  const rows = await options.db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      defaultBranch: projects.defaultBranch,
    })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(asc(projects.name));
  const entries: PortfolioEntry[] = [];
  for (const project of rows) {
    const branch = branchFor(project);
    const scope = and(
      eq(healthSnapshots.workspaceId, options.workspaceId),
      eq(healthSnapshots.projectId, project.id),
      eq(healthSnapshots.branch, branch),
    );
    const [latest, past] = await Promise.all([
      options.db
        .select()
        .from(healthSnapshots)
        .where(scope)
        .orderBy(desc(healthSnapshots.takenAt))
        .limit(1),
      options.db
        .select({ score: healthSnapshots.score })
        .from(healthSnapshots)
        .where(
          and(
            scope,
            sql`${healthSnapshots.takenAt} <= ${new Date(now.getTime() - TREND_DAYS * DAY_MS)}`,
          ),
        )
        .orderBy(desc(healthSnapshots.takenAt))
        .limit(1),
    ]);
    const snapshot = latest[0];
    const stored = snapshot === undefined ? null : HealthGradeSchema.safeParse(snapshot.grade);
    const current = stored?.success === true ? stored.data : null;
    const measured = (current?.dimensions ?? []).filter((entry) => entry.score !== null);
    const worst = measured.reduce<(typeof measured)[number] | null>(
      (lowest, entry) =>
        lowest === null || (entry.score ?? 0) < (lowest.score ?? 0) ? entry : lowest,
      null,
    );
    const pastScore = past[0]?.score ?? null;
    entries.push({
      projectId: project.id,
      name: project.name,
      slug: project.slug,
      branch,
      score: current?.score ?? null,
      letter: current?.letter ?? null,
      incomplete: current?.incomplete ?? true,
      limiter: current?.limiter ?? current?.incompleteReason ?? null,
      worst: worst?.dimension ?? null,
      trend:
        current?.score === null || current?.score === undefined || pastScore === null
          ? null
          : Math.round((current.score - pastScore) * 10) / 10,
      lastReportAt: snapshot?.takenAt.toISOString() ?? null,
    });
  }
  return { projects: entries };
}

/**
 * A person's decision about one finding, and a fresh snapshot so the portfolio reflects it.
 *
 * Reopening clears the reason and the expiry. `owner` is set independently of the state.
 */
export async function triageFinding(
  options: RepoHealthOptions,
  projectId: string,
  findingId: string,
  body: TriageFindingBody,
  actor: string,
): Promise<HealthFinding> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  if (!/^[0-9a-f-]{36}$/iu.test(findingId)) {
    throw new DomainError(ErrorCode.NOT_FOUND, `No finding ${findingId}`);
  }
  const reopening = body.state === 'open';
  const updated = await options.db
    .update(healthFindings)
    .set({
      state: body.state,
      triageReason: reopening ? null : (body.reason ?? null),
      triageExpiresAt: reopening || body.expiresAt === undefined ? null : new Date(body.expiresAt),
      triagedBy: reopening ? null : actor,
      ...(body.owner === undefined ? {} : { owner: body.owner }),
    })
    .where(
      and(
        eq(healthFindings.workspaceId, options.workspaceId),
        eq(healthFindings.projectId, project.id),
        eq(healthFindings.id, findingId),
        // A fixed finding is not on the board; deciding about it would be deciding about nothing.
        ne(healthFindings.state, 'fixed'),
      ),
    )
    .returning();
  const row = updated[0];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No open finding ${findingId}`);
  const current = await computeGrade(options, project, row.branch, now);
  await recordSnapshot(options, project.id, row.branch, current, now);
  return findingFrom(row, now);
}

/** The grade on a branch, for the pull-request gate. */
export async function branchGrade(
  options: RepoHealthOptions,
  projectId: string,
  branch: string,
): Promise<HealthGrade> {
  const project = await projectRow(options, projectId);
  return computeGrade(options, project, branchFor(project, branch), options.now?.() ?? new Date());
}

/** Open findings on `branch` whose fingerprint is not open on the default branch. */
export async function newFindingsAgainstDefault(
  options: RepoHealthOptions,
  projectId: string,
  branch: string,
): Promise<HealthFinding[]> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const base = branchFor(project);
  const target = branchFor(project, branch);
  if (base === target) return [];
  const scope = (name: string) =>
    and(
      eq(healthFindings.workspaceId, options.workspaceId),
      eq(healthFindings.projectId, project.id),
      eq(healthFindings.branch, name),
      ne(healthFindings.state, 'fixed'),
    );
  const [onBranch, onBase] = await Promise.all([
    options.db.select().from(healthFindings).where(scope(target)),
    options.db
      .select({ fingerprint: healthFindings.fingerprint })
      .from(healthFindings)
      .where(scope(base)),
  ]);
  const known = new Set(onBase.map((row) => row.fingerprint));
  return onBranch
    .map((row) => findingFrom(row, now))
    .filter((finding) => finding.state === 'open' && !known.has(finding.fingerprint));
}

/**
 * The existing QA score as the Tests dimension.
 *
 * `null` when no run has been recorded: a QA score over zero runs is a number about nothing,
 * and Tests stays "not measured" rather than borrowing it. The failing count is the distinct
 * fingerprints that failed every time in the window — flaky ones are the score's business.
 */
export async function qaTestsReading(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  at: Date,
): Promise<TestsReading | null> {
  let score: Awaited<ReturnType<typeof qaScore>>;
  try {
    score = await qaScore(options, projectId, at.toISOString());
  } catch {
    // A project with no readable profile — registered by git URL, never detected — has no QA
    // score to read. Tests is then not measured, which is the truth, rather than a 500 on
    // every health read for a reason the health dimensions have nothing to do with.
    return null;
  }
  if (score.provenance.runsRead === 0) return null;
  const failing = new Set(score.cells.flatMap((cell) => cell.inputs.failedFingerprints));
  return {
    metric: {
      dimension: 'tests',
      metric: 'qa score',
      tool: { name: 'automate', version: null },
      score: score.total,
      summary: `QA score ${score.total.toFixed(0)} / 100 over ${String(score.provenance.runsRead)} runs, limited by ${score.cappedBy}`,
    },
    failingTests: failing.size,
  };
}

// ─── Scans this install runs ─────────────────────────────────────────────────

/**
 * What a health scan job carries in its run configuration, so the artifact it uploads is
 * ingested as the report it is. Written by `startHealthScan` and nothing else.
 */
export const HealthScanConfigurationSchema = z.object({
  projectId: z.string().min(1),
  scanner: z.string().min(1),
  format: z.enum(HEALTH_REPORT_FORMATS),
  output: z.string().min(1),
  branch: z.string().min(1),
  /** The checkout the scanner ran in, so absolute report paths become repository-relative. */
  sourceRoot: z.string().min(1).nullable(),
});
export type HealthScanConfiguration = z.infer<typeof HealthScanConfigurationSchema>;

export interface HealthScanJob {
  projectId: string;
  scanner: HealthScanner;
  /** The local checkout, or `null` for a git-sourced repository the runner clones. */
  repository: string | null;
  gitUrl: string | null;
  health: HealthScanConfiguration;
}

export interface HealthScanOptions extends RepoHealthOptions {
  /** Enqueues one scanner as one run. Absent: this install cannot run scans. */
  startScanJob?: (job: HealthScanJob) => Promise<{ runId: string }>;
  /** Scanner ids some live runner advertises as installed. */
  scannerCapabilities?: () => Promise<ReadonlySet<string>>;
}

/**
 * Starts every scanner that applies to the repository and that some runner can run.
 *
 * One run per scanner, so a slow Semgrep does not hold back gitleaks' answer and a failed
 * one fails alone. Scanners no runner advertises are returned as `notConfigured` and never
 * enqueued: a job nobody can claim would sit in the queue looking like progress.
 */
export async function startHealthScan(
  options: HealthScanOptions,
  projectId: string,
): Promise<HealthScanStarted> {
  const project = await projectRow(options, projectId);
  const source: RepositorySource | null =
    project.repoPath !== null ? 'local' : project.repositoryUrl !== null ? 'git' : null;
  if (source === null) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST,
      'This project has neither a repository path nor a git URL, so there is nothing to scan. Upload reports from CI instead.',
    );
  }
  if (options.startScanJob === undefined) {
    throw new DomainError(
      ErrorCode.NOT_CONFIGURED,
      'This install has no runner queue to scan with.',
    );
  }
  const ecosystem =
    typeof project.profile['ecosystem'] === 'string' ? project.profile['ecosystem'] : null;
  const applicable = healthScannersFor(ecosystem, source);
  const available = (await options.scannerCapabilities?.()) ?? new Set<string>();
  const runnable = applicable.filter((scanner) => available.has(scanner.id));
  const runIds: string[] = [];
  for (const scanner of runnable) {
    const started = await options.startScanJob({
      projectId: project.id,
      scanner,
      repository: project.repoPath,
      gitUrl: source === 'git' ? project.repositoryUrl : null,
      health: {
        projectId: project.id,
        scanner: scanner.id,
        format: scanner.format,
        output: scanner.output,
        branch: branchFor(project),
        sourceRoot: project.repoPath,
      },
    });
    runIds.push(started.runId);
  }
  return {
    runIds,
    scanners: runnable.map((scanner) => scanner.id),
    notConfigured: applicable
      .filter((scanner) => !available.has(scanner.id))
      .map((scanner) => scanner.id),
  };
}

/**
 * Ingests a runner artifact when its run is a health scan and the artifact is the report.
 *
 * Returns `null` for every other artifact — a log, a screenshot, a test run's JUnit file —
 * so the hook can sit on the artifact door without changing what the door does.
 */
export async function ingestScanArtifact(
  options: RepoHealthOptions,
  configuration: Record<string, unknown>,
  artifactName: string,
  bytes: Uint8Array,
  /** The runner's clone path, which the job could not know when it was enqueued. */
  checkoutRoot?: string,
): Promise<HealthUploadResult | null> {
  const parsed = HealthScanConfigurationSchema.safeParse(configuration['health']);
  if (!parsed.success || artifactName !== parsed.data.output) return null;
  return ingestHealthReport(options, {
    projectId: parsed.data.projectId,
    format: parsed.data.format,
    bytes,
    branch: parsed.data.branch,
    source: 'runner',
    sourceRoot: parsed.data.sourceRoot ?? checkoutRoot,
  });
}

// ─── Settings, ownership, the gate and schedules ─────────────────────────────

function settingsOf(project: Pick<ProjectRow, 'settings'>): HealthSettings {
  const parsed = HealthSettingsSchema.safeParse(project.settings['health'] ?? {});
  return parsed.success ? parsed.data : {};
}

async function writeSettings(
  options: Options,
  project: ProjectRow,
  change: Partial<HealthSettings>,
): Promise<HealthSettings> {
  const next = { ...settingsOf(project), ...change };
  await options.db
    .update(projects)
    .set({ settings: { ...project.settings, health: next }, updatedAt: new Date() })
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, project.id)));
  return next;
}

/** CODEOWNERS: the uploaded copy first, then the local checkout's own, else `null`. */
async function ownerRules(
  options: RepoHealthOptions,
  project: ProjectRow,
): Promise<OwnerRule[] | null> {
  const uploaded = settingsOf(project).codeowners;
  if (uploaded !== undefined) return parseCodeowners(uploaded);
  if (project.repoPath === null || options.readRepositoryFile === undefined) return null;
  for (const candidate of CODEOWNERS_PATHS) {
    const text = await options.readRepositoryFile(project.repoPath, candidate);
    if (text !== null) return parseCodeowners(text);
  }
  return null;
}

/**
 * Stores an uploaded CODEOWNERS and assigns owners to every finding nobody has assigned.
 *
 * A git-sourced or CI-only project has no checkout here to read the file from, so its CI
 * sends it. Returns how many findings gained an owner.
 */
export async function setCodeowners(
  options: RepoHealthOptions,
  projectId: string,
  text: string,
): Promise<{ rules: number; assigned: number }> {
  const project = await projectRow(options, projectId);
  const rules = parseCodeowners(text);
  await writeSettings(options, project, { codeowners: text });
  const unowned = await options.db
    .select({ id: healthFindings.id, path: healthFindings.path })
    .from(healthFindings)
    .where(
      and(
        eq(healthFindings.workspaceId, options.workspaceId),
        eq(healthFindings.projectId, project.id),
        isNull(healthFindings.owner),
      ),
    );
  let assigned = 0;
  for (const finding of unowned) {
    const owner = ownerOf(rules, finding.path);
    if (owner === null) continue;
    await options.db.update(healthFindings).set({ owner }).where(eq(healthFindings.id, finding.id));
    assigned += 1;
  }
  return { rules: rules.length, assigned };
}

export async function getHealthSettings(
  options: RepoHealthOptions,
  projectId: string,
): Promise<Omit<HealthSettings, 'codeowners'> & { codeowners: boolean }> {
  const settings = settingsOf(await projectRow(options, projectId));
  return {
    alerts: settings.alerts ?? {},
    schedule: settings.schedule ?? null,
    codeowners: settings.codeowners !== undefined,
  };
}

export async function setAlertSettings(
  options: RepoHealthOptions,
  projectId: string,
  alerts: HealthSettings['alerts'],
): Promise<HealthSettings['alerts']> {
  const project = await projectRow(options, projectId);
  return (await writeSettings(options, project, { alerts: alerts ?? {} })).alerts;
}

export interface GateResult {
  branch: string;
  verdict: GateVerdict;
  grade: HealthGrade;
  added: HealthFinding[];
}

/** The pull-request gate for a branch: its grade, and what it adds over the default branch. */
export async function healthGate(
  options: RepoHealthOptions,
  projectId: string,
  branch: string,
): Promise<GateResult> {
  const project = await projectRow(options, projectId);
  const target = branchFor(project, branch);
  const current = await computeGrade(options, project, target, options.now?.() ?? new Date());
  const added = await newFindingsAgainstDefault(options, project.id, target);
  return {
    branch: target,
    verdict: evaluateHealthGate(policyOf(project)?.gate, current, added),
    grade: current,
    added,
  };
}

/** What a project's repository is, for the integrations that talk to its host. */
export async function projectSource(
  options: Options,
  projectId: string,
): Promise<{ name: string; repositoryUrl: string | null }> {
  const project = await projectRow(options, projectId);
  return { name: project.name, repositoryUrl: project.repositoryUrl };
}

export const SCHEDULE_CRON: Readonly<Record<'daily' | 'weekly', string>> = {
  daily: '0 3 * * *',
  weekly: '0 3 * * 1',
};

/**
 * Replaces the project's scheduled health scans: one `schedules` row per scanner, which the
 * worker enqueues on the cron like any other schedule.
 *
 * The scanners are the ones that apply *and* that a runner advertises now; one added later is
 * picked up by saving the schedule again, which the dashboard says. `null` removes them all.
 */
export async function setHealthSchedule(
  options: HealthScanOptions,
  projectId: string,
  cadence: 'daily' | 'weekly' | null,
): Promise<{ cadence: 'daily' | 'weekly' | null; scanners: string[] }> {
  const project = await projectRow(options, projectId);
  const prefix = `health:${project.id}:`;
  await options.db
    .delete(schedules)
    .where(
      and(
        eq(schedules.workspaceId, options.workspaceId),
        sql`${schedules.id} LIKE ${`${prefix}%`}`,
      ),
    );
  await writeSettings(options, project, { schedule: cadence });
  if (cadence === null) return { cadence, scanners: [] };
  const source: RepositorySource | null =
    project.repoPath !== null ? 'local' : project.repositoryUrl !== null ? 'git' : null;
  if (source === null) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST,
      'A project with no repository path or git URL cannot be scanned on a schedule.',
    );
  }
  const ecosystem =
    typeof project.profile['ecosystem'] === 'string' ? project.profile['ecosystem'] : null;
  const available = (await options.scannerCapabilities?.()) ?? new Set<string>();
  const scanners = healthScannersFor(ecosystem, source).filter((scanner) =>
    available.has(scanner.id),
  );
  const branch = branchFor(project);
  const now = options.now?.() ?? new Date();
  for (const scanner of scanners) {
    await options.db.insert(schedules).values({
      id: `${prefix}${scanner.id}`,
      cronExpr: SCHEDULE_CRON[cadence],
      enabled: true,
      workspaceId: options.workspaceId,
      createdAt: now,
      runOptions: {
        misfirePolicy: 'run_once',
        request: {
          workspaceId: options.workspaceId,
          projectId: project.id,
          branch,
          testType: 'health',
          framework: 'tool',
          suite: `health: ${scanner.label}`,
          timeoutMs: 20 * 60_000,
          requiredCapabilities: [scanner.id],
          configuration: {
            commandId: `health:${scanner.id}`,
            health: {
              projectId: project.id,
              scanner: scanner.id,
              format: scanner.format,
              output: scanner.output,
              branch,
              sourceRoot: project.repoPath,
            },
            command: {
              argv: [...scanner.argv],
              workingDirectory: '.',
              ...(project.repoPath === null ? {} : { repository: project.repoPath }),
              artifactGlobs: [scanner.output],
              env: [],
              evidence: 'artifact',
            },
            ...(source === 'git'
              ? { checkout: { url: project.repositoryUrl, projectId: project.id } }
              : {}),
          },
        },
      },
    });
  }
  return { cadence, scanners: scanners.map((scanner) => scanner.id) };
}
