import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { DrizzleExecutionStore } from './drizzle-execution-store.js';
import type { ArtifactBytesStore } from '../infrastructure/artifact-store.js';
import type { CreateRunInput } from './types.js';

/**
 * A failed artifact write must not leave the bytes behind.
 *
 * `addArtifact` writes the object first and the row second, because the row needs
 * the checksum and the size, which are only knowable once the bytes exist. That
 * ordering is not a choice and the alternative (`pending → committed`) is a
 * migration plus a sweeper; the compensation is the cheap half of the answer.
 *
 * Without it, an insert that failed left an object in the store that nothing
 * referenced and nothing could remove. On a self-hosted install the object store is
 * a directory or a bucket nobody reconciles, so the orphan accumulated silently —
 * and the in-process fallback charged it to the 256 MiB budget for the life of the
 * process, evicting real artifacts to make room for evidence nobody could read.
 *
 * The residual is stated in `addArtifact`: a process that *dies* between the two
 * writes still orphans the object. This covers the failure that was actually
 * happening.
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

/** Records every write, so the test can assert on the absence of one. */
class RecordingByteStore implements ArtifactBytesStore {
  readonly keys = new Map<string, Uint8Array>();
  readonly deleted: string[] = [];

  async put(storageKey: string, bytes: Uint8Array): Promise<void> {
    this.keys.set(storageKey, bytes);
  }

  async get(storageKey: string): Promise<Uint8Array | null> {
    return this.keys.get(storageKey) ?? null;
  }

  async delete(storageKey: string): Promise<void> {
    this.deleted.push(storageKey);
    this.keys.delete(storageKey);
  }
}

let client: PGlite;
let bytes: RecordingByteStore;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(readMigrations());
  bytes = new RecordingByteStore();
  // `runs` and `execution_jobs` both reference `workspaces`, so a run cannot exist
  // without one. The migration graph gives no default row, and every test that
  // creates a run on PGlite has to say so.
  const db = drizzle(client, { schema });
  await db.insert(schema.workspaces).values({
    id: 'ws-1',
    name: 'default',
    configPath: 'config',
    createdAt: new Date(),
  });
});

afterEach(async () => {
  await client.close();
});

function buildStore(options: { workspaceId?: string } = {}) {
  return new DrizzleExecutionStore({
    db: drizzle(client, { schema }),
    workspaceId: options.workspaceId ?? 'ws-1',
    artifactBytes: bytes,
  });
}

async function aRun(store: DrizzleExecutionStore): Promise<string> {
  const { run } = await store.createRun(
    {
      externalId: 'ext-compensation',
      source: 'api',
      testType: 'browser',
      framework: 'playwright',
      timeoutMs: 1_000,
      requiredCapabilities: [],
      labels: [],
      configuration: {},
    } as CreateRunInput,
    'key-compensation',
    'ws-1',
  );
  return run.id;
}

/**
 * A complete artifact input. The optional columns are stated rather than left out so
 * the test fails to compile if `addArtifact` grows a *required* one — a new required
 * column would otherwise show up as a runtime null and a not-null violation, which
 * reads like the failure this suite is provoking.
 */
const ARTIFACT = {
  name: 'trace.zip',
  contentType: 'application/zip',
  kind: 'trace' as const,
  storageKey: 'ws-1/run-1/trace.zip',
  bytes: new Uint8Array([1, 2, 3, 4]),
  jobId: null,
  testId: null,
  expiresAt: null,
  legalHold: false,
  metadata: {},
};

describe('a failed artifact row insert does not orphan the bytes', () => {
  it('removes the object when the insert is refused', async () => {
    const store = buildStore();

    // No run with this id, so `artifacts_run_id_fkey` refuses the row *after* the
    // bytes have already been written. This is the real ordering hazard: the object
    // store is not transactional and knows nothing about the database's foreign keys.
    await expect(
      store.addArtifact({ ...ARTIFACT, runId: '00000000-0000-4000-8000-0000000000ff' }),
    ).rejects.toThrow();

    expect(bytes.deleted).toEqual([ARTIFACT.storageKey]);
    expect(bytes.keys.has(ARTIFACT.storageKey)).toBe(false);
  });

  it('keeps the bytes when the insert succeeds', async () => {
    const store = buildStore();
    const runId = await aRun(store);

    const descriptor = await store.addArtifact({ ...ARTIFACT, runId });

    expect(descriptor.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(bytes.deleted).toEqual([]);
    await expect(store.getArtifact(descriptor.id, 'ws-1')).resolves.not.toBeNull();
  });

  it('releases the in-process budget too, not just the object store', async () => {
    // The same path with no configured byte store falls back to the bounded
    // in-process map, and a leaked entry there evicts *real* artifacts to make room
    // for evidence nobody can reach. The bound's own accounting is the assertion.
    const store = new DrizzleExecutionStore({
      db: drizzle(client, { schema }),
      workspaceId: 'ws-1',
    });
    const runId = await aRun(store);
    const held = (store as unknown as { memoryBytes: { size: number; byteLength: number } })
      .memoryBytes;

    await expect(
      store.addArtifact({ ...ARTIFACT, runId: '00000000-0000-4000-8000-0000000000fe' }),
    ).rejects.toThrow();

    expect(held.size).toBe(0);
    expect(held.byteLength).toBe(0);
    // And the compensation removed only what the failed write put there: a real run
    // with its own artifact is untouched, so "nothing was deleted" is not passing
    // because the cleanup deleted everything.
    const kept = await store.addArtifact({ ...ARTIFACT, runId, storageKey: 'ws-1/keep.zip' });
    expect(held.size).toBe(1);
    await expect(store.getArtifact(kept.id, 'ws-1')).resolves.not.toBeNull();
  });
});
