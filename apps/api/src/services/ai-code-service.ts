import { and, count, desc, eq, ilike, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import {
  commits,
  deliverySources,
  diffCoverageResults,
  projects,
  pullRequestGateFindings,
  pullRequests,
  type PullRequestRow,
} from '@automate/db';
import {
  AGENT_SIGNATURES,
  aiCodeScorecard,
  compareAiOutcomes,
  evaluateAiGovernance,
  type AiOutcomeChange,
  type AttributionOptions,
} from '@automate/reporting';
import type {
  AiAttribution,
  AiCodePullRequestList,
  AiCodeReport,
  AiGovernancePolicyBlock,
  DimensionMetric,
  PortfolioAiCode,
  Scorecard,
} from '@automate/shared-contracts';
import {
  attributionOptionsOf,
  attributionVersionOf,
  classifyPullRequest,
} from './ai-code-attribution.js';
import { deriveOutcomes, weeklyShare } from './ai-code-outcomes.js';
import { loadInputs, productionCarriersOf, type DeliveryOptions } from './delivery-service.js';
import { projectRow, type ProjectRow } from './health-findings.js';
import {
  healthPolicyOf,
  type AiCodeReading,
  type AiGovernanceCheck,
  type AiGovernanceFacts,
  type GateFindingsReport,
} from './repo-health-service.js';

/**
 * AI-written code: the outcomes of merged pull requests by attribution, the `ai-code`
 * scorecard over them, the governance rules on one pull request, and the gate's record of
 * what each pull request added.
 *
 * ## Nobody is named
 *
 * Nothing in this file selects `author_login`, a commit's author email or name, or a committer
 * — except {@link currentAttribution}, which reads them to re-classify one stale pull request
 * for the gate and returns only the classification. Every response is a repository aggregate
 * or a pull request's number, title and attribution. `ai-code.test.ts` asserts it.
 *
 * ## Stale attribution
 *
 * Rows are classified during sync, and a row classified against another signature table or
 * label set is re-classified at the start of the next sync (`delivery-syncer.ts`). Reads use
 * the stored classification and report how many rows are stale; the governance gate, which
 * acts on one pull request, re-classifies a stale row on read instead of waiting.
 */

export type AiCodeOptions = DeliveryOptions;

/** The window the grade reads the `ai-code` scorecard over. Long enough for the sample floor. */
export const AI_CODE_GRADE_WINDOW_DAYS = 90;
/** Gate findings kept per project; the least recently reported go first. */
export const GATE_FINDINGS_RETENTION = 5000;
const READ_LIMIT = 5000;
const CHUNK = 500;
const PORTFOLIO_LIMIT = 200;

const scopeOf = <
  T extends
    | typeof pullRequests
    | typeof commits
    | typeof diffCoverageResults
    | typeof pullRequestGateFindings,
>(
  table: T,
  options: AiCodeOptions,
  projectId: string,
) => and(eq(table.workspaceId, options.workspaceId), eq(table.projectId, projectId));

function chunks<T>(values: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK) {
    out.push(values.slice(index, index + CHUNK));
  }
  return out;
}

function governancePolicyOf(project: ProjectRow): AiGovernancePolicyBlock | undefined {
  return healthPolicyOf(project)?.aiGovernance;
}

// ─── The gate's record of what each pull request added ──────────────────────

/**
 * Upsert what the gate found new on a pull request, and keep the project's
 * {@link GATE_FINDINGS_RETENTION} most recently reported. The caller audits the gate report
 * this belongs to.
 */
export async function recordGateFindings(
  options: AiCodeOptions,
  projectId: string,
  report: GateFindingsReport,
): Promise<void> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const values = {
    commitSha: report.commit.toLowerCase(),
    newHigh: report.newHigh,
    newCritical: report.newCritical,
    reportedAt: now,
  };
  await options.db
    .insert(pullRequestGateFindings)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      prNumber: report.pullRequest,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        pullRequestGateFindings.workspaceId,
        pullRequestGateFindings.projectId,
        pullRequestGateFindings.prNumber,
      ],
      set: values,
    });
  const scope = scopeOf(pullRequestGateFindings, options, project.id);
  const keep = options.db
    .select({ id: pullRequestGateFindings.id })
    .from(pullRequestGateFindings)
    .where(scope)
    .orderBy(desc(pullRequestGateFindings.reportedAt), desc(pullRequestGateFindings.id))
    .limit(GATE_FINDINGS_RETENTION);
  await options.db
    .delete(pullRequestGateFindings)
    .where(and(scope, notInArray(pullRequestGateFindings.id, keep)));
}

// ─── The governance rules on one pull request ───────────────────────────────

type StoredAttribution = Pick<
  AiGovernanceCheck,
  'attribution' | 'agent' | 'confidence' | 'signals'
>;

/** The stored classification, or — when it is stale — a fresh one from stored rows. */
async function currentAttribution(
  options: AiCodeOptions,
  projectId: string,
  row: PullRequestRow,
  labels: AttributionOptions,
): Promise<StoredAttribution> {
  if (row.attributionVersion === attributionVersionOf(labels)) {
    return {
      attribution: row.attribution as AiAttribution,
      agent: row.aiAgent,
      confidence: row.attributionConfidence,
      signals: row.attributionSignals as StoredAttribution['signals'],
    };
  }
  const stored = await options.db
    .select()
    .from(commits)
    .where(and(scopeOf(commits, options, projectId), eq(commits.prNumber, row.number)));
  const fresh = classifyPullRequest(row, stored, labels);
  return {
    attribution: fresh.attribution,
    agent: fresh.agent,
    confidence: fresh.confidence,
    signals: fresh.signals,
  };
}

async function unsyncedReason(
  options: AiCodeOptions,
  projectId: string,
  pullRequest: number,
): Promise<string> {
  const [source] = await options.db
    .select({ enabled: deliverySources.enabled })
    .from(deliverySources)
    .where(
      and(
        eq(deliverySources.workspaceId, options.workspaceId),
        eq(deliverySources.projectId, projectId),
      ),
    )
    .limit(1);
  if (source?.enabled !== true) {
    return 'Delivery sync is off for this project, so nothing read who wrote this pull request: attribution is unknown, not human.';
  }
  return `Delivery sync has not read pull request #${String(pullRequest)} yet: attribution is unknown, not human, until it does.`;
}

/**
 * The AI-governance rules on one pull request, `null` unless the policy enables them.
 *
 * A pull request the delivery sync has not read is evaluated as `unknown` — with no human
 * approval and no tests touched, since nothing measured either — and the check says why, so a
 * gate never passes an unread pull request as human without saying so. Under the default
 * `treatUnknownAs: 'human'` the rules then do not apply; under `'agent-authored'` they do.
 */
export async function aiGovernanceCheck(
  options: AiCodeOptions,
  projectId: string,
  pullRequest: number,
  facts: AiGovernanceFacts,
): Promise<AiGovernanceCheck | null> {
  const project = await projectRow(options, projectId);
  const policy = governancePolicyOf(project);
  if (policy?.enabled !== true) return null;
  const [row] = await options.db
    .select()
    .from(pullRequests)
    .where(and(scopeOf(pullRequests, options, project.id), eq(pullRequests.number, pullRequest)))
    .orderBy(desc(pullRequests.syncedAt))
    .limit(1);
  const attribution: StoredAttribution =
    row === undefined
      ? { attribution: 'unknown', agent: null, confidence: 0, signals: [] }
      : await currentAttribution(options, project.id, row, attributionOptionsOf(policy));
  const verdict = evaluateAiGovernance(
    {
      attribution: attribution.attribution,
      agent: attribution.agent,
      humanApprovals: row?.humanApprovalCount ?? 0,
      testsTouched: row?.testsTouched ?? false,
      diffCoverage: facts.diffCoverage,
      newHighFindings: facts.newHigh,
      newCriticalFindings: facts.newCritical,
    },
    {
      requireHumanApproval: policy.requireHumanApproval,
      requireTestsTouched: policy.requireTestsTouched,
      minDiffCoverage: policy.minDiffCoverage,
      maxNewHighOrCritical: policy.maxNewHighOrCritical,
      applyTo: policy.applyTo,
      treatUnknownAs: policy.treatUnknownAs,
    },
  );
  return {
    pullRequest,
    synced: row !== undefined,
    ...attribution,
    unknownReason:
      row === undefined ? await unsyncedReason(options, project.id, pullRequest) : null,
    verdict,
  };
}

// ─── Outcomes and the scorecard ──────────────────────────────────────────────

/** Landed commits that say they revert something: default-branch or a merged PR's. */
async function revertCommits(
  options: AiCodeOptions,
  projectId: string,
  mergedNumbers: ReadonlySet<number>,
): Promise<{ message: string }[]> {
  const rows = await options.db
    .select({ message: commits.message, prNumber: commits.prNumber })
    .from(commits)
    .where(
      and(scopeOf(commits, options, projectId), ilike(commits.message, '%this reverts commit%')),
    )
    .orderBy(desc(commits.committedAt))
    .limit(READ_LIMIT);
  return rows.filter((row) => row.prNumber === null || mergedNumbers.has(row.prNumber));
}

/** Head sha → the latest measured diff coverage, 0–100. */
async function diffCoverageByHead(
  options: AiCodeOptions,
  projectId: string,
  heads: readonly string[],
): Promise<Map<string, number>> {
  const coverage = new Map<string, number>();
  for (const chunk of chunks(heads)) {
    const rows = await options.db
      .select({ sha: diffCoverageResults.commitSha, ratio: diffCoverageResults.ratio })
      .from(diffCoverageResults)
      .where(
        and(
          scopeOf(diffCoverageResults, options, projectId),
          inArray(diffCoverageResults.commitSha, chunk),
          isNotNull(diffCoverageResults.ratio),
        ),
      )
      .orderBy(desc(diffCoverageResults.receivedAt));
    for (const row of rows) {
      if (!coverage.has(row.sha)) coverage.set(row.sha, (row.ratio as number) * 100);
    }
  }
  return coverage;
}

async function gateFindingsOf(
  options: AiCodeOptions,
  projectId: string,
  numbers: readonly number[],
): Promise<Map<number, { high: number; critical: number }>> {
  const found = new Map<number, { high: number; critical: number }>();
  for (const chunk of chunks(numbers)) {
    const rows = await options.db
      .select()
      .from(pullRequestGateFindings)
      .where(
        and(
          scopeOf(pullRequestGateFindings, options, projectId),
          inArray(pullRequestGateFindings.prNumber, chunk),
        ),
      );
    for (const row of rows)
      found.set(row.prNumber, { high: row.newHigh, critical: row.newCritical });
  }
  return found;
}

interface AiCodeComputation {
  changes: AiOutcomeChange[];
  comparison: ReturnType<typeof compareAiOutcomes>;
  scorecard: Scorecard;
  staleAttribution: number;
}

const DAY_MS = 86_400_000;

async function computeAiCode(
  options: AiCodeOptions,
  project: ProjectRow,
  windowDays: number,
  now: Date,
): Promise<AiCodeComputation> {
  const { inputs } = await loadInputs(options, project, windowDays, now);
  const merged = inputs.pullRequests.filter((pr) => pr.mergedAt !== null);
  const numbers = merged.map((pr) => pr.number);
  const heads = merged.flatMap((pr) => (pr.headSha === null ? [] : [pr.headSha]));
  const [landedCommits, diffCoverage, gateFindings] = await Promise.all([
    revertCommits(options, project.id, new Set(numbers)),
    diffCoverageByHead(options, project.id, heads),
    gateFindingsOf(options, project.id, numbers),
  ]);
  const changes = deriveOutcomes({
    pullRequests: merged,
    landedCommits,
    carriers: productionCarriersOf(inputs),
    diffCoverage,
    gateFindings,
    defaultBranch: project.defaultBranch ?? 'main',
  });
  const at = now.toISOString();
  const comparison = compareAiOutcomes(changes, { now: at, windowDays });
  const version = attributionVersionOf(attributionOptionsOf(governancePolicyOf(project)));
  const since = now.getTime() - windowDays * DAY_MS;
  return {
    changes,
    comparison,
    scorecard: aiCodeScorecard(comparison, { now: at, windowDays }),
    staleAttribution: merged.filter(
      (pr) => (pr.mergedAt as Date).getTime() >= since && pr.attributionVersion !== version,
    ).length,
  };
}

/** `GET …/ai-code?days=`: the scorecard, the comparison under it and the weekly share. */
export async function aiCodeReport(
  options: AiCodeOptions,
  projectId: string,
  windowDays: number,
): Promise<AiCodeReport> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const computed = await computeAiCode(options, project, windowDays, now);
  return {
    projectId: project.id,
    windowDays,
    evaluatedAt: now.toISOString(),
    signatureVersion: AGENT_SIGNATURES.version,
    staleAttribution: computed.staleAttribution,
    scorecard: computed.scorecard,
    comparison: computed.comparison,
    share: weeklyShare(computed.changes, now, windowDays),
  };
}

export interface AiCodePullRequestQuery {
  attribution?: AiAttribution | undefined;
  offset: number;
  limit: number;
}

/** `GET …/ai-code/pull-requests`: each pull request's attribution, newest first. No author. */
export async function aiCodePullRequests(
  options: AiCodeOptions,
  projectId: string,
  query: AiCodePullRequestQuery,
): Promise<AiCodePullRequestList> {
  const project = await projectRow(options, projectId);
  const where = and(
    scopeOf(pullRequests, options, project.id),
    ...(query.attribution === undefined ? [] : [eq(pullRequests.attribution, query.attribution)]),
  );
  const [rows, totals] = await Promise.all([
    options.db
      .select({
        number: pullRequests.number,
        title: pullRequests.title,
        state: pullRequests.state,
        attribution: pullRequests.attribution,
        agent: pullRequests.aiAgent,
        confidence: pullRequests.attributionConfidence,
        signals: pullRequests.attributionSignals,
        attributionVersion: pullRequests.attributionVersion,
        openedAt: pullRequests.openedAt,
        mergedAt: pullRequests.mergedAt,
      })
      .from(pullRequests)
      .where(where)
      .orderBy(
        desc(sql`coalesce(${pullRequests.mergedAt}, ${pullRequests.openedAt})`),
        desc(pullRequests.number),
      )
      .offset(query.offset)
      .limit(query.limit),
    options.db.select({ total: count() }).from(pullRequests).where(where),
  ]);
  return {
    items: rows.map((row) => ({
      number: row.number,
      title: row.title,
      state: row.state as 'open',
      attribution: row.attribution as AiAttribution,
      agent: row.agent,
      confidence: row.confidence,
      signals: row.signals as AiCodePullRequestList['items'][number]['signals'],
      attributionVersion: row.attributionVersion,
      openedAt: row.openedAt.toISOString(),
      mergedAt: row.mergedAt?.toISOString() ?? null,
    })),
    total: totals[0]?.total ?? 0,
    offset: query.offset,
    limit: query.limit,
  };
}

/** `GET /api/v1/portfolio/ai-code?days=`: per project, the AI share and the scorecard. */
export async function portfolioAiCode(
  options: AiCodeOptions,
  windowDays: number,
): Promise<PortfolioAiCode> {
  const now = options.now?.() ?? new Date();
  const ids = await options.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(projects.name)
    .limit(PORTFOLIO_LIMIT);
  const entries: PortfolioAiCode['projects'][number][] = [];
  for (const { id } of ids) {
    const project = await projectRow(options, id);
    const { comparison, scorecard } = await computeAiCode(options, project, windowDays, now);
    const ai = comparison.groups['agent-authored'].n + comparison.groups['ai-assisted'].n;
    entries.push({
      projectId: project.id,
      name: project.name,
      slug: project.slug,
      changes: comparison.total,
      aiShare: comparison.total === 0 ? null : (ai / comparison.total) * 100,
      scorecard: { status: scorecard.status, score: scorecard.score },
    });
  }
  return { windowDays, evaluatedAt: now.toISOString(), projects: entries };
}

/** The `ai-code` scorecard as the `ai-governance` dimension's metric. */
export async function aiCodeReading(
  options: AiCodeOptions,
  projectId: string,
): Promise<AiCodeReading> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const { scorecard } = await computeAiCode(options, project, AI_CODE_GRADE_WINDOW_DAYS, now);
  return { metric: metricOf(scorecard) };
}

function metricOf(card: Scorecard): DimensionMetric | null {
  if (card.score === null) return null;
  return {
    dimension: 'ai-governance',
    metric: 'ai-code',
    tool: { name: 'automate-ai-code', version: AGENT_SIGNATURES.version },
    score: card.score,
    summary: `AI-written code ${String(card.score)} / 100 over ${String(card.windowDays)} days, limited by ${String(card.cappedBy)}`,
  };
}
