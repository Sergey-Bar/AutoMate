import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEngine, readHead } from '../src/engine.mjs';
import { FILES_DIR } from './support.mjs';

const fixture = (name) => readFileSync(path.join(FILES_DIR, name));

/**
 * @param {Record<string, string | Buffer>} files
 */
function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-engine-repo-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

function digest(root) {
  const hash = createHash('sha256');
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      const info = statSync(full);
      hash.update(`${path.relative(root, full)}|${String(info.mtimeMs)}|`);
      if (info.isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

/** @param {(ctx: { engine: ReturnType<typeof createEngine>, dataDir: string }) => Promise<void>} body */
async function withEngine(body) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-engine-data-'));
  const engine = createEngine({ dataDir, now: () => new Date('2026-10-19T12:00:00Z') });
  try {
    await body({ engine, dataDir });
  } finally {
    engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

const REPO = () =>
  repository({
    'package.json': JSON.stringify({
      scripts: { test: 'vitest run' },
      devDependencies: { vitest: '1' },
    }),
    'vitest.config.ts': '',
    'reports/junit.xml': fixture('junit-basic.xml'),
    'reports/copy.xml': fixture('junit-basic-copy.xml'),
    'coverage/lcov.info': fixture('node-lcov.info'),
    'reports/notes-report.xml': '<html>not a report</html>',
  });

test('a scan ingests reports, never writes to the repository, and the dashboard adds up', async () => {
  const root = REPO();
  try {
    await withEngine(async ({ engine }) => {
      const before = digest(root);
      const scanned = await engine.scan(root);
      assert.equal(scanned.status, 'complete');
      assert.equal(digest(root), before, 'the repository is unchanged');

      const dash = engine.dashboard(scanned.repositoryId);
      assert.ok(dash);
      assert.equal(dash.kpis.testsFound.value, 4, 'two byte-identical files are one report');
      assert.equal(dash.kpis.coverageByType.value.lines.percent, 87.76);
      assert.deepEqual(dash.kpis.reportsFound, {
        found: 4,
        read: 2,
        rejected: 1,
        duplicates: 1,
        unread: 0,
      });
      assert.equal(dash.kpis.toolsDetected.value[0]?.tool, 'vitest');
      assert.deepEqual(
        dash.rejected.map((r) => r.reason),
        ['not-junit'],
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('rescanning is idempotent and stored bytes equal the files', async () => {
  const root = REPO();
  try {
    await withEngine(async ({ engine }) => {
      const first = await engine.scan(root);
      const dash1 = engine.dashboard(first.repositoryId);
      const second = await engine.scan(root);
      assert.equal(second.repositoryId, first.repositoryId);
      const dash2 = engine.dashboard(second.repositoryId);
      assert.deepEqual(dash2.kpis.testsFound, dash1.kpis.testsFound);
      const sha = createHash('sha256').update(fixture('junit-basic.xml')).digest('hex');
      assert.deepEqual(Buffer.from(engine.rawReport(sha) ?? []), fixture('junit-basic.xml'));
      assert.deepEqual(engine.store.verify(), []);
      assert.equal(engine.rawReport('not-a-digest'), null);
      assert.equal(engine.rawReport('0'.repeat(64)), null);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('a repository with no reports shows what was found and no zero-filled metric', async () => {
  const root = repository({
    'package.json': JSON.stringify({ devDependencies: { jest: '1' } }),
    'jest.config.js': '',
  });
  try {
    await withEngine(async ({ engine }) => {
      const scanned = await engine.scan(root);
      const dash = engine.dashboard(scanned.repositoryId);
      assert.equal(dash.kpis.testsFound.value, null);
      assert.equal(dash.kpis.testsFound.missing, 'no-reports-found');
      assert.equal(dash.kpis.toolsDetected.value[0]?.tool, 'jest');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('the same execution reported in two formats is counted once and contradictions are listed', async () => {
  const root = repository({
    'reports/a.xml': fixture('contradict-junit.xml'),
    'test-results/b.json': fixture('contradict-playwright.json'),
    // Reports written minutes apart, under one commit, is the evidence grouping needs.
    '.git/HEAD': 'ref: refs/heads/main\n',
    '.git/refs/heads/main': '4a5b6c7d8e9f\n',
  });
  try {
    await withEngine(async ({ engine }) => {
      const scanned = await engine.scan(root);
      const dash = engine.dashboard(scanned.repositoryId);
      assert.equal(dash.repository.commit_ref, '4a5b6c7d8e9f');
      assert.equal(dash.reconciliation.groups.length, 1);
      assert.equal(dash.kpis.testsFound.value, 2, 'counted once');
      assert.equal(dash.kpis.disagreements.value, 1);
      assert.equal(dash.reconciliation.disagreements[0]?.chosen, null);
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('events carry increasing cursors and a reconnecting client receives what it missed', async () => {
  const root = REPO();
  try {
    await withEngine(async ({ engine }) => {
      await engine.scan(root);
      const all = engine.events.since(0);
      assert.ok(all.length >= 3);
      assert.deepEqual(
        all.map((e) => e.cursor),
        all.map((_, i) => i + 1),
      );
      assert.equal(all[0]?.type, 'scan.started');
      assert.equal(all.at(-1)?.type, 'scan.completed');
      const missed = engine.events.since(all[1]?.cursor ?? 0);
      assert.equal(missed.length, all.length - 2);
      const correlation = new Set(all.map((e) => /** @type {any} */ (e.data).correlation));
      assert.equal(correlation.size, 1, 'one correlation id links the whole scan');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('a path that is not a repository fails with a reason and registers nothing', async () => {
  await withEngine(async ({ engine }) => {
    const result = await engine.scan(path.join(tmpdir(), 'automate-no-such-directory'));
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'not-a-directory');
    assert.deepEqual(engine.listRepositories(), []);
  });
});

test('a cancelled scan says so', async () => {
  const root = REPO();
  try {
    await withEngine(async ({ engine }) => {
      const controller = new globalThis.AbortController();
      controller.abort();
      const result = await engine.scan(root, { signal: controller.signal });
      assert.equal(result.status, 'cancelled');
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('the commit is read from .git without running anything', () => {
  const root = repository({
    '.git/HEAD': 'ref: refs/heads/x\n',
    '.git/packed-refs': '# pack\nabc123def456 refs/heads/x\n',
  });
  try {
    assert.equal(readHead(root), 'abc123def456');
    assert.equal(readHead(path.join(root, 'nothing')), null);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('the engine makes no network request', () => {
  const source = ['engine.mjs', 'detect.mjs', 'analysis.mjs', 'store.mjs', 'reconcile.mjs'].map(
    (file) => readFileSync(path.join(path.resolve(import.meta.dirname, '..', 'src'), file), 'utf8'),
  );
  for (const text of source) {
    assert.ok(
      !/node:(?:http|https|net|dns|tls|dgram|http2)|fetch\(|XMLHttpRequest|WebSocket/.test(text),
    );
  }
});
