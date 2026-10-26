import { createHash } from 'node:crypto';
import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import { evalCases, evalRuns, type EvalRunRow } from '@automate/db';
import {
  HealthReportError,
  MAX_HEALTH_REPORT_BYTES,
  parseEvalReport,
  type EvalRun,
} from '@automate/reporter';
import {
  compareEvalRuns,
  evalScorecard,
  type EvalCaseOutcomes,
  type EvalComparison,
} from '@automate/reporting';
import {
  AutomateEvalRunSchema,
  EvalCaseSchema,
  EvalRunSummarySchema,
  HealthPolicySchema,
  type AgentsPolicy,
  type EvalCaseRecord,
  type EvalRunDetail,
  type EvalRunSummary,
  type EvalSuiteStatus,
  type EvalUploadFormat,
  type ProjectEvals,
  type Scorecard,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';
import type { GateEvalSuite } from '@automate/projects';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import {
  INSERT_CHUNK,
  branchFor,
  projectRow,
  type HealthStoreOptions,
  type ProjectRow,
} from './health-findings.js';

/**
 * Eval runs: stored as they arrive through the health upload door, compared per suite against
 * the default branch, and read back.
 *
 * ## One writer
 *
 * {@link storeEvalRun} is the only code that writes `eval_runs` and `eval_cases`. A CI upload
 * reaches it through `ingestHealthReport`; the built-in eval runner writes its run as an
 * `automate-eval-json` document and uploads it through the same `ingestHealthReport`, so a
 * built-in run and an uploaded one are stored, graded and compared by exactly the same code.
 *
 * ## Bounded
 *
 * A stored run keeps at most {@link MAX_STORED_EVAL_CASES} cases and
 * {@link MAX_STORED_ATTEMPTS} attempts per case — `truncated` says when either cut — and a
 * project keeps its {@link EVAL_RUNS_RETAINED} newest runs.
 *
 * ## Prompts
 *
 * A case keeps its prompt text only when the project's policy says `agents.storePrompts`; the
 * sha256 of the prompt is always kept, so two runs of one prompt are recognisable without it.
 */
export type EvalOptions = HealthStoreOptions & { now?: () => Date };

export const MAX_STORED_EVAL_CASES = 5000;
export const MAX_STORED_ATTEMPTS = 100;
export const EVAL_RUNS_RETAINED = 500;
/** The window an eval scorecard reports over. Eval runs are not windowed; this is display. */
export const EVAL_SCORECARD_WINDOW_DAYS = 30;
const MAX_SUITES = 100;
const RECENT_RUNS = 50;

/** The project's agent policy, when its health policy parses. */
export function agentsPolicyOf(project: Pick<ProjectRow, 'profile'>): AgentsPolicy {
  const parsed = HealthPolicySchema.safeParse(project.profile['health']);
  return (parsed.success ? parsed.data.agents : undefined) ?? {};
}

function parseAutomateEval(bytes: Uint8Array, storePrompts: boolean): EvalRun {
  if (bytes.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError('too_large', 'eval run is larger than the upload limit');
  }
  let document: unknown;
  try {
    document = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HealthReportError('malformed', 'automate-eval-json is not valid JSON');
  }
  const parsed = AutomateEvalRunSchema.safeParse(document);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HealthReportError(
      'malformed',
      `automate-eval-json does not match the run shape at ${issue?.path.join('.') ?? '(root)'}`,
    );
  }
  const run = parsed.data;
  return {
    ...run,
    cases: run.cases.map((row) => ({ ...row, prompt: storePrompts ? row.prompt : null })),
  };
}

/** An eval upload as a run. Throws `HealthReportError`, as every report adapter does. */
export function parseEvalUpload(
  format: EvalUploadFormat,
  bytes: Uint8Array,
  storePrompts: boolean,
): EvalRun {
  return format === 'automate-eval-json'
    ? parseAutomateEval(bytes, storePrompts)
    : parseEvalReport(format, bytes, { storePrompts });
}

export interface StoreEvalRunInput {
  projectId: string;
  branch: string;
  commit: string | undefined;
  format: EvalUploadFormat;
  source: 'ci' | 'runner' | 'manual';
  run: EvalRun;
  now: Date;
}

/** The run's cases, cut to the stored bounds, and whether anything was cut. */
function boundedCases(run: EvalRun): { cases: EvalRun['cases']; cut: boolean } {
  const kept = run.cases.slice(0, MAX_STORED_EVAL_CASES);
  let cut = kept.length < run.cases.length;
  const cases = kept.map((row) => {
    if (row.attempts.length <= MAX_STORED_ATTEMPTS) return row;
    cut = true;
    return { ...row, attempts: row.attempts.slice(0, MAX_STORED_ATTEMPTS) };
  });
  return { cases, cut };
}

/** Stores one run and its cases, and keeps the project's newest {@link EVAL_RUNS_RETAINED}. */
export async function storeEvalRun(
  options: EvalOptions,
  input: StoreEvalRunInput,
): Promise<{ id: string }> {
  const { run } = input;
  const { cases, cut } = boundedCases(run);
  const inserted = await options.db
    .insert(evalRuns)
    .values({
      workspaceId: options.workspaceId,
      projectId: input.projectId,
      branch: input.branch,
      commitSha: input.commit ?? null,
      suite: run.suite.slice(0, 200) || 'default',
      format: input.format,
      source: input.source,
      toolName: run.tool.name.slice(0, 100),
      toolVersion: run.tool.version,
      model: run.model,
      provider: run.provider,
      configHash: run.configHash,
      totals: { ...run.totals },
      truncated: run.truncated || cut,
      receivedAt: input.now,
    })
    .returning({ id: evalRuns.id });
  const id = (inserted[0] as { id: string }).id;
  for (let start = 0; start < cases.length; start += INSERT_CHUNK) {
    await options.db.insert(evalCases).values(
      cases.slice(start, start + INSERT_CHUNK).map((row, index) => ({
        workspaceId: options.workspaceId,
        projectId: input.projectId,
        runId: id,
        position: start + index,
        caseId: row.caseId,
        label: row.label,
        promptHash: row.promptHash,
        prompt: row.prompt,
        attempts: row.attempts,
      })),
    );
  }
  await pruneRuns(options, input.projectId);
  return { id };
}

async function pruneRuns(options: EvalOptions, projectId: string): Promise<void> {
  const scope = and(
    eq(evalRuns.workspaceId, options.workspaceId),
    eq(evalRuns.projectId, projectId),
  );
  const keep = options.db
    .select({ id: evalRuns.id })
    .from(evalRuns)
    .where(scope)
    .orderBy(desc(evalRuns.sequence))
    .limit(EVAL_RUNS_RETAINED);
  await options.db.delete(evalRuns).where(and(scope, notInArray(evalRuns.id, keep)));
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const TotalsSchema = EvalRunSummarySchema.shape.totals;

function summaryOf(row: EvalRunRow): EvalRunSummary {
  const totals = TotalsSchema.safeParse(row.totals);
  return {
    id: row.id,
    projectId: row.projectId,
    branch: row.branch,
    commitSha: row.commitSha,
    suite: row.suite,
    format: row.format as EvalUploadFormat,
    source: row.source as EvalRunSummary['source'],
    tool: { name: row.toolName, version: row.toolVersion },
    model: row.model,
    provider: row.provider,
    configHash: row.configHash,
    totals: totals.success
      ? totals.data
      : {
          cases: 0,
          attempts: 0,
          passed: 0,
          failed: 0,
          errors: 0,
          tokensInput: null,
          tokensOutput: null,
          costUsd: null,
          meanLatencyMs: null,
        },
    truncated: row.truncated,
    receivedAt: row.receivedAt.toISOString(),
  };
}

const AttemptsSchema = z.array(EvalCaseSchema.shape.attempts.element);

async function casesOf(options: EvalOptions, runId: string): Promise<EvalCaseRecord[]> {
  const rows = await options.db
    .select()
    .from(evalCases)
    .where(and(eq(evalCases.workspaceId, options.workspaceId), eq(evalCases.runId, runId)))
    .orderBy(asc(evalCases.position));
  return rows.map((row) => {
    const attempts = AttemptsSchema.safeParse(row.attempts);
    return {
      caseId: row.caseId,
      label: row.label,
      promptHash: row.promptHash,
      prompt: row.prompt,
      attempts: attempts.success ? attempts.data : [],
    };
  });
}

/** The newest run of each suite on a branch (and on one commit, when named), by suite name. */
async function latestBySuite(
  options: EvalOptions,
  projectId: string,
  branch: string,
  commit?: string,
): Promise<EvalRunRow[]> {
  return options.db
    .selectDistinctOn([evalRuns.suite])
    .from(evalRuns)
    .where(
      and(
        eq(evalRuns.workspaceId, options.workspaceId),
        eq(evalRuns.projectId, projectId),
        eq(evalRuns.branch, branch),
        commit === undefined ? undefined : eq(evalRuns.commitSha, commit),
      ),
    )
    .orderBy(evalRuns.suite, desc(evalRuns.sequence))
    .limit(MAX_SUITES);
}

/**
 * The bootstrap seed for one comparison: the first 32 bits of sha256 over the two run ids.
 * The same two runs compare to the same answer on every host and every read.
 */
export function evalSeed(baselineId: string, candidateId: string): number {
  return createHash('sha256').update(`${baselineId}:${candidateId}`).digest().readUInt32BE(0);
}

function outcomesOf(cases: readonly EvalCaseRecord[]): EvalCaseOutcomes[] {
  return cases.map((row) => ({ caseId: row.caseId, attempts: row.attempts }));
}

function latestOf(cases: readonly EvalCaseRecord[], costUsd: number | null) {
  const decided = cases.flatMap((row) => row.attempts).filter((attempt) => attempt.passed !== null);
  const passed = decided.filter((attempt) => attempt.passed === true).length;
  return {
    passRate: decided.length === 0 ? null : passed / decided.length,
    attempts: decided.length,
    costUsd,
  };
}

async function suiteStatus(
  options: EvalOptions,
  policy: AgentsPolicy,
  latest: EvalRunRow,
  baseline: EvalRunRow | null,
  now: Date,
): Promise<EvalSuiteStatus> {
  const candidateCases = await casesOf(options, latest.id);
  let comparison: EvalComparison | null = null;
  if (baseline !== null) {
    comparison = compareEvalRuns(
      outcomesOf(await casesOf(options, baseline.id)),
      outcomesOf(candidateCases),
      {
        seed: evalSeed(baseline.id, latest.id),
        maxRegression: policy.maxEvalRegression,
        minAttempts: policy.minEvalAttempts,
      },
    );
  }
  const summary = summaryOf(latest);
  const scorecard: Scorecard = evalScorecard(
    comparison,
    latestOf(candidateCases, summary.totals.costUsd),
    { now, windowDays: EVAL_SCORECARD_WINDOW_DAYS },
  );
  return {
    suite: latest.suite,
    latest: summary,
    baseline: baseline === null ? null : summaryOf(baseline),
    comparison,
    scorecard,
  };
}

/** Every suite on the branch, each against its newest run on the default branch. */
async function suitesOn(
  options: EvalOptions,
  project: ProjectRow,
  branch: string,
  now: Date,
): Promise<EvalSuiteStatus[]> {
  const policy = agentsPolicyOf(project);
  const defaultBranch = branchFor(project);
  const latest = await latestBySuite(options, project.id, branch);
  const baselines =
    branch === defaultBranch
      ? new Map<string, EvalRunRow>()
      : new Map(
          (await latestBySuite(options, project.id, defaultBranch)).map((row) => [row.suite, row]),
        );
  const suites: EvalSuiteStatus[] = [];
  for (const row of latest) {
    suites.push(await suiteStatus(options, policy, row, baselines.get(row.suite) ?? null, now));
  }
  return suites;
}

/** `GET /api/v1/projects/:id/evals?branch=` */
export async function projectEvals(
  options: EvalOptions,
  projectId: string,
  requestedBranch?: string,
): Promise<ProjectEvals> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const branch = branchFor(project, requestedBranch);
  const runs = await options.db
    .select()
    .from(evalRuns)
    .where(
      and(
        eq(evalRuns.workspaceId, options.workspaceId),
        eq(evalRuns.projectId, project.id),
        eq(evalRuns.branch, branch),
      ),
    )
    .orderBy(desc(evalRuns.sequence))
    .limit(RECENT_RUNS);
  return {
    projectId: project.id,
    branch,
    defaultBranch: branchFor(project),
    evaluatedAt: now.toISOString(),
    suites: await suitesOn(options, project, branch, now),
    runs: runs.map(summaryOf),
  };
}

const UUID = /^[0-9a-f-]{36}$/iu;

/** `GET /api/v1/projects/:id/evals/runs/:runId` — another project's run is "no such run". */
export async function evalRunDetail(
  options: EvalOptions,
  projectId: string,
  runId: string,
): Promise<EvalRunDetail> {
  const project = await projectRow(options, projectId);
  if (!UUID.test(runId)) throw new DomainError(ErrorCode.NOT_FOUND, `No eval run ${runId}`);
  const [row] = await options.db
    .select()
    .from(evalRuns)
    .where(
      and(
        eq(evalRuns.workspaceId, options.workspaceId),
        eq(evalRuns.projectId, project.id),
        eq(evalRuns.id, runId),
      ),
    )
    .limit(1);
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No eval run ${runId}`);
  return { ...summaryOf(row), cases: await casesOf(options, row.id) };
}

// ─── The gate ────────────────────────────────────────────────────────────────

export interface EvalGateSuite {
  suite: string;
  /**
   * The comparison's verdict, or `no-baseline` (the default branch never ran this suite) or
   * `missing` (the default branch runs it, this branch did not).
   */
  verdict: GateEvalSuite['verdict'];
  reasons: string[];
  /** Case ids that regressed beyond noise. */
  regressions: string[];
  flaky: string[];
  /** The commit of the branch run the suite was judged on; `null` for `missing` or no commit. */
  commitSha: string | null;
  /** A commit was named, it has no run of this suite, and the branch's latest run was read. */
  fellBack: boolean;
}

/** What the pull-request gate reads about evals, and whether the policy gates on them. */
export interface EvalGateReading {
  gateOnEvals: boolean;
  /**
   * Every suite on the branch, and every suite on the default branch the branch did not run.
   * Empty when neither branch has a run. On the default branch itself nothing is compared —
   * it is the baseline — and `onDefaultBranch` says so.
   */
  suites: EvalGateSuite[];
  /** The commit that was asked for, when one was. */
  commit: string | null;
  onDefaultBranch: boolean;
}

function fellBackNote(commit: string | null, row: EvalRunRow): string {
  const ran = row.commitSha === null ? 'with no commit' : `on ${row.commitSha.slice(0, 12)}`;
  return `no run of this suite on ${String(commit).slice(0, 12)}; judged on the branch's latest run, ${ran}`;
}

function suiteVerdict(
  status: EvalSuiteStatus,
  row: EvalRunRow,
  commit: string | null,
): EvalGateSuite {
  const fellBack = commit !== null && row.commitSha !== commit;
  const note = fellBack ? [fellBackNote(commit, row)] : [];
  const base = { suite: status.suite, commitSha: row.commitSha, fellBack };
  if (status.comparison === null) {
    return { ...base, verdict: 'no-baseline', reasons: [], regressions: [], flaky: [] };
  }
  const { comparison } = status;
  return {
    ...base,
    verdict: comparison.verdict,
    reasons: [...comparison.reasons, ...(comparison.verdict === 'pass' ? [] : note)],
    regressions: comparison.regressions
      .filter((change) => change.significant)
      .map((change) => change.caseId),
    flaky: comparison.flaky,
  };
}

/**
 * The branch's run of each suite for the gate: the run on `commit` when one was named and it
 * has one, otherwise the branch's latest run (which `fellBack` then records).
 */
async function gatedRuns(
  options: EvalOptions,
  projectId: string,
  branch: string,
  commit: string | null,
): Promise<EvalRunRow[]> {
  const latest = await latestBySuite(options, projectId, branch);
  if (commit === null) return latest;
  const onCommit = new Map(
    (await latestBySuite(options, projectId, branch, commit)).map((row) => [row.suite, row]),
  );
  return latest.map((row) => onCommit.get(row.suite) ?? row);
}

/**
 * The gate's reading of a branch's evals. Under `gateOnEvals` every suite here that is not a
 * pass fails the gate (`evaluateHealthGate`): an insufficient comparison, a suite with no
 * baseline, a default-branch suite this branch did not run, and — when the list is empty —
 * a branch and default branch with no eval run at all.
 */
export async function evalGateReading(
  options: EvalOptions,
  projectId: string,
  branch: string,
  commit?: string,
): Promise<EvalGateReading> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const policy = agentsPolicyOf(project);
  const target = branchFor(project, branch);
  const defaultBranch = branchFor(project);
  const sha = commit?.toLowerCase() ?? null;
  const reading = { gateOnEvals: policy.gateOnEvals === true, commit: sha };
  if (target === defaultBranch) return { ...reading, suites: [], onDefaultBranch: true };
  const runs = await gatedRuns(options, project.id, target, sha);
  const baselines = new Map(
    (await latestBySuite(options, project.id, defaultBranch)).map((row) => [row.suite, row]),
  );
  const suites: EvalGateSuite[] = [];
  for (const row of runs) {
    const status = await suiteStatus(options, policy, row, baselines.get(row.suite) ?? null, now);
    suites.push(suiteVerdict(status, row, sha));
  }
  const ran = new Set(runs.map((row) => row.suite));
  for (const suite of baselines.keys()) {
    if (ran.has(suite)) continue;
    suites.push({
      suite,
      verdict: 'missing',
      reasons: [],
      regressions: [],
      flaky: [],
      commitSha: null,
      fellBack: false,
    });
  }
  return { ...reading, suites, onDefaultBranch: false };
}
