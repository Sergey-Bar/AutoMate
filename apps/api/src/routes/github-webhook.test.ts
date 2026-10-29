import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import * as schema from '@automate/db';
import { GitHubWebhookAckSchema } from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  WEBHOOK_MAX_BYTES,
  WEBHOOK_RETENTION_DAYS,
  recordWebhookDelivery,
  verifyGitHubSignature,
} from '../services/github-webhook.js';
import { createGitHubWebhookRoutes } from './github-webhook.js';

/**
 * `POST /api/v1/webhooks/github`. The signature is the credential, so most of this file is
 * about what happens without a good one: nothing is parsed, nothing is written, nothing is
 * queued. The secret here is assembled at run time, never a literal.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const SECRET = ['synthetic', 'github', 'webhook', 'key', 'for', 'tests', 'only'].join('-');
const URL_PATH = '/api/v1/webhooks/github';
const NOW = new Date('2026-10-23T12:00:00.000Z');

async function harness(
  options: { lanMode?: boolean; secret?: string | undefined; workspaceId?: string } = {},
) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: 'ws-1',
      name: 'Service',
      slug: 'service',
      repositoryUrl: 'git@github.com:Octo/Service.git',
    })
    .returning({ id: schema.projects.id });
  const projectId = (project as { id: string }).id;
  await db.insert(schema.deliverySources).values({ workspaceId: 'ws-1', projectId, enabled: true });
  const { onError } = createErrorBoundary({
    log: () => undefined,
    reportError: () => undefined,
    requestId: () => 'NO_REQUEST',
  });
  const syncNow = vi.fn(async () => []);
  let client = '192.168.1.20';
  const app = new Hono().onError(onError).route(
    '/',
    createGitHubWebhookRoutes({
      db: db as never,
      workspaceId: options.workspaceId ?? 'ws-1',
      now: () => NOW,
      lanMode: options.lanMode ?? true,
      secret: 'secret' in options ? options.secret : SECRET,
      clientKey: () => client,
      syncNow,
    }),
  );
  return {
    app,
    db,
    projectId,
    syncNow,
    from: (address: string) => {
      client = address;
    },
  };
}

const sign = (body: string, key = SECRET) =>
  `sha256=${createHmac('sha256', key).update(body).digest('hex')}`;

let deliveries = 0;
function deliver(
  app: Hono,
  event: string,
  payload: unknown,
  headers: { signature?: string | null; delivery?: string } = {},
) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  deliveries += 1;
  return app.request(URL_PATH, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-github-event': event,
      'x-github-delivery': headers.delivery ?? `delivery-${String(deliveries)}`,
      ...(headers.signature === null
        ? {}
        : { 'x-hub-signature-256': headers.signature ?? sign(body) }),
    },
    body,
  });
}

const PUSH = { ref: 'refs/heads/main', repository: { full_name: 'octo/service' } };
const syncs = (db: MigratedDb) => db.select().from(schema.deliverySyncs);

describe('the receiver is off unless both LAN mode and a secret are configured', () => {
  it('answers a coded 404 without LAN mode, and without a secret', async () => {
    for (const options of [{ lanMode: false }, { secret: undefined }, { secret: '' }]) {
      const { app, db } = await harness(options);
      const response = await deliver(app, 'push', PUSH);
      expect(response.status, JSON.stringify(options)).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'WEBHOOK_NOT_CONFIGURED' } });
      expect(await syncs(db)).toEqual([]);
    }
  });
});

describe('the signature is the credential', () => {
  it('refuses a request with no signature, a wrong one, and one over other bytes', async () => {
    const { app, db } = await harness();
    const body = JSON.stringify(PUSH);
    for (const signature of [
      null,
      'sha256=nothex',
      'sha1=' + 'a'.repeat(40),
      sign(body, 'another-key-of-the-same-sort-entirely'),
      sign(`${body} `),
    ]) {
      const response = await deliver(app, 'push', body, { signature });
      expect(response.status, String(signature)).toBe(401);
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_WEBHOOK_SIGNATURE' } });
    }
    // Nothing was recorded or queued for any of them.
    expect(await db.select().from(schema.webhookDeliveries)).toEqual([]);
    expect(await syncs(db)).toEqual([]);
  });

  it('checks the signature over the raw bytes, before parsing anything', async () => {
    const { app } = await harness();
    // Not JSON at all: with a bad signature, the answer is about the signature.
    expect((await deliver(app, 'push', '{not json', { signature: sign('other') })).status).toBe(
      401,
    );
    // With a good one, the payload is then read, and refused for not being JSON.
    const response = await deliver(app, 'push', '{not json');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_JSON' } });
  });

  it('compares lengths before bytes, and accepts upper-case hex', () => {
    const body = new TextEncoder().encode('{}');
    const good = sign('{}');
    expect(verifyGitHubSignature(SECRET, body, good)).toBe(true);
    expect(
      verifyGitHubSignature(SECRET, body, good.toUpperCase().replace('SHA256', 'sha256')),
    ).toBe(true);
    expect(verifyGitHubSignature(SECRET, body, `${good}00`)).toBe(false);
    expect(verifyGitHubSignature(SECRET, body, undefined)).toBe(false);
  });
});

describe('a verified delivery', () => {
  it('queues one sync for the matching project, case-insensitively, and audits it', async () => {
    const { app, db, projectId, syncNow } = await harness();
    const response = await deliver(app, 'push', PUSH);
    expect(response.status).toBe(202);
    expect(GitHubWebhookAckSchema.parse(await response.json())).toEqual({
      status: 'queued',
      event: 'push',
      reason: null,
      queued: 1,
    });
    const queued = await syncs(db);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ projectId, requestedBy: 'webhook', status: 'queued' });
    expect(syncNow).toHaveBeenCalledTimes(1);
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.map((row) => [row.action, row.actorId])).toEqual([
      ['delivery.webhook.receive', 'github-webhook'],
    ]);
    // A second event joins the sync that is still waiting rather than queueing another.
    expect((await deliver(app, 'pull_request', { ...PUSH, action: 'opened' })).status).toBe(202);
    expect(await syncs(db)).toHaveLength(1);
  });

  it('handles each delivery event, and ignores the rest with a 202', async () => {
    const { app, db } = await harness();
    for (const event of [
      'pull_request',
      'pull_request_review',
      'deployment_status',
      'release',
      'workflow_run',
    ]) {
      // Each delivery GitHub sends is a different body; an identical one is a replay.
      expect((await deliver(app, event, { ...PUSH, event })).status, event).toBe(202);
    }
    for (const event of ['ping', 'star', 'issues']) {
      const response = await deliver(app, event, `not even json: ${event}`);
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ status: 'ignored', reason: 'event' });
    }
    expect(await syncs(db)).toHaveLength(1);
  });

  it('ignores a repository no project here names, and a payload with no repository', async () => {
    const { app, db } = await harness();
    const unknown = await deliver(app, 'push', { repository: { full_name: 'someone/else' } });
    expect(await unknown.json()).toMatchObject({
      status: 'ignored',
      reason: 'unknown-repository',
      queued: 0,
    });
    const bare = await deliver(app, 'push', { zen: 'Keep it logically awesome.' });
    expect(await bare.json()).toMatchObject({ status: 'ignored', reason: 'no-repository' });
    const traversal = await deliver(app, 'push', { repository: { full_name: '../../etc' } });
    expect(await traversal.json()).toMatchObject({ reason: 'no-repository' });
    expect(await syncs(db)).toEqual([]);
  });

  it('queues a sync in the workspace that registered the repository, whichever one received it (PRO-20)', async () => {
    // A delivery carries no workspace credential, so the default workspace's composition
    // receives every one. A repository registered in another workspace was answered
    // `unknown-repository` and synced only on the schedule.
    const { app, db } = await harness({ workspaceId: 'ws-2' });
    const response = await deliver(app, 'push', PUSH);
    expect(await response.json()).toMatchObject({ status: 'queued', queued: 1 });
    expect((await db.select().from(schema.deliverySyncs)).map((row) => row.workspaceId)).toEqual([
      'ws-1',
    ]);
    // The replay record is the receiver's: one delivery, kept once.
    const recorded = await db.select().from(schema.webhookDeliveries);
    expect(recorded.map((row) => row.workspaceId)).toEqual(['ws-2']);
  });

  it('ignores a disabled source', async () => {
    const { app, db } = await harness();
    await db.update(schema.deliverySources).set({ enabled: false });
    expect(await (await deliver(app, 'push', PUSH)).json()).toMatchObject({
      reason: 'unknown-repository',
    });
  });
});

describe('replay', () => {
  it('refuses a delivery id it has already accepted', async () => {
    const { app, db } = await harness();
    expect((await deliver(app, 'push', PUSH, { delivery: 'abc-123' })).status).toBe(202);
    const again = await deliver(app, 'push', PUSH, { delivery: 'abc-123' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: 'WEBHOOK_REPLAYED' } });
    expect(await syncs(db)).toHaveLength(1);
  });

  it('refuses a captured body re-sent under a fresh delivery id: the id is not signed, the body is', async () => {
    const { app, db } = await harness();
    expect((await deliver(app, 'push', PUSH, { delivery: 'first-id' })).status).toBe(202);
    await db.delete(schema.deliverySyncs);
    const replayed = await deliver(app, 'push', PUSH, { delivery: 'a-new-id' });
    expect(replayed.status).toBe(409);
    expect(await replayed.json()).toMatchObject({ error: { code: 'WEBHOOK_REPLAYED' } });
    expect(await syncs(db)).toEqual([]);
  });

  it('forgets a delivery it failed to handle, so GitHub\u2019s retry of it is accepted', async () => {
    const { app, db } = await harness();
    await db.execute(sql`ALTER TABLE delivery_syncs RENAME TO delivery_syncs_gone`);
    const failed = await deliver(app, 'push', PUSH, { delivery: 'retried-id' });
    expect(failed.status).toBe(500);
    expect(await db.select().from(schema.webhookDeliveries)).toEqual([]);
    await db.execute(sql`ALTER TABLE delivery_syncs_gone RENAME TO delivery_syncs`);
    const retried = await deliver(app, 'push', PUSH, { delivery: 'retried-id' });
    expect(retried.status).toBe(202);
    expect(await syncs(db)).toHaveLength(1);
  });

  it('refuses a delivery with no id or no event name', async () => {
    const { app } = await harness();
    const body = JSON.stringify(PUSH);
    const response = await app.request(URL_PATH, {
      method: 'POST',
      headers: { 'x-hub-signature-256': sign(body), 'x-github-event': 'push' },
      body,
    });
    expect(response.status).toBe(400);
    expect((await deliver(app, 'Push Event!', PUSH)).status).toBe(400);
  });

  it(`keeps delivery ids for ${String(WEBHOOK_RETENTION_DAYS)} days, then forgets them`, async () => {
    const { db } = await harness();
    const options = { db: db as never, workspaceId: 'ws-1' };
    const old = new Date(NOW.getTime() - (WEBHOOK_RETENTION_DAYS + 1) * 86_400_000);
    const body = (text: string) => new TextEncoder().encode(text);
    const record = (now: Date, deliveryId: string, text = deliveryId) =>
      recordWebhookDelivery({ ...options, now: () => now }, deliveryId, 'push', body(text));
    expect(await record(old, 'old')).not.toBeNull();
    expect(await record(NOW, 'new')).not.toBeNull();
    const kept = await db.select().from(schema.webhookDeliveries);
    expect(kept.map((row) => row.deliveryId)).toEqual(['new']);
    // A repeat of either the id or the body is a replay.
    expect(await record(NOW, 'new', 'another body')).toBeNull();
    expect(await record(NOW, 'other-id', 'new')).toBeNull();
  });
});

describe('limits', () => {
  it('refuses a payload over 1 MB before reading it', async () => {
    const { app } = await harness();
    const body = JSON.stringify({ ...PUSH, padding: 'x'.repeat(WEBHOOK_MAX_BYTES) });
    expect((await deliver(app, 'push', body)).status).toBe(413);
  });

  it('rate-limits one client, and not the next', async () => {
    const { app, from } = await harness();
    let limited: Response | undefined;
    for (let attempt = 0; attempt < 125 && limited === undefined; attempt += 1) {
      const response = await deliver(app, 'ping', '{}', { signature: 'sha256=00' });
      if (response.status === 429) limited = response;
    }
    expect(limited?.headers.get('retry-after')).toMatch(/^\d+$/u);
    expect(await limited?.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    from('192.168.1.21');
    expect((await deliver(app, 'ping', '{}')).status).toBe(202);
  });
});
