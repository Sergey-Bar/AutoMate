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
import { boundQuarantineSource, type QuarantineMatch } from './quarantine-excusal.js';
import type { ExecutionStore, ExecutionStoreOptions } from './types.js';

/**
 * An approved quarantine entry reaches the gate the store records, in both stores.
 *
 * The run completes with a passing chromium result and a failing webkit result for one
 * test, and the webkit project is quarantined. The recorded gate passes as a warning, and
 * the run and its tests still say what the runner reported.
 */
const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/drizzle',
);

function readMigrations(): string {
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

const MINE = 'ws-quarantine';
const THEIRS = 'ws-other';
const WEBKIT = 'a.spec.ts › pays [webkit]';
const CHROMIUM = 'a.spec.ts › pays [chromium]';
const ENTRY: QuarantineMatch = {
  stableId: WEBKIT,
  testTitle: 'pays',
  testFile: 'a.spec.ts',
  status: 'approved',
};

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(readMigrations());
  const db = drizzle(client, { schema }) as unknown as {
    insert: (table: unknown) => { values: (values: unknown) => Promise<unknown> };
  };
  for (const id of [MINE, THEIRS]) {
    await db.insert(schema.workspaces).values({
      id,
      name: id,
      configPath: 'config',
      testResultsDir: 'var/results',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
  }
}, 180_000);

afterAll(async () => {
  await client.close();
});

const harnesses: Array<{ name: string; make: (options: ExecutionStoreOptions) => ExecutionStore }> =
  [
    { name: 'in-memory', make: (options) => new InMemoryExecutionStore(options) },
    {
      name: 'drizzle',
      make: (options) => new DrizzleExecutionStore({ ...options, db: drizzle(client, { schema }) }),
    },
  ];

async function completeFailingWebkit(store: ExecutionStore, workspaceId: string, key: string) {
  const runner = await store.registerRunner(
    {
      id: `runner-${key}`,
      name: `runner-${key}`,
      version: '1.0.0',
      os: 'linux',
      arch: 'x64',
      capabilities: ['playwright'],
      labels: [],
      slots: 1,
    } as never,
    createHash('sha256').update(key).digest('hex'),
    new Date(Date.now() + 3_600_000).toISOString(),
    workspaceId,
  );
  const { run } = await store.createRun(
    {
      externalId: `ext-${key}`,
      source: 'api',
      testType: 'browser',
      framework: 'playwright',
      timeoutMs: 1_000,
      requiredCapabilities: [],
      labels: [],
      configuration: {},
    } as never,
    `key-${key}`,
    workspaceId,
  );
  const claim = await store.claimJob(runner.id, [], [], undefined, workspaceId);
  if (claim === null) throw new Error('no job to claim');
  await store.completeJob(
    claim.jobId,
    {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: 'failed',
      outcome: 'failed',
      tests: [
        { id: CHROMIUM, stableId: CHROMIUM, title: 'pays', file: 'a.spec.ts', status: 'passed' },
        { id: WEBKIT, stableId: WEBKIT, title: 'pays', file: 'a.spec.ts', status: 'failed' },
      ],
      summary: { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
    } as never,
    workspaceId,
  );
  return run.id;
}

describe('the recorded gate reads the workspace quarantine', () => {
  for (const harness of harnesses) {
    it(`excuses a quarantined failure without rewriting it (${harness.name})`, async () => {
      const store = harness.make({
        workspaceId: MINE,
        quarantined: boundQuarantineSource(MINE, async () => [ENTRY]),
      } as ExecutionStoreOptions);
      const runId = await completeFailingWebkit(store, MINE, `mine-${harness.name}`);
      const gate = await store.getRunGate(MINE, runId);
      expect(gate?.decision).toBe('ready_with_warnings');
      expect(gate?.reasons).toContain('quarantine:EXCUSED; excused=1');
      const run = await store.getRun(runId, MINE);
      expect(run?.outcome).toBe('failed');
      expect(run?.tests.find((test) => test.stableId === WEBKIT)?.status).toBe('failed');
    });

    it(`never lets one workspace's approval excuse another's failure (${harness.name})`, async () => {
      const store = harness.make({
        workspaceId: THEIRS,
        quarantined: boundQuarantineSource(MINE, async () => [ENTRY]),
      } as ExecutionStoreOptions);
      const runId = await completeFailingWebkit(store, THEIRS, `theirs-${harness.name}`);
      const gate = await store.getRunGate(THEIRS, runId);
      expect(gate?.decision).toBe('blocked');
    });
  }
});
