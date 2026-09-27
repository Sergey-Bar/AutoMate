import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { normalizeEventLimit } from './run-paging.js';
import type { CreateRunInput, ExecutionEventInput, ExecutionStore } from './types.js';

/**
 * The event list is paged, and both stores page it the same way.
 *
 * `GET /api/v1/runs/:runId/events` read every event a run had ever produced and
 * serialised the lot. Events grow with the number of **tests** — a Playwright run
 * over 5 000 tests appends tens of thousands of rows — so the endpoint's cost grew
 * with the size of the *run* rather than the size of the page. The runs listing was
 * fixed for exactly this and this one was missed, which is the failure mode of having
 * no statement like "every list endpoint is paged".
 *
 * Paging on **`sequence`** is what makes it safe. `appendEvents` allocates a run's
 * sequences monotonically, so `after` is an exact position. A cursor on a timestamp
 * would page between two events that shared one, forever, and that looks like a
 * correct page that repeats.
 *
 * Both implementations are driven by the same suite, because the alternative is two
 * suites that agree until one of them is edited.
 */

const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

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

const WS = 'ws-events';

interface Harness {
  name: string;
  store: ExecutionStore;
  /** Creates a run with `count` appended events, and returns the run id. */
  seeded(count: number): Promise<string>;
  close(): Promise<void>;
}

async function drizzleHarness(): Promise<Harness> {
  const client = new PGlite();
  await client.exec(migrationSql());
  const db = drizzle(client, { schema });
  await db.insert(schema.workspaces).values({
    id: WS,
    name: 'events',
    configPath: 'config',
    createdAt: new Date(),
  });
  const store = new DrizzleExecutionStore({ db: db as never, workspaceId: WS });
  return {
    name: 'DrizzleExecutionStore',
    store,
    seeded: (count) => seed(store, count),
    close: () => client.close(),
  };
}

function inMemoryHarness(): Harness {
  const store = new InMemoryExecutionStore();
  return {
    name: 'InMemoryExecutionStore',
    store,
    seeded: (count) => seed(store, count),
    close: async () => {},
  };
}

const CREATE_RUN: CreateRunInput = {
  externalId: 'ext-events',
  source: 'api',
  testType: 'browser',
  framework: 'playwright',
  timeoutMs: 1_000,
  requiredCapabilities: [],
  labels: [],
  configuration: {},
};

let runCounter = 0;

async function seed(store: ExecutionStore, count: number): Promise<string> {
  runCounter += 1;
  // `external_id` is unique per (workspace, source), so every seeded run needs its
  // own: otherwise the second call in the suite is a duplicate insert and the test
  // reports a constraint violation instead of a paging result.
  const { run, job } = await store.createRun(
    { ...CREATE_RUN, externalId: `ext-events-${runCounter}` },
    `key-events-${runCounter}`,
    WS,
  );
  const events: ExecutionEventInput[] = Array.from({ length: count }, (_, index) => ({
    // `event_id` is unique across the table, not per run, so the ids are namespaced
    // by the seeded run. Reusing `event-1` in the second seeded run is a duplicate
    // insert, and the test then reports a constraint violation instead of a page.
    eventId: `event-${runCounter}-${index + 1}`,
    type: 'run.phase',
    sequence: index + 1,
    payload: { phase: 'running', outcome: null, index: index + 1 },
  }));
  // A job is claimed by a *runner*, not by the run: `claimJob`'s first argument is a
  // runner id, so a run id claims nothing and returns null. Registering a real runner
  // is what makes the append path reachable at all. `registerRunner` takes the
  // manifest and the *hash* of a token — it never sees a secret — so the store is
  // given a digest rather than the plaintext the route would hash first.
  const runner = await store.registerRunner(
    {
      id: `paging-runner-${runCounter}`,
      name: `paging-runner-${runCounter}`,
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: [],
      labels: [],
      slots: 1,
    },
    createHash('sha256').update(`token-${runCounter}`).digest('hex'),
    new Date(Date.now() + 3_600_000).toISOString(),
    WS,
  );
  const claim = await store.claimJob(runner.id, [], [], new Date(), WS);
  expect(claim?.jobId, 'the job was not claimable').toBe(job.id);
  const applied = await store.appendEvents(
    claim?.jobId ?? '',
    claim?.leaseId ?? '',
    claim?.fencingToken ?? 1,
    events,
    WS,
  );
  expect(applied.filter((result) => result.status === 'accepted')).toHaveLength(count);
  return run.id;
}

let harnesses: Harness[];

beforeAll(async () => {
  harnesses = [await drizzleHarness(), inMemoryHarness()];
});

afterAll(async () => {
  for (const harness of harnesses ?? []) await harness.close();
});

for (const make of [drizzleHarness, inMemoryHarness]) {
  describe(`${make.name} event paging`, () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await make();
    });

    afterAll(async () => {
      await harness.close();
    });

    it('returns a bounded page, and says whether more exist', async () => {
      const runId = await harness.seeded(250);
      const page = await harness.store.listEvents(WS, runId, { limit: 100 });

      expect(page.events).toHaveLength(100);
      expect(page.hasMore).toBe(true);
      // The first page starts at the beginning, so a client with no cursor sees the
      // start of the run rather than an arbitrary slice.
      expect(page.events[0]?.sequence).toBe(1);
    });

    it('walks the whole run with no gap and no repeat', async () => {
      const runId = await harness.seeded(250);
      const seen: number[] = [];
      let after: number | undefined;
      for (let guard = 0; guard < 20; guard += 1) {
        const page = await harness.store.listEvents(WS, runId, {
          afterSequence: after,
          limit: 100,
        });
        seen.push(...page.events.map((event) => event.sequence));
        if (!page.hasMore) break;
        after = page.events[page.events.length - 1]?.sequence;
      }
      expect(seen).toEqual(Array.from({ length: 250 }, (_, index) => index + 1));
    });

    it('reports the last page as having nothing more', async () => {
      const runId = await harness.seeded(10);
      const page = await harness.store.listEvents(WS, runId, { limit: 100 });
      expect(page.events).toHaveLength(10);
      expect(page.hasMore).toBe(false);
    });

    it('resumes strictly after the cursor, not inclusively', async () => {
      const runId = await harness.seeded(10);
      // An inclusive resume repeats the cursor's own event, which a client appending
      // to a list it is also streaming would render twice.
      const page = await harness.store.listEvents(WS, runId, { afterSequence: 4, limit: 3 });
      expect(page.events.map((event) => event.sequence)).toEqual([5, 6, 7]);
    });

    it('clamps a hostile limit rather than passing it to SQL', async () => {
      const runId = await harness.seeded(10);
      // A negative limit is a database error and `0` looks like an empty run, so both
      // are clamped to the minimum and the caller still gets its page.
      for (const limit of [0, -5, 1.7, Number.NaN]) {
        const page = await harness.store.listEvents(WS, runId, { limit });
        expect(page.events.length, `limit ${String(limit)} returned nothing`).toBeGreaterThan(0);
      }
      expect((await harness.store.listEvents(WS, runId, { limit: 1_000_000 })).events).toHaveLength(
        10,
      );
    });

    it('is empty for a run with no events, and says so honestly', async () => {
      runCounter += 1;
      const { run } = await harness.store.createRun(
        { ...CREATE_RUN, externalId: `ext-events-empty-${runCounter}` },
        `key-events-empty-${runCounter}`,
        WS,
      );
      const page = await harness.store.listEvents(WS, run.id);
      expect(page.events).toEqual([]);
      expect(page.hasMore).toBe(false);
    });
  });
}

describe('the event page size is one range, in both stores', () => {
  it('clamps the same way for every nonsensical limit', () => {
    expect(normalizeEventLimit(undefined)).toBe(100);
    expect(normalizeEventLimit(Number.NaN)).toBe(100);
    expect(normalizeEventLimit(0)).toBe(1);
    expect(normalizeEventLimit(-5)).toBe(1);
    expect(normalizeEventLimit(1.7)).toBe(1);
    expect(normalizeEventLimit(10_000)).toBe(500);
    expect(normalizeEventLimit(250)).toBe(250);
  });
});
