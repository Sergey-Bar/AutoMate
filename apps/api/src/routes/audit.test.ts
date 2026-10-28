import type { QueryOptions, Results } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@automate/db';
import type { CallerResolver } from '../http/roles.js';
import { audit, type Caller } from '../services/access-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import { createAuditRoutes } from './audit.js';

/**
 * The audit trail an auditor reads (ADR-014, enterprise): a page of it, all of it as an
 * export with the chain's head, and a verdict on whether the chain is intact. Admin only, and
 * a workspace sees its own trail and no other's.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const CALLERS: Record<string, Caller> = {
  amt_admin: { actor: 'token:admin', role: 'admin', uploaderFor: null },
  amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
};

async function harness(workspaceId = 'ws-1') {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const access: CallerResolver = {
    mode: 'enforced',
    authenticateToken: async (token) => CALLERS[token] ?? null,
    hasSession: async () => false,
  };
  const options = { db: db as never, workspaceId };
  for (const action of ['token.create', 'policy.set', 'token.revoke']) {
    await audit(options, { actor: 'token:admin', action, resourceType: 't', resourceId: action });
  }
  await audit(
    { db: db as never, workspaceId: 'ws-2' },
    { actor: 'token:other', action: 'elsewhere', resourceType: 't', resourceId: 'x' },
  );
  const app = withErrorBoundary(createAuditRoutes({ ...options, access }));
  const get = (path: string, token = 'amt_admin') =>
    app.request(path, { headers: { authorization: `Bearer ${token}` } });
  return { db, get };
}

/** One line of the NDJSON export: a row, or the head the file ends with. */
interface ExportLine {
  seq?: number;
  hash?: string;
  action?: string;
  head?: { seq: number; hash: string } | null;
}

const ndjson = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as ExportLine);

/**
 * The export's page reads, counted at the database client as they are sent. `afterPage` runs
 * once a page has been read and before the route sees it, which is the moment a concurrent
 * writer can land between a page and whatever the route does next.
 */
function watchPages(
  db: MigratedDb,
  afterPage: (page: number) => Promise<void> = async () => undefined,
) {
  const client = db.$client;
  const query = client.query.bind(client);
  const reads = { pages: 0 };
  vi.spyOn(client, 'query').mockImplementation(
    async <T>(text: string, params?: unknown[], options?: QueryOptions): Promise<Results<T>> => {
      const isPage = /order by "audit_events"\."chain_seq" asc/u.test(text);
      if (isPage) reads.pages += 1;
      const page = reads.pages;
      const result = await query<T>(text, params, options);
      if (isPage) await afterPage(page);
      return result;
    },
  );
  return reads;
}

describe('the audit trail', () => {
  it('pages the newest first, with a cursor, and only this workspace’s rows', async () => {
    const { get } = await harness();
    const first = (await (await get('/api/v1/audit?limit=2')).json()) as {
      events: Array<{ action: string; seq: number }>;
      next: number | null;
    };
    expect(first.events.map((event) => event.action)).toEqual(['token.revoke', 'policy.set']);
    expect(first.next).toBe(2);
    const second = (await (
      await get(`/api/v1/audit?limit=2&before=${String(first.next)}`)
    ).json()) as {
      events: Array<{ action: string }>;
      next: number | null;
    };
    expect(second.events.map((event) => event.action)).toEqual(['token.create']);
    expect(second.next).toBeNull();
    const filtered = (await (await get('/api/v1/audit?action=policy.set')).json()) as {
      events: unknown[];
    };
    expect(filtered.events).toHaveLength(1);
  });

  it('exports every row oldest first as NDJSON, ending with the chain’s head', async () => {
    const { get } = await harness();
    const response = await get('/api/v1/audit/export');
    expect(response.headers.get('content-type')).toMatch(/application\/x-ndjson/u);
    expect(response.headers.get('content-disposition')).toMatch(/attachment/u);
    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.slice(0, 3).map((line) => line['action'])).toEqual([
      'token.create',
      'policy.set',
      'token.revoke',
    ]);
    // The export is recorded before the read, so the copy names itself.
    expect(lines[3]?.['action']).toBe('audit.export');
    const head = lines.at(-1) as { head: { seq: number; hash: string } };
    expect(head.head.seq).toBe(4);
    expect(head.head.hash).toMatch(/^[0-9a-f]{64}$/u);
    expect(lines.some((line) => line['action'] === 'elsewhere')).toBe(false);
  });

  it('ends the export with the head of the last row it streamed, not of a row written after', async () => {
    const { db, get } = await harness();
    // A decision recorded once the last page has been read. It is not in this copy, so the
    // head this copy ends with must not name it: a filed head has to be a row of its file.
    const reads = watchPages(db, async (page) => {
      if (page !== 1) return;
      await audit(
        { db: db as never, workspaceId: 'ws-1' },
        { actor: 'token:admin', action: 'late.write', resourceType: 't', resourceId: 'late' },
      );
    });
    const lines = ndjson(await (await get('/api/v1/audit/export')).text());
    const rows = lines.slice(0, -1);
    expect(rows.map((row) => row.action)).toEqual([
      'token.create',
      'policy.set',
      'token.revoke',
      'audit.export',
    ]);
    const last = rows.at(-1);
    expect(lines.at(-1)).toEqual({ head: { seq: last?.seq, hash: last?.hash } });
    // Not vacuous: the late row was written while the export ran, and is in the trail.
    expect(reads.pages).toBe(1);
    const actions = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents);
    expect(actions.map((row) => row.action)).toContain('late.write');
  });

  it('reads the trail a page at a time, as the client takes it', async () => {
    const { db, get } = await harness();
    // Three pages: the three seeded rows, 1,100 more, and the export's own row.
    await db.execute(sql`
      INSERT INTO audit_events (timestamp, actor_id, actor_type, action, workspace_id, created_at)
      SELECT now(), 'token:admin', 'service', 'bulk.write', 'ws-1', now()
        FROM generate_series(1, 1100)`);
    const reads = watchPages(db);
    const response = await get('/api/v1/audit/export');
    // Nothing read yet: the stream fetches the one page it keeps ready, and then no more,
    // however long the client leaves it.
    await vi.waitFor(() => expect(reads.pages).toBeGreaterThanOrEqual(1), { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(reads.pages).toBe(1);
    const lines = ndjson(await response.text());
    expect(reads.pages).toBe(3);
    const rows = lines.slice(0, -1);
    expect(rows.map((row) => row.seq)).toEqual(
      Array.from({ length: 1104 }, (_unused, index) => index + 1),
    );
    expect(lines.at(-1)).toEqual({ head: { seq: 1104, hash: rows.at(-1)?.hash } });
  });

  it('exports CSV with a header row, quoting what needs quoting', async () => {
    const { get } = await harness();
    const text = await (await get('/api/v1/audit/export?format=csv')).text();
    const [header, ...rows] = text.trim().split('\n');
    expect(header).toBe(
      'seq,timestamp,actor_id,actor_type,action,resource_type,resource_id,ip,user_agent,request_id,details,prev_hash,hash',
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatch(/^1,/u);
  });

  it('says the chain is intact, and names the row once one is edited', async () => {
    const { db, get } = await harness();
    const intact = (await (await get('/api/v1/audit/verify')).json()) as {
      intact: boolean;
      breaks: unknown[];
      head: { seq: number };
    };
    expect(intact).toMatchObject({ intact: true, breaks: [], head: { seq: 3 } });
    await db.execute(sql`ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only`);
    await db.execute(
      sql`UPDATE audit_events SET details = '{"forged":true}' WHERE action = 'policy.set'`,
    );
    const broken = (await (await get('/api/v1/audit/verify')).json()) as {
      intact: boolean;
      breaks: Array<{ seq: number; problem: string }>;
    };
    expect(broken).toMatchObject({ intact: false, breaks: [{ seq: 2, problem: 'edited' }] });
  });

  it('is the admin’s alone', async () => {
    const { get } = await harness();
    for (const path of ['/api/v1/audit', '/api/v1/audit/export', '/api/v1/audit/verify']) {
      expect((await get(path, 'amt_viewer')).status, path).toBe(403);
    }
  });

  it('records that the trail was exported, by whom', async () => {
    const { db, get } = await harness();
    await (await get('/api/v1/audit/export')).text();
    const rows = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents);
    expect(rows.map((row) => row.action)).toContain('audit.export');
  });
});
