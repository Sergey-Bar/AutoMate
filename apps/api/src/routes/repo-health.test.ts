import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import {
  HealthFindingsPageSchema,
  HealthHistorySchema,
  HealthUploadResultSchema,
  PortfolioSchema,
  ProjectHealthSchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { syntheticReporterSecret } from '../test-support/synthetic-credentials.js';
import { createRepoHealthRoutes, type RepoHealthRouteOptions } from './repo-health.js';
import { eq } from 'drizzle-orm';
import type { ConnectorRequest } from '@automate/connectors-sdk';

const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDirectory = path.resolve(here, '../../../../packages/db/drizzle');
const fixtures = path.resolve(here, '../../../../packages/reporter/src/adapters/fixtures/health');
const SECRET = syntheticReporterSecret();

function migrationSql(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

const clients: PGlite[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function harness(
  options: { secret?: string; require?: boolean; extra?: Partial<RepoHealthRouteOptions> } = {
    secret: SECRET,
  },
) {
  const client = new PGlite();
  clients.push(client);
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  await db
    .insert(schema.workspaces)
    .values({ id: 'ws-1', name: 'ws-1', configPath: '.', createdAt: new Date() });
  const [project] = await db
    .insert(schema.projects)
    .values({ workspaceId: 'ws-1', name: 'Service', slug: 'service' })
    .returning({ id: schema.projects.id });
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  const app = new Hono().onError(onError).route(
    '/',
    createRepoHealthRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      reporterSecret: options.secret,
      requireReporterSecret: options.require ?? false,
      ...options.extra,
    }),
  );
  return { app, db, projectId: (project as { id: string }).id };
}

const upload = (
  app: Hono,
  projectId: string,
  query: string,
  body: string | Uint8Array,
  token: string | null = SECRET,
) =>
  app.request(`/api/v1/projects/${projectId}/health/reports?${query}`, {
    method: 'POST',
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
    body,
  });

const trivy = () => readFileSync(path.join(fixtures, 'trivy.sarif'));

describe('POST /api/v1/projects/:id/health/reports', () => {
  it('refuses no credential with 401 and a wrong one with 403, and accepts the right one', async () => {
    const { app, projectId } = await harness();
    expect((await upload(app, projectId, 'format=sarif', trivy(), null)).status).toBe(401);
    expect((await upload(app, projectId, 'format=sarif', trivy(), 'wrong')).status).toBe(403);
    const accepted = await upload(
      app,
      projectId,
      'format=sarif&branch=main&commit=abc1234',
      trivy(),
    );
    expect(accepted.status).toBe(201);
    const body = HealthUploadResultSchema.parse(await accepted.json());
    expect(body.findings.new).toBe(3);
  });

  it('refuses uploads with 503 when a secret is required and none is configured', async () => {
    const { app, projectId } = await harness({ require: true });
    expect((await upload(app, projectId, 'format=sarif', trivy(), null)).status).toBe(503);
  });

  it('refuses an unknown format, an empty body, a malformed report and an unknown project', async () => {
    const { app, projectId } = await harness();
    expect((await upload(app, projectId, 'format=pdf', trivy())).status).toBe(400);
    expect((await upload(app, projectId, 'format=sarif&commit=not-a-sha', trivy())).status).toBe(
      400,
    );
    expect((await upload(app, projectId, 'format=sarif', '')).status).toBe(400);
    expect((await upload(app, projectId, 'format=sarif', '{"runs":1}')).status).toBe(400);
    expect(
      (await upload(app, '00000000-0000-4000-8000-000000000000', 'format=sarif', trivy())).status,
    ).toBe(404);
  });
});

describe('the health reads', () => {
  it('serve the grade, the findings, the history and the portfolio in their contracts', async () => {
    const { app, projectId } = await harness();
    await upload(app, projectId, 'format=sarif', trivy());

    const health = ProjectHealthSchema.parse(
      await (await app.request(`/api/v1/projects/${projectId}/health`)).json(),
    );
    expect(health.reports.map((report) => report.toolKey)).toEqual(['sarif:trivy']);

    const findings = await app.request(
      `/api/v1/projects/${projectId}/health/findings?severity=critical&limit=10`,
    );
    expect(HealthFindingsPageSchema.parse(await findings.json()).total).toBe(1);
    expect(
      (await app.request(`/api/v1/projects/${projectId}/health/findings?limit=999`)).status,
    ).toBe(400);

    const history = await app.request(`/api/v1/projects/${projectId}/health/history?days=30`);
    expect(HealthHistorySchema.parse(await history.json()).points).toHaveLength(1);
    expect((await app.request(`/api/v1/projects/${projectId}/health/history?days=0`)).status).toBe(
      400,
    );

    const listed = PortfolioSchema.parse(await (await app.request('/api/v1/portfolio')).json());
    expect(listed.projects.map((entry) => entry.projectId)).toEqual([projectId]);
  });

  it('answers 404 for a project that is not registered', async () => {
    const { app } = await harness();
    expect((await app.request('/api/v1/projects/not-a-uuid/health')).status).toBe(404);
  });
});

describe('POST /api/v1/projects/:id/health/scan', () => {
  it('refuses to scan a project with no repository path or git URL', async () => {
    const { app, projectId } = await harness();
    const response = await app.request(`/api/v1/projects/${projectId}/health/scan`, {
      method: 'POST',
    });
    expect(response.status).toBe(400);
  });
});

describe('POST /api/v1/projects/:id/health/findings/:findingId/triage', () => {
  it('records a decision and refuses one without a reason or an acceptance without an expiry', async () => {
    const { app, projectId } = await harness();
    await upload(app, projectId, 'format=sarif', trivy());
    const page = HealthFindingsPageSchema.parse(
      await (await app.request(`/api/v1/projects/${projectId}/health/findings`)).json(),
    );
    const id = page.findings[0]?.id ?? '';
    const triage = (body: unknown) =>
      app.request(`/api/v1/projects/${projectId}/health/findings/${id}/triage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await triage({ state: 'suppressed' })).status).toBe(400);
    expect((await triage({ state: 'accepted', reason: 'vendor' })).status).toBe(400);
    const accepted = await triage({
      state: 'accepted',
      reason: 'vendor',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ state: 'accepted', triageReason: 'vendor' });
  });
});

const json = (
  app: Hono,
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('the pull-request gate', () => {
  it('answers the gate for a branch, and refuses a request with no branch', async () => {
    const { app, projectId } = await harness();
    await upload(app, projectId, 'format=sarif&branch=feature', trivy());
    const gate = await app.request(`/api/v1/projects/${projectId}/health/gate?branch=feature`);
    expect(await gate.json()).toMatchObject({
      branch: 'feature',
      verdict: 'failed',
      newFindings: { critical: 1 },
    });
    expect((await app.request(`/api/v1/projects/${projectId}/health/gate`)).status).toBe(400);
  });

  it('reports to GitHub with the project token, needs the upload credential, and returns the verdict', async () => {
    const requests: ConnectorRequest[] = [];
    const { app, db, projectId } = await harness({
      secret: SECRET,
      extra: {
        detailsUrl: (id) => `https://automate.test/dashboard/repo/${id}`,
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
      },
    });
    await db
      .update(schema.projects)
      .set({ repositoryUrl: 'https://github.com/example/service.git' })
      .where(eq(schema.projects.id, projectId));
    await upload(app, projectId, 'format=sarif&branch=feature', trivy());
    const path = `/api/v1/projects/${projectId}/health/gate/report`;
    const body = { branch: 'feature', commit: 'abc1234', pullRequest: 12 };
    expect((await json(app, 'POST', path, body)).status).toBe(401);
    expect(
      (await json(app, 'POST', path, { branch: 'feature' }, { authorization: `Bearer ${SECRET}` }))
        .status,
    ).toBe(400);
    const response = await json(app, 'POST', path, body, { authorization: `Bearer ${SECRET}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      verdict: 'failed',
      github: { status: true, comment: 'created' },
    });
    expect(requests.map((request) => request.operation)).toEqual([
      'createCommitStatus',
      'listIssueComments',
      'createIssueComment',
    ]);
    expect(requests[0]?.input).toMatchObject({
      owner: 'example',
      repo: 'service',
      sha: 'abc1234',
      target_url: `https://automate.test/dashboard/repo/${projectId}`,
    });
  });

  it('returns the verdict with no GitHub report for a repository that is not on github.com', async () => {
    const { app, projectId } = await harness();
    const response = await json(
      app,
      'POST',
      `/api/v1/projects/${projectId}/health/gate/report`,
      { branch: 'main', commit: 'abc1234' },
      { authorization: `Bearer ${SECRET}` },
    );
    expect(await response.json()).toMatchObject({ verdict: 'passed', github: null });
  });
});

describe('CODEOWNERS, alerts and the schedule', () => {
  it('accepts a CODEOWNERS upload with the upload credential only', async () => {
    const { app, projectId } = await harness();
    const path = `/api/v1/projects/${projectId}/health/codeowners`;
    expect((await app.request(path, { method: 'PUT', body: '* @org/all' })).status).toBe(401);
    const accepted = await app.request(path, {
      method: 'PUT',
      headers: { authorization: `Bearer ${SECRET}` },
      body: '* @org/all',
    });
    expect(await accepted.json()).toEqual({ rules: 1, assigned: 0 });
    expect(
      await (await app.request(`/api/v1/projects/${projectId}/health/settings`)).json(),
    ).toMatchObject({ codeowners: true });
  });

  it('refuses a webhook to a private address, and stores a Slack channel', async () => {
    const { app, projectId } = await harness();
    const path = `/api/v1/projects/${projectId}/health/alerts`;
    expect((await json(app, 'PUT', path, { webhookUrl: 'https://169.254.169.254/x' })).status).toBe(
      400,
    );
    expect((await json(app, 'PUT', path, { slackChannel: 'bad channel!' })).status).toBe(400);
    const stored = await json(app, 'PUT', path, {
      slackChannel: '#quality',
      webhookUrl: 'https://hooks.example.test/a',
    });
    expect(await stored.json()).toEqual({
      alerts: { slackChannel: '#quality', webhookUrl: 'https://hooks.example.test/a' },
    });
  });

  it('refuses an unknown cadence, and a schedule for a project with nowhere to scan', async () => {
    const { app, projectId } = await harness();
    const path = `/api/v1/projects/${projectId}/health/schedule`;
    expect((await json(app, 'PUT', path, { cadence: 'hourly' })).status).toBe(400);
    expect((await json(app, 'PUT', path, { cadence: 'daily' })).status).toBe(400);
    expect(await (await json(app, 'PUT', path, { cadence: null })).json()).toEqual({
      cadence: null,
      scanners: [],
    });
  });
});
