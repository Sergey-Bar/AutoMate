import { afterEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import * as schema from '@automate/db';
import {
  HEALTH_DIMENSIONS,
  PortfolioHeatmapSchema,
  SCORECARD_IDS,
  ScorecardSchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import type { ExecutionRun, ExecutionTestResult } from '../execution/types.js';
import { ingestHealthReport, setSupplyChainPolicy } from '../services/repo-health-service.js';
import { historyReadings, worstSuiteCard } from '../services/scorecard-service.js';
import { LICENCE_TOOL } from '../services/supply-chain-service.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { agentProject } from '../test-support/agent-fixtures.js';
import { createScorecardRoutes } from './scorecards.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T12:00:00.000Z');
const DAY = 86_400_000;

const mutant = (status: string, line: number) => ({
  id: `${status}-${String(line)}`,
  mutatorName: 'ConditionalExpression',
  replacement: 'true',
  location: { start: { line, column: 1 }, end: { line, column: 5 } },
  status,
});

const STRYKER = {
  schemaVersion: '2',
  thresholds: { high: 80, low: 60 },
  files: {
    'src/a.ts': {
      language: 'typescript',
      mutants: [
        mutant('Killed', 1),
        mutant('Killed', 2),
        mutant('Killed', 3),
        mutant('Survived', 4),
      ],
    },
  },
};

function testResult(title: string, status: ExecutionTestResult['status']): ExecutionTestResult {
  return { id: title, title, file: 'a.spec.ts', status, durationMs: 1000, attempt: 2 };
}

function run(id: string, projectId: string | null, tests: ExecutionTestResult[]): ExecutionRun {
  return {
    id,
    createdAt: new Date(NOW.getTime() - DAY).toISOString(),
    outcome: 'passed',
    branch: 'main',
    projectId,
    tests,
    policyEvaluation: null,
  } as unknown as ExecutionRun;
}

async function harness(history?: (since: Date) => Promise<readonly ExecutionRun[]>) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db, {}, { name: 'Alpha' });
  const tokens: Record<string, Caller> = {
    amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
    amt_uploader: { actor: 'token:uploader', role: null, uploaderFor: projectId },
  };
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => tokens[token] ?? null,
    hasSession: async () => false,
  };
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  const app = new Hono().onError(onError).route(
    '/',
    createScorecardRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      now: () => NOW,
      access,
      ...(history === undefined ? {} : { history }),
    }),
  );
  const get = (path: string, token: string | null = 'amt_viewer') =>
    app.request(path, token === null ? {} : { headers: { authorization: `Bearer ${token}` } });
  return { db, projectId, get };
}

async function seedSupplyChain(db: MigratedDb, projectId: string) {
  const base = { workspaceId: 'ws-1', projectId, branch: 'main', source: 'ci' };
  await db.insert(schema.healthReports).values([
    {
      ...base,
      format: 'cyclonedx-json',
      toolKey: 'cyclonedx-json',
      tools: [{ tool: { name: 'syft', version: null }, dimensions: ['dependencies'] }],
      receivedAt: new Date(NOW.getTime() - 3 * DAY),
    },
    {
      ...base,
      format: 'slsa-provenance',
      toolKey: 'slsa-provenance',
      metrics: [
        {
          dimension: 'supply-chain',
          metric: 'slsa-level',
          tool: { name: 'in-toto', version: null },
          score: (2 / 3) * 100,
          summary: 'Provenance: SLSA L2',
        },
      ],
    },
  ]);
  const finding = (
    fingerprint: string,
    extra: Partial<typeof schema.healthFindings.$inferInsert>,
  ) => ({
    workspaceId: 'ws-1',
    projectId,
    branch: 'main',
    fingerprint,
    toolKey: 'cyclonedx-json',
    tool: 'grype',
    ruleId: `CVE-${fingerprint}`,
    kind: 'vulnerability',
    severity: 'high',
    dimension: 'dependencies',
    message: 'a vulnerable component',
    ...extra,
  });
  await db
    .insert(schema.healthFindings)
    .values([
      finding('1', { severity: 'critical', fixAvailable: true }),
      finding('2', {}),
      finding('3', { state: 'accepted', triagedBy: 'vex:doc-1', triageReason: 'not affected' }),
      finding('4', { state: 'fixed' }),
    ]);
  await db
    .insert(schema.vexDocuments)
    .values({ workspaceId: 'ws-1', projectId, documentId: 'doc-1' });
}

describe('GET /api/v1/projects/:id/supply-chain/scorecard', () => {
  it('is not configured for a project nothing reported on, and is a viewer read', async () => {
    const { projectId, get } = await harness();
    const path = `/api/v1/projects/${projectId}/supply-chain/scorecard`;
    expect((await get(path, null)).status).toBe(401);
    // An uploader token is a CI credential, not a reader.
    expect((await get(path, 'amt_uploader')).status).toBe(403);
    const response = await get(path);
    expect(response.status).toBe(200);
    const card = ScorecardSchema.parse(await response.json());
    expect(card).toMatchObject({
      id: 'supply-chain',
      dimension: 'supply-chain',
      status: 'not_configured',
      score: null,
    });
    expect((await get(`${path}?branch=`)).status).toBe(400);
  });

  it('reads provenance, vulnerabilities, VEX and the SBOM age, and fails a fixable critical', async () => {
    const { db, projectId, get } = await harness();
    await seedSupplyChain(db, projectId);
    const card = ScorecardSchema.parse(
      await (await get(`/api/v1/projects/${projectId}/supply-chain/scorecard?branch=main`)).json(),
    );
    const metrics = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(metrics['slsa-level']?.value).toBe(2);
    expect(metrics['fixable-critical']?.value).toBe(1);
    expect(metrics['open-vulnerabilities']?.value).toBe(2);
    // Three non-fixed vulnerability findings, one decided by VEX.
    expect(metrics['vex-coverage']).toMatchObject({ value: 1 / 3, sampleSize: 3 });
    expect(metrics['sbom-age']?.value).toBe(3);
    // No licence policy: no judge, so no number.
    expect(metrics['licence-violations']?.status).toBe('not_configured');
    expect(card).toMatchObject({ status: 'fail', score: 0, cappedBy: 'fixable-critical' });
  });

  it('counts open licence violations, and the denied ones, only under a licence policy', async () => {
    const { db, projectId, get } = await harness();
    const options = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
    const component = (name: string, licenses?: unknown[]) => ({
      'bom-ref': `pkg:npm/${name}@1.0.0`,
      type: 'library',
      name,
      version: '1.0.0',
      purl: `pkg:npm/${name}@1.0.0`,
      ...(licenses === undefined ? {} : { licenses }),
    });
    await ingestHealthReport(options, {
      projectId,
      format: 'cyclonedx-json',
      bytes: new TextEncoder().encode(
        JSON.stringify({
          bomFormat: 'CycloneDX',
          specVersion: '1.5',
          components: [
            component('fine', [{ license: { id: 'MIT' } }]),
            component('gpl-thing', [{ expression: 'GPL-3.0-only' }]),
            component('mystery'),
          ],
        }),
      ),
      branch: 'main',
      source: 'ci',
    });
    const licences = async () => {
      const card = ScorecardSchema.parse(
        await (await get(`/api/v1/projects/${projectId}/supply-chain/scorecard`)).json(),
      );
      return card.metrics.find((metric) => metric.key === 'licence-violations');
    };
    // An inventory with no policy has no judge.
    expect((await licences())?.status).toBe('not_configured');

    await setSupplyChainPolicy(
      options,
      projectId,
      {
        licences: { deny: ['GPL-3.0-only'], failOnUnknown: true },
        provenance: { trustedKeysPem: [], trustedRootsPem: [] },
      },
      'session',
    );
    // One denied and one unknown licence: two open, one of them denied.
    expect(await licences()).toMatchObject({
      value: 2,
      summary: '2 components break the licence policy, 1 under a denied licence.',
    });

    // An accepted licence finding is no longer open, and is not counted.
    await db
      .update(schema.healthFindings)
      .set({ state: 'accepted', triagedBy: 'session', triageReason: 'legal approved' })
      .where(
        and(
          eq(schema.healthFindings.projectId, projectId),
          eq(schema.healthFindings.toolKey, LICENCE_TOOL),
          eq(schema.healthFindings.ruleId, 'licence/denied'),
        ),
      );
    expect(await licences()).toMatchObject({
      value: 1,
      summary: '1 component breaks the licence policy, 0 under a denied licence.',
    });
  });

  it('never reads another workspace’s project', async () => {
    const { db, get } = await harness();
    const [other] = await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-2', name: 'Theirs', slug: 'theirs' })
      .returning({ id: schema.projects.id });
    const id = (other as { id: string }).id;
    await seedSupplyChain(db, id).catch(() => undefined);
    expect((await get(`/api/v1/projects/${id}/supply-chain/scorecard`)).status).toBe(404);
    expect((await get(`/api/v1/projects/${id}/test-effectiveness/scorecard`)).status).toBe(404);
  });
});

describe('GET /api/v1/projects/:id/test-effectiveness/scorecard', () => {
  it('reads the mutation score, diff coverage and the run history', async () => {
    const history = async () => [
      run('r1', null, [testResult('steady', 'passed'), testResult('wobbly', 'flaky')]),
      run('r2', 'someone-else', [testResult('elsewhere', 'failed')]),
    ];
    const { db, projectId, get } = await harness(history);
    await ingestHealthReport(
      { db: db as never, workspaceId: 'ws-1', now: () => NOW },
      {
        projectId,
        format: 'stryker-mutation',
        bytes: new TextEncoder().encode(JSON.stringify(STRYKER)),
        branch: 'main',
        source: 'ci',
      },
    );
    await db.insert(schema.diffCoverageResults).values([
      {
        workspaceId: 'ws-1',
        projectId,
        branch: 'main',
        commitSha: 'a'.repeat(40),
        covered: 3,
        executable: 4,
        ratio: 0.75,
        computedAt: NOW,
      },
      {
        workspaceId: 'ws-1',
        projectId,
        branch: 'main',
        commitSha: 'b'.repeat(40),
        covered: 5,
        executable: 6,
        ratio: 5 / 6,
        computedAt: NOW,
      },
      // Waiting for coverage: not a measurement.
      { workspaceId: 'ws-1', projectId, branch: 'main', commitSha: 'c'.repeat(40) },
    ]);
    const response = await get(`/api/v1/projects/${projectId}/test-effectiveness/scorecard`);
    expect(response.status).toBe(200);
    const card = ScorecardSchema.parse(await response.json());
    const metrics = Object.fromEntries(card.metrics.map((metric) => [metric.key, metric]));
    expect(metrics['mutation-score']?.value).toBe(75);
    expect(metrics['diff-coverage']).toMatchObject({ value: 80, sampleSize: 2 });
    // Two tests seen for this project (the other project's run is not counted): too few.
    expect(metrics['flaky-tests']).toMatchObject({ status: 'insufficient', sampleSize: 2 });
    expect(metrics['flake-cost']?.value).toBeGreaterThan(0);
    expect(card).toMatchObject({
      id: 'test-effectiveness',
      status: 'pass',
      cappedBy: 'mutation-score',
    });
  });

  it('says the run history is not configured when there is no run store', async () => {
    const { projectId, get } = await harness();
    const card = ScorecardSchema.parse(
      await (await get(`/api/v1/projects/${projectId}/test-effectiveness/scorecard`)).json(),
    );
    expect(card.status).toBe('not_configured');
    expect(card.metrics.find((metric) => metric.key === 'flaky-tests')?.status).toBe(
      'not_configured',
    );
  });
});

describe('GET /api/v1/portfolio/heatmap', () => {
  it('answers every dimension and every scorecard for each project in the workspace only', async () => {
    const { db, projectId, get } = await harness(async () => []);
    await agentProject(db, {}, { name: 'Beta' });
    await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-2', name: 'Theirs', slug: 'theirs' });
    await ingestHealthReport(
      { db: db as never, workspaceId: 'ws-1', now: () => NOW },
      {
        projectId,
        format: 'stryker-mutation',
        bytes: new TextEncoder().encode(JSON.stringify(STRYKER)),
        branch: 'main',
        source: 'ci',
      },
    );
    expect((await get('/api/v1/portfolio/heatmap', null)).status).toBe(401);
    const response = await get('/api/v1/portfolio/heatmap');
    expect(response.status).toBe(200);
    const heatmap = PortfolioHeatmapSchema.parse(await response.json());
    expect(heatmap).toMatchObject({ total: 2, truncated: false, limit: 50 });
    expect(heatmap.projects.map((row) => row.name)).toEqual(['Alpha', 'Beta']);
    expect(heatmap.dimensions).toEqual([...HEALTH_DIMENSIONS]);
    const alpha = heatmap.projects[0];
    const effectiveness = alpha?.dimensions.find(
      (entry) => entry.dimension === 'test-effectiveness',
    );
    // The dimension is the grade's own reading (mutation score and its surviving mutants).
    expect(effectiveness?.measured).toBe(true);
    expect(effectiveness?.score).not.toBeNull();
    expect(alpha?.scorecards.map((entry) => entry.id)).toEqual([...SCORECARD_IDS]);
    expect(alpha?.scorecards.find((entry) => entry.id === 'test-effectiveness')).toMatchObject({
      status: 'pass',
    });
    expect(alpha?.scorecards.find((entry) => entry.id === 'agent-quality')?.status).toBe(
      'not_configured',
    );
    expect(heatmap.projects[1]?.lastReportAt).toBeNull();
  });
});

describe('the heatmap helpers', () => {
  it('judges a project by its worst eval suite, failing first', () => {
    const card = (status: 'pass' | 'fail', score: number | null) =>
      ScorecardSchema.parse({
        id: 'agent-quality',
        title: 'Agent quality',
        dimension: 'agent-quality',
        evaluatedAt: NOW.toISOString(),
        windowDays: 30,
        status,
        score,
        cappedBy: score === null ? null : 'pass-rate',
        metrics: [],
        reasons: status === 'fail' ? ['regressed'] : [],
      });
    expect(worstSuiteCard([])).toBeNull();
    expect(worstSuiteCard([card('pass', 40), card('fail', 90), card('pass', 10)])?.score).toBe(90);
    expect(worstSuiteCard([card('pass', 40), card('pass', null), card('pass', 10)])?.score).toBe(
      10,
    );
  });

  it('counts flaky tests, retries and blocked runs from the history', () => {
    const blocked = {
      ...run('b1', 'p', [testResult('wobbly', 'flaky'), testResult('broken', 'failed')]),
      policyEvaluation: { status: 'failed' },
    } as unknown as ExecutionRun;
    const readings = historyReadings([blocked, run('b2', 'p', [testResult('wobbly', 'passed')])]);
    expect(readings.flakes).toMatchObject({ tests: 2, flaky: 1, blockedRuns: 1, retriesSpent: 3 });
    expect(readings.failures).toMatchObject({ failures: 1, causes: 1 });
  });
});
