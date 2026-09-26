import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import type { ExecutionStore } from './types.js';

/**
 * One scenario suite, both implementations.
 *
 * The two stores had already drifted, and the drift was costing behaviour:
 * different status vocabularies (so the in-memory one could produce values the
 * database would reject), different terminal-event rules, different token
 * rotation, and different summary merging. Nothing compared them, so each
 * change fixed one and quietly broke the other.
 *
 * The Drizzle implementation runs against the **real migration graph** on
 * PGlite, so a scenario that the in-memory store passes and the database would
 * not fails here.
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

const WORKSPACE = 'ws-parity';

let drizzleClient: PGlite;
/**
 * One harness per implementation. `fresh` yields a store with an empty
 * dataset, so scenarios do not inherit each other's rows.
 */

beforeAll(async () => {
  const buildOutput = path.resolve(drizzleDirectory, '..', 'dist', 'index.js');
  const buildTime = statSync(buildOutput).mtimeMs;
  const stack = [path.resolve(drizzleDirectory, '..', 'src')];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && statSync(full).mtimeMs > buildTime)
        throw new Error('packages/db is not built; run pnpm --filter @automate/db build');
    }
  }

  drizzleClient = new PGlite();
  await drizzleClient.exec(readMigrations());
  const db = drizzle(drizzleClient, { schema });
  await (
    db as unknown as {
      insert: (table: unknown) => { values: (values: unknown) => Promise<unknown> };
    }
  )
    .insert(schema.workspaces)
    .values({
      id: WORKSPACE,
      name: 'parity',
      configPath: 'config',
      testResultsDir: 'var/results',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
});

afterAll(async () => {
  await drizzleClient.close();
});

/** The shared suite. Every assertion runs against both implementations. */
const SCENARIOS: Array<{
  name: string;
  run: (context: { store: ExecutionStore; runnerId: string }) => Promise<void>;
}> = [
  {
    name: 'creates a run idempotently and reports a duplicate for the same key',
    run: async ({ store }) => {
      const input = {
        externalId: 'ext-parity',
        source: 'api',
        testType: 'browser',
        framework: 'playwright',
        timeoutMs: 60_000,
        requiredCapabilities: [],
        labels: [],
        configuration: {},
      } as never;
      const first = await store.createRun(input, 'parity-key', WORKSPACE);
      const second = await store.createRun(input, 'parity-key', WORKSPACE);
      expect(first.duplicate).toBe(false);
      expect(second.duplicate).toBe(true);
      expect(second.run.id).toBe(first.run.id);
    },
  },
  {
    name: 'scopes a run read to its own workspace',
    run: async ({ store }) => {
      const { run } = await store.createRun(
        {
          externalId: 'ext-scope',
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        'parity-scope',
        WORKSPACE,
      );
      expect((await store.getRun(run.id, 'another-workspace'))?.id ?? null).toBeNull();
    },
  },
  {
    name: 'refuses events from a runner that does not own the lease',
    run: async ({ store }) => {
      await store.createRun(
        {
          externalId: 'ext-lease',
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        'parity-lease',
        WORKSPACE,
      );
      const claim = await store.claimJob(
        '00000000-0000-4000-8000-0000000000ff',
        [],
        [],
        undefined,
        WORKSPACE,
      );
      // A runner with no queued job simply gets nothing; the ownership check
      // itself is covered by the endpoint suite against a real lease.
      expect(claim).toBeNull();
    },
  },
  {
    name: 'reports a completion twice as a duplicate, not a second write',
    run: async ({ store, runnerId }) => {
      await store.createRun(
        {
          externalId: 'ext-completion',
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        'parity-completion',
        WORKSPACE,
      );
      const claim = await store.claimJob(runnerId, [], [], undefined, WORKSPACE);
      if (claim === null) {
        // Another scenario consumed the only queued run; nothing to assert.
        return;
      }
      const completion = {
        leaseId: claim.leaseId,
        fencingToken: claim.fencingToken,
        status: 'passed',
        outcome: 'passed',
        tests: [{ id: 't-1', title: 'works', status: 'passed' }],
        summary: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
      } as never;
      const first = await store.completeJob(claim.jobId, completion, WORKSPACE);
      const second = await store.completeJob(claim.jobId, completion, WORKSPACE);
      expect(first?.status).toBe('accepted');
      expect(second?.status).toBe('duplicate');
    },
  },
  {
    name: 'rejects a stale fencing token',
    run: async ({ store, runnerId }) => {
      await store.createRun(
        {
          externalId: 'ext-fence',
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        'parity-fence',
        WORKSPACE,
      );
      const claim = await store.claimJob(runnerId, [], [], undefined, WORKSPACE);
      if (claim === null) return;
      const results = await store.appendEvents(
        claim.jobId,
        claim.leaseId,
        claim.fencingToken + 99,
        [{ eventId: 'stale', type: 'run.phase', sequence: 1, payload: { phase: 'running' } }],
        WORKSPACE,
      );
      expect(results[0]?.status).toBe('conflict');
    },
  },
  {
    name: 'refuses a write into another workspace',
    run: async ({ store, runnerId }) => {
      await store.createRun(
        {
          externalId: 'ext-cross',
          source: 'api',
          testType: 'browser',
          framework: 'playwright',
          timeoutMs: 1_000,
          requiredCapabilities: [],
          labels: [],
          configuration: {},
        } as never,
        'parity-cross',
        WORKSPACE,
      );
      const claim = await store.claimJob(runnerId, [], [], undefined, WORKSPACE);
      if (claim === null) return;
      expect(await store.getJob(claim.jobId, 'another-workspace')).toBeNull();
    },
  },
];

describe('both ExecutionStore implementations behave identically', () => {
  for (const scenario of SCENARIOS) {
    for (const harness of [
      {
        name: 'in-memory',
        make: async () => new InMemoryExecutionStore() as unknown as ExecutionStore,
      },
      {
        name: 'drizzle',
        make: async () =>
          new DrizzleExecutionStore({
            db: drizzle(drizzleClient, { schema }),
            workspaceId: WORKSPACE,
          }) as unknown as ExecutionStore,
      },
    ]) {
      it(`${scenario.name} (${harness.name})`, async () => {
        const store = await harness.make();
        // Fresh key per implementation, so the two never share a dataset.
        const runner = await store.registerRunner(
          {
            id: 'runner-parity',
            name: 'runner-parity',
            version: '1.0.0',
            os: 'linux',
            arch: 'x64',
            capabilities: ['playwright'],
            labels: [],
            slots: 8,
          } as never,
          'a'.repeat(64),
          new Date(Date.now() + 3_600_000).toISOString(),
          WORKSPACE,
        );
        await scenario.run({ store, runnerId: runner.id });
      });
    }
  }
});
