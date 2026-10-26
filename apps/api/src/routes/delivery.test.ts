import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import * as schema from '@automate/db';
import {
  DeliveryReportSchema,
  DeliverySourceSchema,
  DeliverySyncQueuedSchema,
  PortfolioDeliverySchema,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { uploaderGuard } from '../http/uploader.js';
import type { CallerResolver } from '../http/roles.js';
import type { Caller } from '../services/access-service.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { syntheticReporterSecret } from '../test-support/synthetic-credentials.js';
import { DELIVERY_PUSH_MAX_BYTES, createDeliveryRoutes } from './delivery.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const SECRET = syntheticReporterSecret();
const NOW = new Date('2026-10-23T12:00:00.000Z');

/** Tokens by role; `uploader` is pinned to the project the harness creates. */
async function harness(options: { reporterSecret?: string; require?: boolean } = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: 'ws-1',
      name: 'Service',
      slug: 'service',
      repositoryUrl: 'https://github.com/octo/service',
    })
    .returning({ id: schema.projects.id });
  const projectId = (project as { id: string }).id;
  const tokens: Record<string, Caller> = {
    amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
    amt_operator: { actor: 'token:operator', role: 'operator', uploaderFor: null },
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
  const syncNow = vi.fn(async () => []);
  const app = new Hono().onError(onError).route(
    '/',
    createDeliveryRoutes({
      db: db as never,
      workspaceId: 'ws-1',
      now: () => NOW,
      access,
      uploader: uploaderGuard({
        access,
        reporterSecret: options.reporterSecret ?? SECRET,
        requireReporterSecret: options.require ?? true,
      }),
      syncNow,
    }),
  );
  return { app, db, projectId, syncNow };
}

const send = (app: Hono, method: string, url: string, token: string | undefined, body?: unknown) =>
  app.request(url, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

const deployment = {
  externalId: 'ci-41',
  environment: 'production',
  status: 'success',
  createdAt: '2026-10-23T10:00:00Z',
  sha: 'abc1234',
};

describe('the delivery source routes', () => {
  it('lets a viewer read the source and only an operator change it, audited', async () => {
    const { app, db, projectId } = await harness();
    const url = `/api/v1/projects/${projectId}/delivery/source`;
    expect((await send(app, 'GET', url, undefined)).status).toBe(401);
    const read = await send(app, 'GET', url, 'amt_viewer');
    expect(read.status).toBe(200);
    expect(DeliverySourceSchema.parse(await read.json()).configured).toBe(false);
    const body = { enabled: true, cadence: 'hourly', productionEnvironments: ['production'] };
    expect((await send(app, 'PUT', url, 'amt_viewer', body)).status).toBe(403);
    const saved = await send(app, 'PUT', url, 'amt_operator', body);
    expect(saved.status).toBe(200);
    expect(DeliverySourceSchema.parse(await saved.json())).toMatchObject({
      enabled: true,
      cadence: 'hourly',
    });
    expect((await send(app, 'PUT', url, 'amt_operator', { enabled: 'yes' })).status).toBe(400);
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.map((row) => [row.action, row.actorId])).toContainEqual([
      'delivery.source.set',
      'token:operator',
    ]);
  });

  it('queues a sync for an operator, answers 202, and starts the syncer', async () => {
    const { app, db, projectId, syncNow } = await harness();
    const url = `/api/v1/projects/${projectId}/delivery/sync`;
    expect((await send(app, 'POST', url, 'amt_viewer')).status).toBe(403);
    const queued = await send(app, 'POST', url, 'amt_operator');
    expect(queued.status).toBe(202);
    expect(DeliverySyncQueuedSchema.parse(await queued.json()).duplicate).toBe(false);
    expect(syncNow).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.auditEvents)).map((row) => row.action)).toContain(
      'delivery.sync.request',
    );
  });
});

describe('the push door', () => {
  it('takes the reporter secret, an uploader token for this project, or an operator', async () => {
    const { app, db, projectId } = await harness();
    const url = `/api/v1/projects/${projectId}/delivery/deployments`;
    expect((await send(app, 'POST', url, undefined, deployment)).status).toBe(401);
    expect((await send(app, 'POST', url, 'wrong-secret', deployment)).status).toBe(403);
    expect((await send(app, 'POST', url, 'amt_viewer', deployment)).status).toBe(403);
    const first = await send(app, 'POST', url, SECRET, deployment);
    expect(first.status).toBe(201);
    // The same external id again replaces the row: 200, not a second deployment.
    expect((await send(app, 'POST', url, 'amt_uploader', deployment)).status).toBe(200);
    expect((await send(app, 'POST', url, 'amt_operator', deployment)).status).toBe(200);
    expect(await db.select().from(schema.deployments)).toHaveLength(1);
    const audits = await db.select().from(schema.auditEvents);
    expect(
      audits.filter((row) => row.action === 'delivery.deployment.push').map((row) => row.actorId),
    ).toEqual(['reporter', 'token:uploader', 'token:operator']);
  });

  it('refuses an uploader token pinned to another project', async () => {
    const { app, db } = await harness();
    const [other] = await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-1', name: 'Other', slug: 'other' })
      .returning({ id: schema.projects.id });
    const url = `/api/v1/projects/${(other as { id: string }).id}/delivery/deployments`;
    expect((await send(app, 'POST', url, 'amt_uploader', deployment)).status).toBe(403);
  });

  it('refuses a body it cannot read, and one over the push limit', async () => {
    const { app, projectId } = await harness();
    const url = `/api/v1/projects/${projectId}/delivery/deployments`;
    expect((await send(app, 'POST', url, SECRET, { ...deployment, status: 'maybe' })).status).toBe(
      400,
    );
    expect((await send(app, 'POST', url, SECRET, 'not json')).status).toBe(400);
    const huge = { ...deployment, url: `https://x.test/${'a'.repeat(DELIVERY_PUSH_MAX_BYTES)}` };
    expect((await send(app, 'POST', url, SECRET, huge)).status).toBe(413);
  });

  it('records an incident, and replaces it when it is resolved', async () => {
    const { app, db, projectId } = await harness();
    const url = `/api/v1/projects/${projectId}/delivery/incidents`;
    const incident = {
      externalId: 'INC-7',
      source: 'pagerduty',
      openedAt: '2026-10-23T10:30:00Z',
      deploymentId: 'ci-41',
      title: 'Checkout errors',
    };
    expect((await send(app, 'POST', url, SECRET, incident)).status).toBe(201);
    const resolved = await send(app, 'POST', url, SECRET, {
      ...incident,
      resolvedAt: '2026-10-23T11:00:00Z',
    });
    expect(resolved.status).toBe(200);
    expect(
      (await send(app, 'POST', url, SECRET, { ...incident, resolvedAt: '2026-10-23T09:00:00Z' }))
        .status,
    ).toBe(400);
    expect(await db.select().from(schema.incidents)).toHaveLength(1);
    expect((await db.select().from(schema.auditEvents)).map((row) => row.action)).toContain(
      'delivery.incident.push',
    );
  });

  it('is unavailable when no reporter secret is configured and one is required', async () => {
    const { app, projectId } = await harness({ reporterSecret: '', require: true });
    const response = await send(
      app,
      'POST',
      `/api/v1/projects/${projectId}/delivery/deployments`,
      undefined,
      deployment,
    );
    expect(response.status).toBe(503);
  });

  it('admits an upload openly when no secret is configured and none is required', async () => {
    const { app, projectId } = await harness({ reporterSecret: '', require: false });
    const response = await send(
      app,
      'POST',
      `/api/v1/projects/${projectId}/delivery/deployments`,
      undefined,
      deployment,
    );
    expect(response.status).toBe(201);
  });
});

describe('the delivery reads', () => {
  it('serves the project report and the portfolio to a viewer, with a bounded window', async () => {
    const { app, projectId } = await harness();
    await send(
      app,
      'POST',
      `/api/v1/projects/${projectId}/delivery/deployments`,
      SECRET,
      deployment,
    );
    const report = await send(
      app,
      'GET',
      `/api/v1/projects/${projectId}/delivery?days=30`,
      'amt_viewer',
    );
    expect(report.status).toBe(200);
    const parsed = DeliveryReportSchema.parse(await report.json());
    expect(parsed).toMatchObject({ windowDays: 30, counts: { deployments: 1 } });
    // One deployment is not evidence of anything.
    expect(parsed.dora.status).toBe('insufficient');
    expect(
      (await send(app, 'GET', `/api/v1/projects/${projectId}/delivery?days=0`, 'amt_viewer'))
        .status,
    ).toBe(400);
    expect(
      (await send(app, 'GET', `/api/v1/projects/${projectId}/delivery`, undefined)).status,
    ).toBe(401);
    const portfolio = await send(app, 'GET', '/api/v1/portfolio/delivery?days=7', 'amt_viewer');
    expect(PortfolioDeliverySchema.parse(await portfolio.json()).projects).toHaveLength(1);
    expect(
      (await send(app, 'GET', '/api/v1/portfolio/delivery?days=400', 'amt_viewer')).status,
    ).toBe(400);
  });
});
