import { beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DrizzleOutboxRepository } from '@automate/db';
import { assertSchemaBuildIsFresh, createMigratedDatabase } from './migrations.js';

/**
 * P-9, against the real migration graph.
 *
 * The outbox lost events in two ways and neither raised anything, so a unit test with a
 * mocked database could not have found either. A cross-workspace suppression needs two
 * rows and a unique index; an undeliverable row needs a `readAfter` that filters on the
 * column that is NULL.
 */

let client: PGlite;
let outbox: DrizzleOutboxRepository;

const WS_A = 'workspace-a';
const WS_B = 'workspace-b';

beforeEach(async () => {
  assertSchemaBuildIsFresh();
  client = await createMigratedDatabase();
  outbox = new DrizzleOutboxRepository(
    drizzle(client) as unknown as ConstructorParameters<typeof DrizzleOutboxRepository>[0],
  );
});

const event = (overrides: Record<string, unknown> = {}) => ({
  workspaceId: WS_A,
  aggregateType: 'run',
  aggregateId: 'run-1',
  eventType: 'run.started',
  payload: { n: 1 },
  dedupeKey: 'run-1:started',
  ...overrides,
});

describe('outbox dedupe is scoped to the workspace', () => {
  it('records the same dedupe key in two workspaces', async () => {
    // The finding. `dedupe_key` was unique on its own, so the second workspace's event
    // was suppressed by `onConflictDoNothing`, the append returned no row, and the
    // consumer returned without an error. A tenant's event simply never existed, and
    // the sender believed it was recorded.
    const appended = await outbox.appendMany([event(), event({ workspaceId: WS_B })]);
    expect(appended).toHaveLength(2);
  });

  it('still deduplicates a repeat within one workspace', async () => {
    // The property the index exists for, and the half that must not regress: a genuine
    // duplicate in the same tenant is still a duplicate.
    const appended = await outbox.appendMany([event(), event()]);
    expect(appended).toHaveLength(1);
  });

  it('delivers each workspace only its own events', async () => {
    // Not just "both rows exist" — the reason it matters is that `readAfter` filters on
    // the workspace, so a cross-tenant row would be stored and never seen.
    await outbox.appendMany([event(), event({ workspaceId: WS_B, dedupeKey: 'run-1:started' })]);
    for (const workspaceId of [WS_A, WS_B]) {
      const page = await outbox.readAfter({ workspaceId, afterSequence: 0 });
      expect(
        page.map((e) => e.workspaceId),
        workspaceId,
      ).toEqual([workspaceId]);
    }
  });
});

describe('every outbox row is deliverable', () => {
  it('refuses an append with no workspace, rather than writing an undeliverable row', async () => {
    // `readAfter` matches `workspace_id = $1`, so a NULL row was invisible to every
    // consumer while still consuming a sequence number and counting toward the retention
    // floor. The gap was permanent, and it moved the watermark that decides when the
    // table can be trimmed.
    await expect(
      outbox.appendMany([{ ...event(), workspaceId: '' as unknown as string }]),
    ).rejects.toThrow(/must name the workspace/);
  });

  it('rejects a whitespace-only workspace', async () => {
    await expect(outbox.appendMany([{ ...event(), workspaceId: '   ' }])).rejects.toThrow(
      /must name the workspace/,
    );
  });

  it('cannot store a NULL workspace at the database either', async () => {
    // Belt and braces: the type and the application check are both compile- or
    // runtime-level, and this is the constraint that holds when neither is consulted.
    const failure = await client
      .query(
        'INSERT INTO outbox_events (workspace_id, aggregate_type, aggregate_id, event_type, payload, dedupe_key) VALUES (NULL, $1, $2, $3, $4, $5)',
        ['run', 'run-1', 'run.started', JSON.stringify({}), 'null-workspace'],
      )
      .then(
        () => null,
        (cause: unknown) => cause,
      );
    expect(failure).not.toBeNull();
  });

  it('keeps every appended event visible to its own workspace reader', async () => {
    // The end-to-end statement of the whole finding: appended, readable, accounted for.
    const appended = await outbox.appendMany([
      event(),
      event({ workspaceId: WS_B }),
      event({ dedupeKey: 'run-1:finished', eventType: 'run.finished' }),
    ]);
    expect(appended).toHaveLength(3);

    const rows = await client.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM outbox_events WHERE workspace_id IS NOT NULL',
    );
    expect(rows.rows[0]?.count).toBe('3');
  });
});
