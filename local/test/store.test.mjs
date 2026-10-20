import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { sha256 } from '../src/ingest.mjs';
import { MIGRATIONS, StoreError, openStore as openRaw } from '../src/store.mjs';
import { FILES_DIR, LOCAL_ROOT, bytesFor, loadManifest, optionsFor } from './support.mjs';

const manifest = loadManifest().filter((entry) => entry.file !== undefined);
const OBSERVED = '2026-10-19T00:00:00Z';

/** @type {Array<ReturnType<typeof openRaw>>} */
const opened = [];

/**
 * Opens a store and remembers it, so a test that fails halfway still releases its files.
 *
 * @param {string} directory
 * @param {Parameters<typeof openRaw>[1]} [options]
 */
function openStore(directory, options) {
  const store = openRaw(directory, options);
  opened.push(store);
  return store;
}

/**
 * Runs a test body against a fresh store directory and removes it afterwards.
 *
 * @param {(directory: string) => void | Promise<void>} body
 */
async function withDirectory(body) {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-spike-'));
  try {
    await body(directory);
  } finally {
    for (const store of opened.splice(0)) {
      try {
        store.close();
      } catch {
        // already closed by the test
      }
    }
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

/**
 * @param {ReturnType<typeof openStore>} store
 * @param {string} table
 * @returns {number}
 */
function countOf(store, table) {
  return Number(
    /** @type {{ n: number }} */ (store.db.prepare(`select count(*) as n from ${table}`).get()).n,
  );
}

/** @param {ReturnType<typeof openStore>} store @param {string} id */
function ingestFixture(store, id) {
  const entry = manifest.find((candidate) => candidate.id === id);
  assert.ok(entry, id);
  return store.ingest(bytesFor(entry), {
    path: entry.file,
    observedAt: OBSERVED,
    ingestOptions: optionsFor(entry),
  });
}

test('every stored report comes back byte-identical, and its name is its digest', async () => {
  await withDirectory((directory) => {
    const store = openStore(directory);
    for (const entry of manifest) ingestFixture(store, entry.id);
    for (const entry of manifest) {
      const original = new Uint8Array(readFileSync(path.join(FILES_DIR, entry.file ?? '')));
      const stored = store.readBlob(sha256(original));
      assert.deepEqual(stored, original, `${entry.id} did not round-trip`);
    }
    assert.deepEqual(store.verify(), []);
    store.close();
  });
});

test('ingesting the same report again changes nothing', async () => {
  await withDirectory((directory) => {
    const store = openStore(directory);
    assert.equal(ingestFixture(store, 'junit-basic').status, 'ingested');
    const before = store.dumpDerived();
    assert.equal(ingestFixture(store, 'junit-basic').status, 'already-ingested');
    assert.equal(
      ingestFixture(store, 'junit-basic-copy').status,
      'already-ingested',
      'equal bytes',
    );
    assert.equal(store.dumpDerived(), before);
    assert.equal(countOf(store, 'artifact'), 1);
    store.close();
  });
});

test('a process killed after the inserts and before the commit leaves nothing half-written', async () => {
  await withDirectory(async (directory) => {
    const first = openStore(directory);
    ingestFixture(first, 'junit-basic');
    const committed = first.dumpDerived();
    first.close();

    const marker = path.join(directory, 'marker.txt');
    const worker = path.join(LOCAL_ROOT, 'test', 'crash-worker.mjs');
    const victim = path.join(FILES_DIR, 'node-junit.xml');
    // stdio is ignored on purpose: pipes to a child hang in the sandbox this was written in.
    const child = spawn(process.execPath, [worker, directory, victim, marker], { stdio: 'ignore' });
    const exited = new Promise((resolve) => child.once('exit', resolve));

    const deadline = Date.now() + 20_000;
    while (!existsSync(marker) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.ok(existsSync(marker), 'the worker never reached the commit point');
    child.kill('SIGKILL');
    await exited;

    const reopened = openStore(directory);
    assert.equal(reopened.dumpDerived(), committed, 'the interrupted ingest is not visible');
    assert.equal(countOf(reopened, 'artifact'), 1, 'and it left no artifact row');
    assert.equal(
      /** @type {{ integrity_check: string }} */ (
        reopened.db.prepare('pragma integrity_check').get()
      ).integrity_check,
      'ok',
    );
    // Its blob was written first and is allowed to be orphaned; no row points at nothing.
    assert.deepEqual(reopened.verify(), []);
    // And the same report ingests cleanly afterwards.
    assert.equal(
      reopened.ingest(new Uint8Array(readFileSync(victim)), {
        observedAt: OBSERVED,
        ingestOptions: { repoRoot: 'C:\\repo' },
      }).status,
      'ingested',
    );
    reopened.close();
  });
});

test('a tampered or deleted blob is detected', async () => {
  await withDirectory((directory) => {
    const store = openStore(directory);
    const { sha256: digest } = ingestFixture(store, 'junit-basic');
    const other = ingestFixture(store, 'pair-junit').sha256;
    const blob = store.blobPath(digest);
    const bytes = readFileSync(blob);
    bytes[10] = bytes[10] === 0x41 ? 0x42 : 0x41;
    writeFileSync(blob, bytes);
    rmSync(store.blobPath(other));
    assert.deepEqual(
      store.verify().sort((a, b) => a.problem.localeCompare(b.problem)),
      [
        { sha256: digest, problem: 'digest-mismatch' },
        { sha256: other, problem: 'missing' },
      ].sort((a, b) => a.problem.localeCompare(b.problem)),
    );
    store.close();
  });
});

test('a full disk is reported clearly and loses nothing already stored', async () => {
  await withDirectory((directory) => {
    const store = openStore(directory);
    ingestFixture(store, 'junit-basic');
    const before = store.dumpDerived();
    const entry = manifest.find((candidate) => candidate.id === 'pair-junit');
    assert.ok(entry);
    assert.throws(
      () =>
        store.ingest(bytesFor(entry), {
          observedAt: OBSERVED,
          hooks: {
            writeBlob() {
              throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
            },
          },
        }),
      (error) => error instanceof StoreError && error.code === 'storage-full',
    );
    assert.equal(store.dumpDerived(), before);
    const leftovers = readdirSync(path.join(directory, 'blobs'), { recursive: true }).filter(
      (name) => String(name).includes('.tmp-'),
    );
    assert.deepEqual(leftovers, [], 'no temporary file is left behind');
    store.close();
  });
});

test('a full database is reported clearly and rolls the whole ingest back', async () => {
  await withDirectory((directory) => {
    const first = openStore(directory);
    ingestFixture(first, 'junit-basic');
    const before = first.dumpDerived();
    const pages = Number(
      /** @type {{ page_count: number }} */ (first.db.prepare('pragma page_count').get())
        .page_count,
    );
    first.close();

    const limited = openStore(directory, { maxPages: pages });
    const big = loadManifest().find((candidate) => candidate.id === 'junit-many-tests');
    assert.ok(big);
    assert.throws(
      () => limited.ingest(bytesFor(big), { observedAt: OBSERVED }),
      (error) => error instanceof StoreError && error.code === 'storage-full',
    );
    assert.equal(limited.dumpDerived(), before, 'nothing from the failed ingest is visible');
    limited.close();
  });
});

test('an error between the inserts and the commit rolls everything back and the store stays usable', async () => {
  await withDirectory((directory) => {
    const store = openStore(directory);
    ingestFixture(store, 'junit-basic');
    const before = store.dumpDerived();
    const entry = manifest.find((candidate) => candidate.id === 'pair-junit');
    assert.ok(entry);
    assert.throws(
      () =>
        store.ingest(bytesFor(entry), {
          observedAt: OBSERVED,
          hooks: {
            beforeCommit() {
              throw new Error('simulated failure after the inserts');
            },
          },
        }),
      /simulated failure/,
    );
    assert.equal(store.dumpDerived(), before, 'the partial ingest is gone');
    assert.equal(
      ingestFixture(store, 'pair-junit').status,
      'ingested',
      'and the store still works',
    );
    store.close();
  });
});

test('a newer schema is refused and left untouched', async () => {
  await withDirectory((directory) => {
    const first = openStore(directory);
    first.close();
    const raw = new DatabaseSync(path.join(directory, 'evidence.db'));
    raw.exec('pragma user_version = 99');
    raw.close();
    assert.throws(
      () => openStore(directory),
      (error) => error instanceof StoreError && error.code === 'schema-too-new',
    );
    const check = new DatabaseSync(path.join(directory, 'evidence.db'));
    assert.equal(
      /** @type {{ user_version: number }} */ (check.prepare('pragma user_version').get())
        .user_version,
      99,
    );
    check.close();
  });
});

test('a migration copies the database first, and a failing one rolls back', async () => {
  await withDirectory((directory) => {
    const v1 = openStore(directory);
    ingestFixture(v1, 'junit-basic');
    v1.close();

    const withV2 = { ...MIGRATIONS, 4: 'alter table run add column note text;' };
    const v2 = openStore(directory, { migrations: withV2, target: 4 });
    assert.equal(
      /** @type {{ user_version: number }} */ (v2.db.prepare('pragma user_version').get())
        .user_version,
      4,
    );
    assert.equal(countOf(v2, 'run'), 1, 'data survives the migration');
    v2.close();

    const backup = new DatabaseSync(path.join(directory, 'evidence.db.bak-v3'));
    assert.equal(
      /** @type {{ user_version: number }} */ (backup.prepare('pragma user_version').get())
        .user_version,
      3,
    );
    assert.equal(
      /** @type {{ n: number }} */ (backup.prepare('select count(*) as n from run').get()).n,
      1,
    );
    backup.close();

    const broken = { ...withV2, 5: 'alter table no_such_table add column x text;' };
    assert.throws(
      () => openStore(directory, { migrations: broken, target: 5 }),
      (error) => error instanceof StoreError && error.code === 'migration-failed',
    );
    const after = openStore(directory, { migrations: withV2, target: 4 });
    assert.equal(
      /** @type {{ user_version: number }} */ (after.db.prepare('pragma user_version').get())
        .user_version,
      4,
    );
    after.close();
  });
});

test('derived rows can be dropped and rebuilt from the stored blobs alone', async () => {
  await withDirectory((directory) => {
    const store = openStore(directory);
    for (const entry of manifest) ingestFixture(store, entry.id);
    const before = store.dumpDerived();
    assert.ok(countOf(store, 'test_result') > 20, 'there is something to rebuild');
    store.rebuildDerived(OBSERVED);
    assert.equal(store.dumpDerived(), before);
    store.close();
  });
});

test('the node:sqlite facts this record relies on', async () => {
  await withDirectory((directory) => {
    const store = openStore(directory);
    assert.equal(
      /** @type {{ journal_mode: string }} */ (store.db.prepare('pragma journal_mode').get())
        .journal_mode,
      'wal',
    );
    assert.equal(
      /** @type {{ foreign_keys: number }} */ (store.db.prepare('pragma foreign_keys').get())
        .foreign_keys,
      1,
    );
    assert.equal(
      /** @type {{ synchronous: number }} */ (store.db.prepare('pragma synchronous').get())
        .synchronous,
      2,
      'full',
    );
    store.close();
  });
});
