import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as schema from '@automate/db';
import type { ConnectorRequest } from '@automate/connectors-sdk';
import { AGENT_SIGNATURES } from '@automate/reporting';
import {
  AiCodePullRequestListSchema,
  AiCodeReportSchema,
  PortfolioAiCodeSchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import {
  aiCodeReading,
  aiGovernanceCheck,
  recordGateFindings,
} from '../services/ai-code-service.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { syntheticReporterSecret } from '../test-support/synthetic-credentials.js';
import { createAiCodeRoutes } from './ai-code.js';
import { createRepoHealthRoutes } from './repo-health.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const SECRET = syntheticReporterSecret();
const NOW = new Date('2026-10-26T00:00:00.000Z');
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

/** The people in the fixtures. None of these may appear in any ai-code response. */
const PEOPLE = {
  logins: ['alice-person', 'bob-reviewer', 'carol-committer'],
  emails: ['alice@people.example', 'carol@people.example'],
  names: ['Alice Person', 'Carol Committer'],
};

async function harness() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: 'ws-1',
      name: 'Service',
      slug: 'service',
      defaultBranch: 'main',
      repositoryUrl: 'https://github.com/octo/service',
      profile: { health: { aiGovernance: { enabled: true, requireTestsTouched: true } } },
    })
    .returning({ id: schema.projects.id });
  const projectId = (project as { id: string }).id;
  const tokens: Record<string, Caller> = {
    amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
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
  const requests: ConnectorRequest[] = [];
  const base = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  const app = new Hono()
    .onError(onError)
    .route('/', createAiCodeRoutes({ ...base, access }))
    .route(
      '/',
      createRepoHealthRoutes({
        ...base,
        access,
        reporterSecret: SECRET,
        requireReporterSecret: true,
        aiCodeReading: (id) => aiCodeReading(base, id),
        aiGovernance: (id, pullRequest, facts) => aiGovernanceCheck(base, id, pullRequest, facts),
        onGateReport: (id, report) => recordGateFindings(base, id, report),
        github: {
          tokenFor: async () => 'synthetic-github-token',
          adapter: {
            manifest: { name: 'github', version: '1', operations: {} },
            execute: async (request) => {
              requests.push(request);
              return { status: 'ok', data: [], attempts: 1 };
            },
          },
        },
      }),
    );
  await seed(db, projectId);
  return { app, db, projectId, requests };
}

async function seed(db: MigratedDb, projectId: string) {
  const pr = (number: number, extra: Partial<typeof schema.pullRequests.$inferInsert>) => ({
    workspaceId: 'ws-1',
    projectId,
    externalId: String(number),
    number,
    state: 'merged',
    authorLogin: PEOPLE.logins[0],
    headBranch: `feature/${String(number)}`,
    baseBranch: 'main',
    title: `Change ${String(number)}`,
    openedAt: daysAgo(30),
    mergedAt: daysAgo(20 - number),
    mergeCommitSha: number.toString(16).padEnd(40, 'a'),
    lastActivityAt: daysAgo(20 - number),
    attribution: 'human',
    attributionConfidence: 0.5,
    attributionVersion: AGENT_SIGNATURES.version,
    ...extra,
  });
  await db.insert(schema.pullRequests).values([
    pr(1, {}),
    pr(2, {
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
      attributionConfidence: 0.95,
      attributionSignals: [{ kind: 'bot-login', detail: 'author claude[bot] is claude-code' }],
    }),
    pr(3, {
      state: 'open',
      mergedAt: null,
      mergeCommitSha: null,
      attribution: 'agent-authored',
      aiAgent: 'claude-code',
      attributionConfidence: 0.95,
      humanApprovalCount: 0,
      testsTouched: false,
    }),
  ]);
  await db.insert(schema.commits).values({
    workspaceId: 'ws-1',
    projectId,
    sha: 'c'.repeat(40),
    prNumber: 1,
    authorLogin: PEOPLE.logins[2],
    authorEmail: PEOPLE.emails[1],
    authorName: PEOPLE.names[1],
    committerLogin: PEOPLE.logins[2],
    message: 'Change 1',
    committedAt: daysAgo(25),
  });
}

const get = (app: Hono, url: string, token: string | null = 'amt_viewer') =>
  app.request(url, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });

describe('the ai-code routes', () => {
  it('serve viewers the report, the pull requests and the portfolio, each by its contract', async () => {
    const { app, projectId } = await harness();
    const report = AiCodeReportSchema.parse(
      await (await get(app, `/api/v1/projects/${projectId}/ai-code?days=90`)).json(),
    );
    expect(report.comparison.groups['agent-authored'].n).toBe(1);
    expect(report.signatureVersion).toBe(AGENT_SIGNATURES.version);

    const list = AiCodePullRequestListSchema.parse(
      await (
        await get(
          app,
          `/api/v1/projects/${projectId}/ai-code/pull-requests?attribution=agent-authored`,
        )
      ).json(),
    );
    // Newest first by merge time, or opening time while open: #2 merged after #3 was opened.
    expect(list.items.map((item) => item.number)).toEqual([2, 3]);

    const portfolio = PortfolioAiCodeSchema.parse(
      await (await get(app, '/api/v1/portfolio/ai-code')).json(),
    );
    expect(portfolio.projects[0]).toMatchObject({ projectId, changes: 2, aiShare: 50 });
  });

  it('refuse a caller with no credential, and a bad query', async () => {
    const { app, projectId } = await harness();
    expect((await get(app, `/api/v1/projects/${projectId}/ai-code`, null)).status).toBe(401);
    expect((await get(app, '/api/v1/portfolio/ai-code', null)).status).toBe(401);
    expect((await get(app, `/api/v1/projects/${projectId}/ai-code?days=0`)).status).toBe(400);
    expect(
      (await get(app, `/api/v1/projects/${projectId}/ai-code/pull-requests?attribution=robot`))
        .status,
    ).toBe(400);
    expect(
      (await get(app, `/api/v1/projects/${projectId}/ai-code/pull-requests?limit=500`)).status,
    ).toBe(400);
    expect((await get(app, '/api/v1/projects/not-a-project/ai-code')).status).toBe(404);
  });

  it('never return a person: no login, email or name from the fixtures appears in any response', async () => {
    const { app, projectId } = await harness();
    const bodies = await Promise.all(
      [
        `/api/v1/projects/${projectId}/ai-code?days=90`,
        `/api/v1/projects/${projectId}/ai-code/pull-requests`,
        `/api/v1/projects/${projectId}/ai-code/pull-requests?attribution=human`,
        '/api/v1/portfolio/ai-code',
      ].map(async (url) => {
        const response = await get(app, url);
        expect(response.status, url).toBe(200);
        return response.text();
      }),
    );
    for (const body of bodies) {
      for (const identity of [...PEOPLE.logins, ...PEOPLE.emails, ...PEOPLE.names]) {
        expect(body.toLowerCase()).not.toContain(identity.toLowerCase());
      }
      expect(body).not.toMatch(/author_?login|author_?email|author_?name|committer/iu);
    }
  });
});

describe('the gate report and AI governance', () => {
  it('records what the gate found new, fails an agent pull request the rules fail, and comments why', async () => {
    const { app, db, projectId, requests } = await harness();
    const response = await app.request(`/api/v1/projects/${projectId}/health/gate/report`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'feature/3', commit: 'abc1234', pullRequest: 3 }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      verdict: 'failed',
      aiGovernance: {
        pullRequest: 3,
        synced: true,
        attribution: 'agent-authored',
        verdict: { verdict: 'fail' },
      },
    });
    expect(body['reasons']).toContain(
      'AI governance: Agent-authored change by claude-code needs at least one human approval; it has none.',
    );
    const recorded = await db.select().from(schema.pullRequestGateFindings);
    expect(recorded).toMatchObject([
      { workspaceId: 'ws-1', prNumber: 3, commitSha: 'abc1234', newHigh: 0, newCritical: 0 },
    ]);
    const comment = requests.find((request) => request.operation === 'createIssueComment');
    const text = String((comment?.input as { body: string }).body);
    expect(text).toContain('**AI governance**');
    expect(text).toContain('Rules: failed.');
    for (const identity of PEOPLE.logins) expect(text).not.toContain(identity);
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.find((row) => row.action === 'health.gate.report')?.details).toMatchObject({
      pullRequest: 3,
      aiGovernance: 'fail',
    });
  });

  it('says attribution is unknown for a pull request the sync never read', async () => {
    const { app, projectId, requests } = await harness();
    const response = await app.request(`/api/v1/projects/${projectId}/health/gate/report`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'feature/99', commit: 'abc1234', pullRequest: 99 }),
    });
    expect(await response.json()).toMatchObject({
      verdict: 'passed',
      aiGovernance: {
        synced: false,
        attribution: 'unknown',
        verdict: { verdict: 'not-applicable' },
      },
    });
    const comment = requests.find((request) => request.operation === 'createIssueComment');
    expect(String((comment?.input as { body: string }).body)).toContain(
      'Delivery sync is off for this project',
    );
  });

  it('records nothing and reads no rules without a pull request number', async () => {
    const { app, db, projectId } = await harness();
    const response = await app.request(`/api/v1/projects/${projectId}/health/gate/report`, {
      method: 'POST',
      headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' },
      body: JSON.stringify({ branch: 'feature/3', commit: 'abc1234' }),
    });
    expect(await response.json()).toMatchObject({ aiGovernance: null });
    expect(await db.select().from(schema.pullRequestGateFindings)).toEqual([]);
  });
});
