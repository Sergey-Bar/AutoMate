import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import * as schema from '@automate/db';
import { sql } from 'drizzle-orm';
import {
  AgentConfigScanResultSchema,
  AgentRuntimeReportSchema,
  EvalDatasetListSchema,
  EvalDatasetRunStartedSchema,
  EvalDatasetSchema,
  EvalRunDetailSchema,
  McpServerListSchema,
  OtlpExportResponseSchema,
  ProjectEvalsSchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import type { CallerResolver } from '../http/roles.js';
import { uploaderGuard } from '../http/uploader.js';
import type { Caller } from '../services/access-service.js';
import { ingestHealthReport, ingestParsedReport } from '../services/repo-health-service.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticReporterSecret } from '../test-support/synthetic-credentials.js';
import { agentProject, evalRun, otlpExport, stubGateway } from '../test-support/agent-fixtures.js';
import {
  backgroundSchedule,
  createAgentQualityRoutes,
  OTLP_MAX_BYTES,
  type AgentQualityRouteOptions,
} from './agent-quality.js';
import { createRepoHealthRoutes } from './repo-health.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const SECRET = syntheticReporterSecret();
const NOW = new Date('2026-10-26T12:00:00.000Z');

async function harness(
  overrides: Partial<AgentQualityRouteOptions> = {},
  secretOrNull: string | null = SECRET,
) {
  const secret = secretOrNull ?? undefined;
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db);
  const tokens: Record<string, Caller> = {
    amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
    amt_operator: { actor: 'token:operator', role: 'operator', uploaderFor: null },
    amt_uploader: { actor: 'token:uploader', role: 'viewer', uploaderFor: projectId },
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
  const base = { db: db as never, workspaceId: 'ws-1', now: () => NOW };
  const tasks: Array<() => Promise<void>> = [];
  const failures: unknown[] = [];
  const app = new Hono()
    .onError(onError)
    .route(
      '/',
      createAgentQualityRoutes({
        ...base,
        access,
        uploader: uploaderGuard({ access, reporterSecret: secret, requireReporterSecret: true }),
        otlpUploader: uploaderGuard({
          access,
          reporterSecret: secret,
          requireReporterSecret: true,
        }),
        ingest: (input) => ingestHealthReport(base, input),
        ingestParsed: (input, parsed) => ingestParsedReport(base, input, parsed),
        gateway: stubGateway(() => 'Paris'),
        provider: 'ollama',
        schedule: (task) => void tasks.push(task),
        onRunFailure: (error) => void failures.push(error),
        ...overrides,
      }),
    )
    .route(
      '/',
      createRepoHealthRoutes({
        ...base,
        access,
        reporterSecret: secret,
        requireReporterSecret: true,
      }),
    );
  const call = (
    method: string,
    path: string,
    init: {
      token?: string;
      body?: NonNullable<RequestInit['body']>;
      type?: string;
      headers?: Record<string, string>;
    } = {},
  ) =>
    app.request(path, {
      method,
      headers: {
        ...(init.token === undefined ? {} : { authorization: `Bearer ${init.token}` }),
        ...(init.type === undefined ? {} : { 'content-type': init.type }),
        ...init.headers,
      },
      ...(init.body === undefined ? {} : { body: init.body }),
    });
  return { app, db, projectId, call, tasks, failures };
}

const json = (value: unknown) => JSON.stringify(value);
const exportBody = () =>
  json(
    otlpExport([
      {
        spanId: '1'.repeat(16),
        operation: 'chat',
        model: 'gpt-4o',
        inputTokens: 5,
        outputTokens: 1,
        startMs: NOW.getTime() - 60_000,
      },
    ]),
  );

describe('evals', () => {
  it('reads an eval run uploaded through the health door, and its detail', async () => {
    const { call, projectId } = await harness();
    const uploaded = await call(
      'POST',
      `/api/v1/projects/${projectId}/health/reports?format=automate-eval-json&branch=main`,
      {
        token: SECRET,
        body: json(evalRun('support', { a: 9, b: 9 })),
      },
    );
    expect(uploaded.status).toBe(201);
    const response = await call('GET', `/api/v1/projects/${projectId}/evals?branch=main`, {
      token: 'amt_viewer',
    });
    expect(response.status).toBe(200);
    const evals = ProjectEvalsSchema.parse(await response.json());
    expect(evals.suites.map((suite) => suite.suite)).toEqual(['support']);
    const runId = evals.runs[0]?.id ?? '';
    const detail = await call('GET', `/api/v1/projects/${projectId}/evals/runs/${runId}`, {
      token: 'amt_viewer',
    });
    expect(EvalRunDetailSchema.parse(await detail.json()).cases).toHaveLength(2);
    expect((await call('GET', `/api/v1/projects/${projectId}/evals`)).status).toBe(401);
    expect(
      (await call('GET', `/api/v1/projects/${projectId}/evals?branch=`, { token: 'amt_viewer' }))
        .status,
    ).toBe(400);
  });

  it('refuses the built-in agent-config format at the upload door', async () => {
    const { call, projectId } = await harness();
    const response = await call(
      'POST',
      `/api/v1/projects/${projectId}/health/reports?format=automate-agent-config`,
      {
        token: SECRET,
        body: '{}',
      },
    );
    expect(response.status).toBe(400);
  });
});

describe('the OTLP receiver', () => {
  const path = (projectId: string) => `/api/v1/projects/${projectId}/otlp/v1/traces`;

  it('stores a JSON export and answers with partialSuccess, audited with counts only', async () => {
    const { call, projectId, db } = await harness();
    const response = await call('POST', path(projectId), {
      token: SECRET,
      type: 'application/json; charset=utf-8',
      body: exportBody(),
    });
    expect(response.status).toBe(200);
    expect(OtlpExportResponseSchema.parse(await response.json())).toEqual({
      partialSuccess: {
        rejectedSpans: 1,
        errorMessage: '1 span(s) carry no gen_ai attributes and are not stored',
      },
    });
    const [row] = await db.select().from(schema.auditEvents);
    expect(row).toMatchObject({
      action: 'agents.otlp.ingest',
      details: { accepted: 1, rejected: 1 },
    });
  });

  it('reads a gzipped export', async () => {
    const { call, projectId } = await harness();
    const response = await call('POST', path(projectId), {
      token: 'amt_uploader',
      type: 'application/json',
      headers: { 'content-encoding': 'gzip' },
      body: gzipSync(Buffer.from(exportBody())),
    });
    expect(response.status).toBe(200);
    const broken = await call('POST', path(projectId), {
      token: 'amt_uploader',
      type: 'application/json',
      headers: { 'content-encoding': 'gzip' },
      body: 'not gzip',
    });
    expect(broken.status).toBe(400);
  });

  it('refuses a gzip body that inflates past the limit, and a body with no content type', async () => {
    const { call, projectId, db } = await harness();
    // A few kilobytes on the wire, more than the limit once inflated.
    const bomb = gzipSync(Buffer.alloc(OTLP_MAX_BYTES + 1, 0x20));
    expect(bomb.byteLength).toBeLessThan(OTLP_MAX_BYTES / 100);
    const inflated = await call('POST', path(projectId), {
      token: SECRET,
      type: 'application/json',
      headers: { 'content-encoding': 'gzip' },
      body: bomb,
    });
    expect(inflated.status).toBe(413);
    expect(((await inflated.json()) as { error: { code: string } }).error.code).toBe(
      'PAYLOAD_TOO_LARGE',
    );
    const untyped = await call('POST', path(projectId), { token: SECRET, body: exportBody() });
    expect(untyped.status).toBe(415);
    // `identity` is no encoding at all, and is read as it is.
    const identity = await call('POST', path(projectId), {
      token: SECRET,
      type: 'application/json',
      headers: { 'content-encoding': 'identity' },
      body: exportBody(),
    });
    expect(identity.status).toBe(200);
    expect(await db.select().from(schema.genaiSpans)).toHaveLength(1);
  });

  it('refuses protobuf with a coded 415 naming JSON, and an unknown encoding', async () => {
    const { call, projectId } = await harness();
    const protobuf = await call('POST', path(projectId), {
      token: SECRET,
      type: 'application/x-protobuf',
      body: 'x',
    });
    expect(protobuf.status).toBe(415);
    const body = (await protobuf.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(body.error.message).toContain('application/json');
    const brotli = await call('POST', path(projectId), {
      token: SECRET,
      type: 'application/json',
      headers: { 'content-encoding': 'br' },
      body: exportBody(),
    });
    expect(brotli.status).toBe(415);
  });

  it('is never open: no credential, a viewer, and an install without a reporter secret are all refused', async () => {
    const { call, projectId } = await harness();
    expect(
      (await call('POST', path(projectId), { type: 'application/json', body: exportBody() }))
        .status,
    ).toBe(401);
    expect(
      (
        await call('POST', path(projectId), {
          token: 'amt_viewer',
          type: 'application/json',
          body: exportBody(),
        })
      ).status,
    ).toBe(403);
    const unconfigured = await harness({}, null);
    const refused = await unconfigured.call('POST', path(unconfigured.projectId), {
      type: 'application/json',
      body: exportBody(),
    });
    expect(refused.status).toBe(503);
  });
});

describe('runtime and the MCP inventory', () => {
  it('serves the project runtime and the installation chat runtime to a viewer', async () => {
    const { call, projectId } = await harness();
    await call('POST', `/api/v1/projects/${projectId}/otlp/v1/traces`, {
      token: SECRET,
      type: 'application/json',
      body: exportBody(),
    });
    const project = await call('GET', `/api/v1/projects/${projectId}/agents/runtime?days=7`, {
      token: 'amt_viewer',
    });
    expect(AgentRuntimeReportSchema.parse(await project.json()).runtime.overall.current.runs).toBe(
      1,
    );
    const self = await call('GET', '/api/v1/chat/runtime', { token: 'amt_viewer' });
    expect(AgentRuntimeReportSchema.parse(await self.json()).projectId).toBeNull();
    expect(
      (
        await call('GET', `/api/v1/projects/${projectId}/agents/runtime?days=0`, {
          token: 'amt_viewer',
        })
      ).status,
    ).toBe(400);
    expect(
      (await call('GET', '/api/v1/chat/runtime?days=500', { token: 'amt_viewer' })).status,
    ).toBe(400);
  });

  it('takes agent-config files from CI and lists the inventory', async () => {
    const { call, projectId, db } = await harness();
    const sent = await call('POST', `/api/v1/projects/${projectId}/health/agent-config`, {
      token: SECRET,
      type: 'application/json',
      body: json({
        branch: 'main',
        files: [
          {
            path: '.mcp.json',
            text: json({ mcpServers: { db: { url: 'http://db.example/mcp' } } }),
          },
        ],
      }),
    });
    expect(sent.status).toBe(201);
    expect(AgentConfigScanResultSchema.parse(await sent.json()).mcpServers).toBe(1);
    const listed = await call('GET', `/api/v1/projects/${projectId}/agents/mcp-servers`, {
      token: 'amt_viewer',
    });
    expect(McpServerListSchema.parse(await listed.json()).servers[0]?.transport).toBe('http');
    expect(
      (
        await call('POST', `/api/v1/projects/${projectId}/health/agent-config`, {
          token: SECRET,
          body: '{',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call('GET', `/api/v1/projects/${projectId}/agents/mcp-servers?branch=`, {
          token: 'amt_viewer',
        })
      ).status,
    ).toBe(400);
    const audit = await db.select().from(schema.auditEvents);
    expect(audit.map((row) => row.action)).toContain('health.agent-config.upload');
  });
});

describe('the built-in eval runner', () => {
  const dataset = {
    name: 'capitals',
    model: 'model-a',
    repeats: 2,
    cases: [
      { id: 'france', input: 'Capital of France?', checks: [{ type: 'contains', value: 'paris' }] },
    ],
  };

  it('lets an operator save and run a dataset, in the background, audited', async () => {
    const { call, projectId, tasks, db } = await harness();
    const datasets = `/api/v1/projects/${projectId}/evals/datasets`;
    expect(
      (
        await call('POST', datasets, {
          token: 'amt_viewer',
          type: 'application/json',
          body: json(dataset),
        })
      ).status,
    ).toBe(403);
    const created = await call('POST', datasets, {
      token: 'amt_operator',
      type: 'application/json',
      body: json(dataset),
    });
    expect(created.status).toBe(201);
    const saved = EvalDatasetSchema.parse(await created.json());
    expect(
      (
        await call('POST', datasets, {
          token: 'amt_operator',
          type: 'application/json',
          body: json(dataset),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await call('POST', datasets, {
          token: 'amt_operator',
          type: 'application/json',
          body: '{}',
        })
      ).status,
    ).toBe(400);
    const listed = await call('GET', datasets, { token: 'amt_viewer' });
    expect(EvalDatasetListSchema.parse(await listed.json()).datasets).toHaveLength(1);

    const run = await call('POST', `/api/v1/projects/${projectId}/evals/datasets/${saved.id}/run`, {
      token: 'amt_operator',
      type: 'application/json',
      body: json({ branch: 'main' }),
    });
    expect(run.status).toBe(202);
    expect(EvalDatasetRunStartedSchema.parse(await run.json())).toMatchObject({
      attempts: 2,
      status: 'started',
    });
    expect(await db.select().from(schema.evalRuns)).toEqual([]);
    await Promise.all(tasks.map((task) => task()));
    const [stored] = await db.select().from(schema.evalRuns);
    expect(stored).toMatchObject({ suite: 'capitals', source: 'runner' });
    const actions = (await db.select().from(schema.auditEvents)).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'evals.dataset.create',
        'evals.dataset.replace',
        'evals.dataset.run.start',
        'evals.dataset.run.complete',
      ]),
    );
    expect(
      (
        await call('POST', `/api/v1/projects/${projectId}/evals/datasets/${saved.id}/run`, {
          token: 'amt_viewer',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call('POST', `${datasets}/${saved.id}/run`, {
          token: 'amt_operator',
          type: 'application/json',
          body: json({ commit: 'zz' }),
        })
      ).status,
    ).toBe(400);
  });

  it('answers NOT_CONFIGURED with no model provider, and audits a run that failed', async () => {
    const unconfigured = await harness({ gateway: null });
    const datasets = `/api/v1/projects/${unconfigured.projectId}/evals/datasets`;
    const created = EvalDatasetSchema.parse(
      await (
        await unconfigured.call('POST', datasets, {
          token: 'amt_operator',
          type: 'application/json',
          body: json(dataset),
        })
      ).json(),
    );
    const refused = await unconfigured.call('POST', `${datasets}/${created.id}/run`, {
      token: 'amt_operator',
    });
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
      'NOT_CONFIGURED',
    );

    const failing = await harness({ ingest: () => Promise.reject(new Error('disk full')) });
    const failingDatasets = `/api/v1/projects/${failing.projectId}/evals/datasets`;
    const saved = EvalDatasetSchema.parse(
      await (
        await failing.call('POST', failingDatasets, {
          token: 'amt_operator',
          type: 'application/json',
          body: json(dataset),
        })
      ).json(),
    );
    expect(
      (await failing.call('POST', `${failingDatasets}/${saved.id}/run`, { token: 'amt_operator' }))
        .status,
    ).toBe(202);
    await Promise.all(failing.tasks.map((task) => task()));
    expect(failing.failures).toHaveLength(1);
    const audit = await failing.db.select().from(schema.auditEvents);
    expect(audit.find((row) => row.action === 'evals.dataset.run.failed')?.details).toMatchObject({
      code: 'INTERNAL',
    });
  });

  it('finishes a background run whose audit table is gone: audit never throws, and it reports once', async () => {
    const failing = await harness({ ingest: () => Promise.reject(new Error('disk full')) });
    const datasets = `/api/v1/projects/${failing.projectId}/evals/datasets`;
    const saved = EvalDatasetSchema.parse(
      await (
        await failing.call('POST', datasets, {
          token: 'amt_operator',
          type: 'application/json',
          body: json(dataset),
        })
      ).json(),
    );
    expect(
      (await failing.call('POST', `${datasets}/${saved.id}/run`, { token: 'amt_operator' })).status,
    ).toBe(202);
    // The database refuses audit rows between the start and the end of the run.
    await failing.db.execute(sql`ALTER TABLE audit_events RENAME TO audit_events_gone`);
    for (const task of failing.tasks) await expect(task()).resolves.toBeUndefined();
    expect(failing.failures.map((error) => String(error))).toEqual(['Error: disk full']);
  });

  it('routes a rejected background task to its failure hook, never to an unhandled rejection', async () => {
    const seen: unknown[] = [];
    const boom = new Error('boom');
    backgroundSchedule((error) => void seen.push(error))(() => Promise.reject(boom));
    // A hook that itself throws is logged, not left to reject.
    backgroundSchedule(() => {
      throw new Error('the hook failed too');
    })(() => Promise.reject(boom));
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual([boom]);
  });

  it('claims the dataset when the run is prepared, so two near-simultaneous runs cannot both start', async () => {
    const { call, projectId, tasks } = await harness();
    const datasets = `/api/v1/projects/${projectId}/evals/datasets`;
    const saved = EvalDatasetSchema.parse(
      await (
        await call('POST', datasets, {
          token: 'amt_operator',
          type: 'application/json',
          body: json(dataset),
        })
      ).json(),
    );
    const [first, second] = await Promise.all([
      call('POST', `${datasets}/${saved.id}/run`, { token: 'amt_operator' }),
      call('POST', `${datasets}/${saved.id}/run`, { token: 'amt_operator' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([202, 409]);
    await Promise.all(tasks.map((task) => task()));
    expect(
      (await call('POST', `${datasets}/${saved.id}/run`, { token: 'amt_operator' })).status,
    ).toBe(202);
    await Promise.all(tasks.slice(1).map((task) => task()));
  });
});
