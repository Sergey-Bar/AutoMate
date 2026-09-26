import { describe, expect, it } from 'vitest';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';
import { InMemoryExecutionStore } from './in-memory-execution-store.js';
import { BoundedByteMap, BoundedMap, COMPLETION_HASH_CAPACITY } from './bounded-map.js';
import type { CreateRunInput, JobCompletionInput } from './types.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '@automate/db';

/**
 * The two maps this covers grew for the lifetime of the process:
 * `completionHashes` (one 64-char string per completed job) and the in-process
 * `memoryBytes` artifact fallback (whole artifact contents). On a self-hosted
 * install that runs for weeks — which is the deployment this product is for —
 * both are a slow out-of-memory kill, and neither shows up in a metric until the
 * process is already dying.
 *
 * `bounded-map.test.ts` proves the container's behaviour. These assert the
 * stores *hold* bounded containers, at runtime, so a future refactor that
 * reintroduces a plain `Map` fails here rather than leaking silently. A
 * source-text check would have passed against a map constructed by a helper.
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

/** TypeScript `private` is compile-time only, so a cast is how a test observes it. */
function privateField<T>(store: object, name: string): T {
  return (store as unknown as Record<string, T>)[name] as T;
}

describe('the execution stores hold bounded containers, not plain Maps', () => {
  it('bounds the in-memory completion hash map', () => {
    const hashes = privateField<{ capacity: number }>(
      new InMemoryExecutionStore(),
      'completionHashes',
    );
    expect(hashes).toBeInstanceOf(BoundedMap);
    expect(hashes.capacity).toBe(COMPLETION_HASH_CAPACITY);
  });

  it('bounds both maps in the Drizzle store', async () => {
    const client = new PGlite();
    try {
      await client.exec(readMigrations());
      const store = new DrizzleExecutionStore({
        db: drizzle(client, { schema }),
        workspaceId: 'ws-1',
      });
      const hashes = privateField<{ capacity: number }>(store, 'completionHashes');
      expect(hashes).toBeInstanceOf(BoundedMap);
      expect(hashes.capacity).toBe(COMPLETION_HASH_CAPACITY);

      const bytes = privateField<BoundedByteMap<string>>(store, 'memoryBytes');
      expect(bytes).toBeInstanceOf(BoundedByteMap);
      // Starts empty, and reports its own accounting so a leak is observable from
      // outside rather than only in a heap snapshot.
      expect(bytes.byteLength).toBe(0);
      expect(bytes.size).toBe(0);
    } finally {
      await client.close();
    }
  });
});

describe('bounding the completion hash does not break idempotency', () => {
  it('still recognises a repeated completion as a duplicate', async () => {
    const store = new InMemoryExecutionStore();
    const runner = await store.registerRunner(
      {
        id: 'runner-1',
        name: 'runner-1',
        version: '1.0.0',
        os: 'linux',
        arch: 'x64',
        capabilities: ['playwright'],
        labels: [],
        slots: 1,
      },
      'a'.repeat(64),
      new Date(Date.now() + 3_600_000).toISOString(),
      'secret',
    );
    await store.createRun(
      {
        externalId: 'ext-1',
        source: 'api',
        testType: 'browser',
        framework: 'playwright',
        timeoutMs: 1_000,
        requiredCapabilities: [],
        labels: [],
        configuration: {},
      } as CreateRunInput,
      'key-1',
      'ws-1',
    );
    const claim = await store.claimJob(runner.id, [], []);
    if (claim === null) throw new Error('expected a claim');
    const completion: JobCompletionInput = {
      leaseId: claim.leaseId,
      fencingToken: claim.fencingToken,
      status: 'passed',
      outcome: 'passed',
      tests: [{ id: 't-1', title: 'works', status: 'passed' }],
      summary: { total: 1, passed: 1, failed: 0, flaky: 0, skipped: 0, blocked: 0, unknown: 0 },
    };
    const first = await store.completeJob(claim.jobId, completion);
    expect(first?.status).toBe('accepted');
    // The same completion again is recognised as a duplicate, which is the
    // behaviour the bounded map must not break.
    const repeat = await store.completeJob(claim.jobId, completion);
    expect(repeat?.status).toBe('duplicate');
  });
});
