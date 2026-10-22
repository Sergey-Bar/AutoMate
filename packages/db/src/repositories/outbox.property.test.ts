import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../schema/index.js';
import { DrizzleOutboxRepository, type AppendOutboxEvent } from './outbox-repository.js';

/**
 * Property suite for invariants OUTBOX-1 .. OUTBOX-3 in `docs/quality/property-invariants.json`,
 * against the real migration graph in PGlite - the same harness `repositories.test.ts` uses.
 *
 * Every run gets workspaces of its own, so no run can see another's rows and a failing
 * counterexample replays from the seed alone. Fixed seed; `numRuns` is small because each run
 * is a database round trip.
 */
const SEED = 20261022;
const params = { seed: SEED, numRuns: 40 } as const;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const drizzleDirectory = path.join(repoRoot, 'packages/db/drizzle');

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

let client: PGlite;
let outbox: DrizzleOutboxRepository;
let counter = 0;

// Same budget, same reason, as `repositories.test.ts`: the whole migration graph is paid per file.
const PGLITE_MIGRATION_TIMEOUT_MS = 60_000;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationSql());
  outbox = new DrizzleOutboxRepository(drizzle(client, { schema }) as never);
}, PGLITE_MIGRATION_TIMEOUT_MS);

afterAll(async () => {
  if (client) await client.close();
});

/** Fresh workspaces for one run; the rows of one run are invisible to the next. */
async function workspaces(count: number): Promise<string[]> {
  counter += 1;
  const ids = Array.from(
    { length: count },
    (_, index) => `ws-prop-${String(counter)}-${String(index)}`,
  );
  for (const id of ids) {
    await client.query(
      `INSERT INTO workspaces (id, name, config_path, created_at) VALUES ($1, $1, 'config', now())`,
      [id],
    );
  }
  return ids;
}

const event = (workspaceId: string, dedupeKey: string): AppendOutboxEvent => ({
  workspaceId,
  aggregateType: 'run',
  aggregateId: 'run-1',
  eventType: 'execution.event.appended',
  payload: { dedupeKey },
  dedupeKey,
});

/** Short keys over a tiny alphabet, so generated sequences collide often. */
const keyArb = fc.constantFrom('k0', 'k1', 'k2', 'k3', 'k4');

describe('OUTBOX-1: appending the same event again is a no-op', () => {
  it('twice yields one row with one sequence, and the second append reports no insert', async () => {
    await fc.assert(
      fc.asyncProperty(keyArb, fc.integer({ min: 2, max: 4 }), async (key, times) => {
        const [ws] = await workspaces(1);
        const first = await outbox.append(event(ws as string, key));
        expect(first).not.toBeNull();
        for (let repeat = 1; repeat < times; repeat += 1) {
          expect(await outbox.append(event(ws as string, key))).toBeNull();
        }
        const rows = await outbox.readAfter({ workspaceId: ws as string, afterSequence: 0 });
        expect(rows).toHaveLength(1);
        expect(rows[0]?.sequence).toBe(first?.sequence);
        expect(rows[0]?.eventId).toBe(first?.eventId);
      }),
      { ...params, examples: [['k0', 2]] },
    );
  });

  it('any sequence of batches, repeats included, leaves one row per distinct key in first-seen order', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.array(keyArb, { minLength: 1, maxLength: 5 }), { minLength: 1, maxLength: 5 }),
        async (batches) => {
          const [ws] = await workspaces(1);
          for (const batch of batches) {
            await outbox.appendMany(batch.map((key) => event(ws as string, key)));
          }
          const rows = await outbox.readAfter({ workspaceId: ws as string, afterSequence: 0 });
          const firstSeen = [...new Set(batches.flat())];
          expect(rows.map((row) => row.dedupeKey)).toEqual(firstSeen);
          const sequences = rows.map((row) => row.sequence);
          expect(new Set(sequences).size).toBe(sequences.length);
          expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
        },
      ),
      // One batch that repeats its own key: ON CONFLICT DO NOTHING must cope within a statement.
      { ...params, examples: [[[['k0', 'k0', 'k1']]]] },
    );
  });
});

describe('OUTBOX-2: a read bound to workspace A never returns workspace B rows', () => {
  it('each workspace reads exactly what it appended, even when keys collide across workspaces', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 2 }), keyArb), { minLength: 1, maxLength: 12 }),
        async (appends) => {
          const ids = await workspaces(3);
          for (const [which, key] of appends) {
            await outbox.append(event(ids[which] as string, key));
          }
          for (const [which, id] of ids.entries()) {
            const rows = await outbox.readAfter({ workspaceId: id, afterSequence: 0 });
            const mine = [...new Set(appends.filter(([w]) => w === which).map(([, key]) => key))];
            expect(rows.every((row) => row.workspaceId === id)).toBe(true);
            expect(rows.map((row) => row.dedupeKey)).toEqual(mine);
            // The retention floor is a statement about this workspace's rows too.
            const floor = await outbox.getRetentionFloor(id);
            expect(floor).toBe(rows.length === 0 ? null : rows[0]?.sequence);
          }
        },
      ),
      // Same key in two workspaces: two rows, never one deduped away by the other.
      {
        ...params,
        examples: [
          [
            [
              [0, 'k0'],
              [1, 'k0'],
            ],
          ],
        ],
      },
    );
  });

  it('a cursor taken from one workspace never skips or leaks rows in another', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        async (a, b) => {
          const [wsA, wsB] = await workspaces(2);
          for (let index = 0; index < a; index += 1)
            await outbox.append(event(wsA as string, `a${String(index)}`));
          for (let index = 0; index < b; index += 1)
            await outbox.append(event(wsB as string, `b${String(index)}`));
          const pageA = await outbox.readAfter({ workspaceId: wsA as string, afterSequence: 0 });
          const cursor = pageA.at(-1)?.sequence ?? 0;
          // Past A's last row there is nothing in A, whatever B went on to append.
          expect(
            await outbox.readAfter({ workspaceId: wsA as string, afterSequence: cursor }),
          ).toEqual([]);
          expect(
            (await outbox.readAfter({ workspaceId: wsB as string, afterSequence: 0 })).map(
              (r) => r.dedupeKey,
            ),
          ).toEqual(Array.from({ length: b }, (_, index) => `b${String(index)}`));
        },
      ),
      params,
    );
  });
});

describe('OUTBOX-3: a malformed append is refused before it touches the table', () => {
  it('rejects a blank workspace and an out-of-range key for any such input', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', ' ', '\t', '   '),
        fc.string({ minLength: 513, maxLength: 600 }),
        async (blank, longKey) => {
          await expect(outbox.append(event(blank, 'k'))).rejects.toThrow(/workspace/);
          await expect(outbox.append(event('ws-never', longKey))).rejects.toThrow(/dedupe key/);
          await expect(outbox.append(event('ws-never', ''))).rejects.toThrow(/dedupe key/);
        },
      ),
      params,
    );
  });
});

describe('the property harness can fail', () => {
  it('refutes a deliberately wrong claim ("a repeated key adds a row")', async () => {
    const outcome = await fc.check(
      fc.asyncProperty(keyArb, async (key) => {
        const [ws] = await workspaces(1);
        await outbox.append(event(ws as string, key));
        await outbox.append(event(ws as string, key));
        return (
          (await outbox.readAfter({ workspaceId: ws as string, afterSequence: 0 })).length === 2
        );
      }),
      { ...params, numRuns: 5 },
    );
    expect(outcome.failed).toBe(true);
  });
});
