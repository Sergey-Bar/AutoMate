import { afterEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import { createTriageLabelRoutes } from '../routes/triage-labels.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import {
  deleteTriageLabel,
  labelClusters,
  listTriageLabels,
  setTriageLabel,
} from './triage-label-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup() {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options = { db: db as never, workspaceId: 'ws-1' };
  return { options, other: { ...options, workspaceId: 'ws-2' } };
}

const SIGNATURE = 'timeouterror: timeout <n>ms exceeded @ pay < checkout';

describe('triage labels', () => {
  it('labels a signature once, replaces the label on a second write, and deletes it', async () => {
    const { options } = await setup();
    await setTriageLabel(options, { signature: SIGNATURE, category: 'environment' }, 'user:ana');
    const replaced = await setTriageLabel(
      options,
      { signature: SIGNATURE, category: 'known-issue', issueUrl: 'https://tracker.example/T-1' },
      'user:ana',
    );
    expect(replaced).toMatchObject({
      signature: SIGNATURE,
      category: 'known-issue',
      issueUrl: 'https://tracker.example/T-1',
      labelledBy: 'user:ana',
    });
    expect(await listTriageLabels(options)).toHaveLength(1);
    expect(await deleteTriageLabel(options, SIGNATURE)).toBe(true);
    expect(await deleteTriageLabel(options, SIGNATURE)).toBe(false);
    expect(await listTriageLabels(options)).toEqual([]);
  });

  it("never reads, replaces or deletes another workspace's label", async () => {
    const { options, other } = await setup();
    await setTriageLabel(options, { signature: SIGNATURE, category: 'product' }, 'user:ana');
    expect(await listTriageLabels(other)).toEqual([]);
    await setTriageLabel(other, { signature: SIGNATURE, category: 'test' }, 'user:bo');
    expect(await deleteTriageLabel(other, SIGNATURE)).toBe(true);
    const [mine] = await listTriageLabels(options);
    expect(mine?.category).toBe('product');
  });

  it('labels the clusters a signature matches and counts the failures nobody labelled', async () => {
    const { options } = await setup();
    await setTriageLabel(options, { signature: SIGNATURE, category: 'environment' }, 'user:ana');
    const labelled = labelClusters(
      {
        clusters: [
          { signature: SIGNATURE, count: 3 },
          { signature: 'assertionerror: expected <n> to be <n>', count: 2 },
        ],
        totals: { failures: 5, causes: 2 },
      },
      await listTriageLabels(options),
    );
    expect(labelled.clusters.map((cluster) => cluster.label)).toEqual([
      { category: 'environment', issueUrl: null },
      null,
    ]);
    expect(labelled.totals.unlabelled).toBe(2);
  });
});

describe('the triage label routes', () => {
  it('reads as a viewer, writes and deletes as an operator, and audits both', async () => {
    const { db, close } = await migratedDatabase();
    closers.push(close);
    const seen: string[] = [];
    const tag = (name: string) => async (_c: unknown, next: () => Promise<void>) => {
      seen.push(name);
      await next();
    };
    const app = withErrorBoundary(
      new Hono().route(
        '/',
        createTriageLabelRoutes({
          db: db as never,
          workspaceId: 'ws-1',
          viewer: tag('viewer'),
          operator: tag('operator'),
          actorOf: async () => 'user:ana',
        }),
      ),
    );
    const put = await app.request('/api/v1/triage-labels', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature: SIGNATURE, category: 'environment' }),
    });
    expect(put.status).toBe(200);
    const listed = (await (await app.request('/api/v1/triage-labels')).json()) as {
      labels: unknown[];
    };
    expect(listed.labels).toHaveLength(1);
    const bad = await app.request('/api/v1/triage-labels', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ signature: SIGNATURE, category: 'cosmic-rays' }),
    });
    expect(bad.status).toBe(400);
    const removed = await app.request(
      `/api/v1/triage-labels?signature=${encodeURIComponent(SIGNATURE)}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(200);
    const again = await app.request(
      `/api/v1/triage-labels?signature=${encodeURIComponent(SIGNATURE)}`,
      { method: 'DELETE' },
    );
    expect(again.status).toBe(404);
    expect(seen).toEqual(['operator', 'viewer', 'operator', 'operator', 'operator']);
    const audits = await db
      .select({ action: schema.auditEvents.action })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.actorId, 'user:ana'));
    expect(audits.map((row) => row.action).sort()).toEqual([
      'triage-label.removed',
      'triage-label.set',
    ]);
  });
});
