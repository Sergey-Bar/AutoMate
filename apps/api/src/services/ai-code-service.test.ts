import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { AGENT_SIGNATURES } from '@automate/reporting';
import { AiCodeReportSchema } from '@automate/shared-contracts';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  aiCodePullRequests,
  aiCodeReading,
  aiCodeReport,
  aiGovernanceCheck,
  portfolioAiCode,
  recordGateFindings,
  type AiCodeOptions,
} from './ai-code-service.js';
import { branchGrade, healthGate, type RepoHealthOptions } from './repo-health-service.js';

/**
 * AI-written code against the real migration graph: the outcomes of what the sync attributed,
 * the governance rules on one pull request, the gate's record, the grade's metric — and that
 * every read stays inside its workspace.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T00:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);
const sha = (seed: number, fill = 'a') => seed.toString(16).padEnd(40, fill);

async function setup(health: Record<string, unknown> = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: 'ws-1',
      name: 'Service',
      slug: 'service',
      defaultBranch: 'main',
      profile: { health },
    })
    .returning({ id: schema.projects.id });
  const options: AiCodeOptions = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  return { db, options, projectId: (project as { id: string }).id };
}

interface PrSeed {
  number: number;
  attribution?: string;
  aiAgent?: string | null;
  mergedDaysAgo?: number | null;
  title?: string;
  headBranch?: string;
  authorLogin?: string;
  humanApprovalCount?: number;
  testsTouched?: boolean;
  attributionVersion?: string | null;
  workspaceId?: string;
  labels?: string[];
}

async function insertPr(db: MigratedDb, projectId: string, seed: PrSeed) {
  const merged = seed.mergedDaysAgo === undefined ? 40 : seed.mergedDaysAgo;
  await db.insert(schema.pullRequests).values({
    workspaceId: seed.workspaceId ?? 'ws-1',
    projectId,
    externalId: String(seed.number),
    number: seed.number,
    state: merged === null ? 'open' : 'merged',
    authorLogin: seed.authorLogin ?? 'alice-person',
    headBranch: seed.headBranch ?? `feature/${String(seed.number)}`,
    baseBranch: 'main',
    labels: seed.labels ?? [],
    title: seed.title ?? `Change ${String(seed.number)}`,
    openedAt: daysAgo((merged ?? 1) + 1),
    mergedAt: merged === null ? null : daysAgo(merged),
    mergeCommitSha: merged === null ? null : sha(seed.number),
    headSha: sha(seed.number, 'b'),
    changedPaths: ['src/a.ts'],
    additions: 10,
    approvalCount: 1,
    humanApprovalCount: seed.humanApprovalCount ?? 1,
    testsTouched: seed.testsTouched ?? false,
    lastActivityAt: daysAgo(merged ?? 1),
    attribution: seed.attribution ?? 'human',
    aiAgent: seed.aiAgent ?? null,
    attributionConfidence: seed.attribution === 'agent-authored' ? 0.95 : 0.5,
    attributionSignals:
      seed.attribution === 'agent-authored'
        ? [{ kind: 'bot-login', detail: 'author claude[bot] is claude-code' }]
        : [],
    attributionVersion:
      seed.attributionVersion === undefined ? AGENT_SIGNATURES.version : seed.attributionVersion,
  });
}

describe('the ai-code report', () => {
  it('derives each outcome from stored rows and reports the scorecard, the comparison and the share', async () => {
    const { db, options, projectId } = await setup();
    await insertPr(db, projectId, {
      number: 1,
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
      title: 'Add search',
    });
    await insertPr(db, projectId, {
      number: 2,
      mergedDaysAgo: 30,
      title: 'Revert "Add search"',
      headBranch: 'revert-1-feature/1',
    });
    await insertPr(db, projectId, {
      number: 3,
      attribution: 'ai-assisted',
      aiAgent: 'cursor',
      mergedDaysAgo: 20,
      attributionVersion: 'old',
    });
    await insertPr(db, projectId, { number: 4, mergedDaysAgo: null });
    // PR 3's merge commit reached production in a deployment an incident names.
    const [deployment] = await db
      .insert(schema.deployments)
      .values({
        workspaceId: 'ws-1',
        projectId,
        source: 'push',
        externalId: 'd1',
        environment: 'production',
        status: 'success',
        createdAt: daysAgo(19),
        sha: sha(3),
        shas: [sha(3)],
      })
      .returning({ id: schema.deployments.id });
    await db.insert(schema.incidents).values({
      workspaceId: 'ws-1',
      projectId,
      source: 'pager',
      externalId: 'i1',
      openedAt: daysAgo(18),
      deploymentExternalId: 'd1',
      title: 'outage',
    });
    expect(deployment).toBeDefined();
    await db.insert(schema.diffCoverageResults).values({
      workspaceId: 'ws-1',
      projectId,
      branch: 'feature/1',
      commitSha: sha(1, 'b'),
      covered: 3,
      executable: 4,
      ratio: 0.75,
      computedAt: daysAgo(41),
    });
    await recordGateFindings(options, projectId, {
      pullRequest: 1,
      commit: 'ABC1234',
      newHigh: 2,
      newCritical: 1,
    });

    const report = AiCodeReportSchema.parse(await aiCodeReport(options, projectId, 90));
    expect(report).toMatchObject({
      projectId,
      windowDays: 90,
      signatureVersion: AGENT_SIGNATURES.version,
      staleAttribution: 1,
    });
    const { groups } = report.comparison;
    expect(groups['agent-authored']).toMatchObject({ n: 1, revert: { successes: 1, trials: 1 } });
    expect(groups['agent-authored'].diffCoverage.value).toBe(75);
    expect(groups['agent-authored'].newHighFindings.value).toBe(3);
    expect(groups['ai-assisted'].changeFailure).toMatchObject({ successes: 1, trials: 1 });
    // The revert itself is human change that never reached production: no failure verdict.
    expect(groups.human).toMatchObject({ n: 1, changeFailure: { trials: 0 } });
    expect(report.share.reduce((sum, week) => sum + week.total, 0)).toBe(3);
    // Far below the sample floor on every side: nothing is declared.
    expect(report.scorecard).toMatchObject({
      id: 'ai-code',
      dimension: 'ai-governance',
      status: 'insufficient',
    });
  });

  it('lists pull requests by attribution, newest first, with no author', async () => {
    const { db, options, projectId } = await setup();
    await insertPr(db, projectId, {
      number: 1,
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
      mergedDaysAgo: 10,
    });
    await insertPr(db, projectId, { number: 2, mergedDaysAgo: 5 });
    await insertPr(db, projectId, {
      number: 3,
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
      mergedDaysAgo: 1,
    });
    const page = await aiCodePullRequests(options, projectId, {
      attribution: 'agent-authored',
      offset: 0,
      limit: 1,
    });
    expect(page).toMatchObject({ total: 2, offset: 0, limit: 1 });
    expect(page.items.map((item) => item.number)).toEqual([3]);
    expect(page.items[0]).toMatchObject({
      agent: 'claude-code',
      confidence: 0.95,
      attributionVersion: AGENT_SIGNATURES.version,
    });
    expect(JSON.stringify(page)).not.toContain('alice-person');
    const all = await aiCodePullRequests(options, projectId, { offset: 1, limit: 50 });
    expect(all.items.map((item) => item.number)).toEqual([2, 1]);
  });

  it('feeds the scorecard to the grade as an ai-governance metric, counted only when weighted', async () => {
    for (const health of [{}, { weights: { 'ai-governance': 50 } }]) {
      const { db, options, projectId } = await setup(health);
      for (let number = 1; number <= 50; number += 1) {
        await insertPr(db, projectId, {
          number,
          attribution: number <= 25 ? 'agent-authored' : 'human',
          aiAgent: number <= 25 ? 'claude-code' : null,
          mergedDaysAgo: 10 + (number % 20),
        });
      }
      const reading = await aiCodeReading(options, projectId);
      expect(reading.metric).toMatchObject({
        dimension: 'ai-governance',
        metric: 'ai-code',
        score: 100,
      });
      const healthOptions: RepoHealthOptions = {
        ...options,
        aiCodeReading: (id) => aiCodeReading(options, id),
      };
      const grade = await branchGrade(healthOptions, projectId, 'main');
      const dimension = grade.dimensions.find((entry) => entry.dimension === 'ai-governance');
      expect(dimension).toMatchObject({
        measured: true,
        score: 100,
        weight: 'weights' in health ? 50 : 0,
      });
      // Off the default branch it is not read at all.
      const feature = await branchGrade(healthOptions, projectId, 'feature');
      expect(
        feature.dimensions.find((entry) => entry.dimension === 'ai-governance')?.measured,
      ).toBe(false);
    }
  });
});

describe('the governance rules on one pull request', () => {
  const facts = { newHigh: 0, newCritical: 0, diffCoverage: 90 };

  it('is null unless the policy enables it', async () => {
    const { db, options, projectId } = await setup({ aiGovernance: { requireTestsTouched: true } });
    await insertPr(db, projectId, {
      number: 7,
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
    });
    expect(await aiGovernanceCheck(options, projectId, 7, facts)).toBeNull();
  });

  it('fails a synced agent pull request with no human approval, through the health gate', async () => {
    const { db, options, projectId } = await setup({
      aiGovernance: { enabled: true, requireTestsTouched: true, maxNewHighOrCritical: 0 },
    });
    await insertPr(db, projectId, {
      number: 7,
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
      humanApprovalCount: 0,
      mergedDaysAgo: null,
    });
    const gateOptions: RepoHealthOptions = {
      ...options,
      aiGovernance: (id, pullRequest, measured) =>
        aiGovernanceCheck(options, id, pullRequest, measured),
    };
    const result = await healthGate(gateOptions, projectId, 'feature', undefined, 7);
    expect(result.aiGovernance).toMatchObject({
      synced: true,
      attribution: 'agent-authored',
      agent: 'claude-code',
      unknownReason: null,
      verdict: { verdict: 'fail', applies: true },
    });
    expect(result.verdict.verdict).toBe('failed');
    expect(result.verdict.reasons).toEqual([
      'AI governance: Agent-authored change by claude-code needs at least one human approval; it has none.',
      'AI governance: Agent-authored change by claude-code touches no tests.',
    ]);
    // Without a pull request number the rules are not read.
    expect((await healthGate(gateOptions, projectId, 'feature')).aiGovernance).toBeNull();
  });

  it('passes a human pull request untouched (AIGOV-1)', async () => {
    const { db, options, projectId } = await setup({
      aiGovernance: { enabled: true, requireTestsTouched: true },
    });
    await insertPr(db, projectId, { number: 8, humanApprovalCount: 0 });
    expect((await aiGovernanceCheck(options, projectId, 8, facts))?.verdict).toMatchObject({
      verdict: 'not-applicable',
    });
  });

  it('says why attribution is unknown when the pull request was never synced, and never calls it human', async () => {
    const { db, options, projectId } = await setup({ aiGovernance: { enabled: true } });
    const off = await aiGovernanceCheck(options, projectId, 9, facts);
    expect(off).toMatchObject({
      synced: false,
      attribution: 'unknown',
      verdict: { verdict: 'not-applicable' },
    });
    expect(off?.unknownReason).toContain('Delivery sync is off');
    expect(off?.verdict.attributionNote).toBe(
      'Attribution was unknown; the change was treated as human.',
    );

    await db
      .insert(schema.deliverySources)
      .values({ workspaceId: 'ws-1', projectId, enabled: true });
    const pending = await aiGovernanceCheck(options, projectId, 9, facts);
    expect(pending?.unknownReason).toContain('has not read pull request #9 yet');

    const strict = await setup({
      aiGovernance: { enabled: true, treatUnknownAs: 'agent-authored' },
    });
    const failed = await aiGovernanceCheck(strict.options, strict.projectId, 9, facts);
    expect(failed?.verdict).toMatchObject({ verdict: 'fail' });
  });

  it('re-classifies a stale pull request on read, from stored rows', async () => {
    const { db, options, projectId } = await setup({ aiGovernance: { enabled: true } });
    await insertPr(db, projectId, {
      number: 10,
      attribution: 'human',
      attributionVersion: null,
      humanApprovalCount: 0,
      mergedDaysAgo: null,
    });
    await db.insert(schema.commits).values({
      workspaceId: 'ws-1',
      projectId,
      sha: 'c10',
      prNumber: 10,
      authorLogin: 'alice-person',
      message: 'Work\n\nCo-authored-by: Claude <noreply@anthropic.com>',
      committedAt: daysAgo(2),
    });
    const check = await aiGovernanceCheck(options, projectId, 10, facts);
    // Assisted is outside the default `applyTo`, but the reading is the fresh one.
    expect(check).toMatchObject({ attribution: 'ai-assisted', agent: 'claude-code' });
  });
});

describe('the gate’s record of what each pull request added', () => {
  it('upserts one row per pull request', async () => {
    const { db, options, projectId } = await setup();
    await recordGateFindings(options, projectId, {
      pullRequest: 3,
      commit: 'aaa1111',
      newHigh: 1,
      newCritical: 0,
    });
    await recordGateFindings(options, projectId, {
      pullRequest: 3,
      commit: 'BBB2222',
      newHigh: 0,
      newCritical: 2,
    });
    const rows = await db.select().from(schema.pullRequestGateFindings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspaceId: 'ws-1',
      prNumber: 3,
      commitSha: 'bbb2222',
      newHigh: 0,
      newCritical: 2,
    });
  });
});

describe('workspace isolation', () => {
  it('is another workspace’s project, as far as another workspace can tell, not found', async () => {
    const { db, options, projectId } = await setup({ aiGovernance: { enabled: true } });
    await insertPr(db, projectId, {
      number: 1,
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
    });
    const other = { ...options, workspaceId: 'ws-2' };
    const facts = { newHigh: 0, newCritical: 0, diffCoverage: null };
    await expect(aiCodeReport(other, projectId, 90)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      aiCodePullRequests(other, projectId, { offset: 0, limit: 10 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(aiGovernanceCheck(other, projectId, 1, facts)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      recordGateFindings(other, projectId, {
        pullRequest: 1,
        commit: 'abc1234',
        newHigh: 1,
        newCritical: 1,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await db.select().from(schema.pullRequestGateFindings)).toEqual([]);
    expect((await portfolioAiCode(other, 90)).projects).toEqual([]);
  });

  it('reads only its own workspace’s rows for a project of its own', async () => {
    const { db, options, projectId } = await setup();
    const [foreign] = await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-2', name: 'Foreign', slug: 'foreign' })
      .returning({ id: schema.projects.id });
    const foreignId = (foreign as { id: string }).id;
    await insertPr(db, foreignId, {
      number: 1,
      attribution: 'agent-authored',
      workspaceId: 'ws-2',
    });
    await insertPr(db, projectId, { number: 1 });
    const report = await aiCodeReport(options, projectId, 90);
    expect(report.comparison.total).toBe(1);
    expect(report.comparison.groups['agent-authored'].n).toBe(0);
    const portfolio = await portfolioAiCode(options, 90);
    expect(portfolio.projects.map((entry) => entry.projectId)).toEqual([projectId]);
    expect(portfolio.projects[0]).toMatchObject({ changes: 1, aiShare: 0 });
  });
});
