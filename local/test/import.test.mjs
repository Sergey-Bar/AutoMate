import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEngine } from '../src/engine.mjs';
import { importRoutes } from '../src/routes.mjs';
import { startServer } from '../src/server.mjs';
import { assertWellFormed, call, session } from './http-support.mjs';
import { FILES_DIR } from './support.mjs';
import { buildZip } from './zip-builder.mjs';
import { URLSearchParams } from 'node:url';

const fixture = (name) => readFileSync(path.join(FILES_DIR, name));
const COBERTURA = `<?xml version="1.0"?><coverage line-rate="0.5" lines-valid="2" lines-covered="1" version="1" timestamp="1"><packages><package name="p"><classes><class name="A" filename="a.py"><methods/><lines><line number="1" hits="1"/><line number="2" hits="0"/></lines></class></classes></package></packages></coverage>`;

function cleanup(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // a handle can outlive the test on Windows
  }
}

async function withEngine(files, body) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-im-repo-'));
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-im-data-'));
  const work = mkdtempSync(path.join(tmpdir(), 'automate-im-work-'));
  for (const [relative, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    writeFileSync(path.join(root, relative), content);
  }
  const engine = createEngine({ dataDir });
  try {
    const scanned = await engine.scan(root);
    await body({ engine, root, work, repositoryId: scanned.repositoryId });
  } finally {
    engine.close();
    cleanup(root);
    cleanup(dataDir);
    cleanup(work);
  }
}

const archive = (work, name, specs) => {
  const file = path.join(work, name);
  writeFileSync(file, buildZip(specs));
  return file;
};

test("reports inside a CI artifact archive are imported, kept beside the repository's own, and shown on the dashboard", async () => {
  await withEngine(
    { 'reports/junit.xml': fixture('junit-basic.xml') },
    async ({ engine, work, repositoryId, root }) => {
      const before = readdirSync(root, { recursive: true }).sort();
      const file = archive(work, 'ci-artifacts.zip', [
        { name: 'build/log.txt', data: 'not a report' },
        { name: 'artifacts/coverage/cobertura.xml', data: COBERTURA },
        { name: 'artifacts/test-results/junit.xml', data: fixture('junit-truncated.xml') },
        { name: 'src/readme.md', data: 'x' },
        { name: 'artifacts/', data: '', method: 0 },
      ]);
      const result = await engine.importArchive(repositoryId, file);
      assert.equal(result.status, 'complete');
      assert.equal(result.imported, 2);
      assert.equal(
        result.skipped,
        2,
        'files that do not look like reports are not read as reports',
      );
      assert.deepEqual(result.refused, []);
      assert.deepEqual(
        readdirSync(root, { recursive: true }).sort(),
        before,
        'the repository is unchanged',
      );

      const dashboard = engine.dashboard(repositoryId);
      const kinds = dashboard.items.map((i) => i.result.format).sort();
      assert.deepEqual(kinds, ['cobertura-xml', 'junit-xml', 'junit-xml']);
      const coverage = dashboard.items.find((i) => i.result.format === 'cobertura-xml');
      assert.equal(coverage.result.totals.lines.percent, 50);
      const scan = engine.store.latestScan(repositoryId);
      assert.equal(scan.summary.source, 'import');
      assert.ok(
        scan.summary.reports.some(
          (r) => r.path === 'zip:ci-artifacts.zip!/artifacts/coverage/cobertura.xml',
        ),
      );
      assert.ok(
        scan.summary.reports.some((r) => r.path === 'reports/junit.xml'),
        'the earlier reports are kept',
      );
      assert.equal(scan.summary.projects.length, dashboard.scan.summary.projects.length);
    },
  );
});

test('importing the same archive again changes nothing, and a new one under the same name replaces its own entries only', async () => {
  await withEngine(
    { 'reports/junit.xml': fixture('junit-basic.xml') },
    async ({ engine, work, repositoryId }) => {
      const one = archive(work, 'ci.zip', [
        { name: 'r/junit.xml', data: fixture('junit-truncated.xml') },
      ]);
      await engine.importArchive(repositoryId, one);
      const again = await engine.importArchive(repositoryId, one);
      assert.equal(again.status, 'complete');
      const names = engine.store
        .latestScan(repositoryId)
        .summary.reports.map((r) => r.path)
        .sort();
      assert.deepEqual(names, ['reports/junit.xml', 'zip:ci.zip!/r/junit.xml']);
      const runs = engine.store.db.prepare('select count(*) as n from run').get().n;
      assert.equal(runs, 2, 'no duplicate rows');

      archive(work, 'ci.zip', [{ name: 'r/junit-other.xml', data: fixture('junit-basic.xml') }]);
      await engine.importArchive(repositoryId, path.join(work, 'ci.zip'));
      const after = engine.store
        .latestScan(repositoryId)
        .summary.reports.map((r) => r.path)
        .sort();
      assert.deepEqual(
        after,
        ['reports/junit.xml', 'zip:ci.zip!/r/junit-other.xml'],
        'the old entries of that archive name are replaced',
      );
    },
  );
});

test('hostile archives are refused or partly refused with reasons, and nothing is written outside the data directory', async () => {
  await withEngine({}, async ({ engine, work, repositoryId, root }) => {
    const hostile = archive(work, 'bad.zip', [
      { name: '../../escape/junit.xml', data: fixture('junit-basic.xml') },
      { name: 'crc/junit.xml', data: 'x', crc: 1 },
      { name: 'enc/junit.xml', data: 'x', flags: 0x801 },
    ]);
    const result = await engine.importArchive(repositoryId, hostile);
    assert.equal(result.status, 'partial');
    assert.deepEqual(result.refused.map((r) => r.reason).sort(), ['crc-mismatch', 'encrypted']);
    assert.equal(result.imported, 1, 'a traversal-looking name is only a label');
    assert.ok(
      engine.store
        .latestScan(repositoryId)
        .summary.reports[0].path.includes('!/../../escape/junit.xml'),
    );
    assert.deepEqual(readdirSync(root), []);
    assert.deepEqual(
      readdirSync(path.dirname(work)).filter((n) => n === 'escape'),
      [],
    );

    writeFileSync(path.join(work, 'notzip.zip'), 'plainly not an archive, just some text to read');
    assert.deepEqual(await engine.importArchive(repositoryId, path.join(work, 'notzip.zip')), {
      status: 'failed',
      reason: 'not-a-zip',
    });
    assert.deepEqual(await engine.importArchive(repositoryId, path.join(work, 'missing.zip')), {
      status: 'failed',
      reason: 'not-a-file',
    });
    assert.deepEqual(await engine.importArchive(repositoryId, work), {
      status: 'failed',
      reason: 'not-a-file',
    });
    assert.deepEqual(await engine.importArchive('nope', hostile), {
      status: 'failed',
      reason: 'no-such-repository',
    });
  });
});

test('an archive that expands past the limits is stopped before it is stored', async () => {
  await withEngine({}, async ({ engine, work, repositoryId }) => {
    const { deflateRawSync } = await import('node:zlib');
    const raw = deflateRawSync(Buffer.alloc(20 * 1024 * 1024, 0x20));
    const file = archive(work, 'bomb.zip', [
      { name: 'huge/junit.xml', data: 'tiny', raw, size: 4, compressedSize: raw.length },
    ]);
    const result = await engine.importArchive(repositoryId, file);
    assert.equal(result.imported, 0);
    assert.deepEqual(
      result.refused.map((r) => r.reason),
      ['inflates-past-declared-size'],
    );
    assert.equal(
      engine.store.db.prepare('select count(*) as n from artifact').get().n,
      0,
      'nothing was stored',
    );
  });
});

test('through the server: the form and the API import, the page is well formed, and a cookie alone cannot import', async () => {
  await withEngine(
    { 'reports/junit.xml': fixture('junit-basic.xml') },
    async ({ engine, work, repositoryId }) => {
      const server = await startServer({ engine, routes: [importRoutes({ engine })] });
      try {
        const auth = { Authorization: `Bearer ${server.token}` };
        const headers = await session(server, auth);
        const file = archive(work, 'ci.zip', [{ name: 'a/cobertura.xml', data: COBERTURA }]);

        const dashboard = await call(server, { path: `/repositories/${repositoryId}`, headers });
        assertWellFormed(assert, dashboard.body, 'dashboard with import form');
        assert.match(dashboard.body, /Import a CI artifact archive/);

        const forged = await call(server, {
          method: 'POST',
          path: '/ui/imports',
          headers: { Cookie: headers.Cookie, 'Content-Type': headers['Content-Type'] },
          body: new URLSearchParams({ repositoryId, path: file }).toString(),
        });
        assert.equal(forged.status, 403);
        assert.equal(
          engine.store.db.prepare('select count(*) as n from artifact').get().n,
          1,
          'nothing imported',
        );

        const form = await call(server, {
          method: 'POST',
          path: '/ui/imports',
          headers,
          body: new URLSearchParams({ repositoryId, path: file }).toString(),
        });
        assert.equal(form.status, 303);
        const shown = await call(server, { path: String(form.headers.location), headers });
        assert.match(shown.body, /cobertura-xml/);

        const json = { ...auth, 'Content-Type': 'application/json' };
        const api = await call(server, {
          method: 'POST',
          path: `/api/v1/repositories/${repositoryId}/imports`,
          headers: json,
          body: JSON.stringify({ path: file }),
        });
        assert.equal(api.status, 200);
        assert.equal(JSON.parse(api.body).imported, 1);
        const missing = await call(server, {
          method: 'POST',
          path: `/api/v1/repositories/${repositoryId}/imports`,
          headers: json,
          body: JSON.stringify({ path: path.join(work, 'missing.zip') }),
        });
        assert.equal(missing.status, 400);
        assert.equal(JSON.parse(missing.body).error.code, 'IMPORT_FAILED');
        assert.equal(
          (
            await call(server, {
              method: 'POST',
              path: '/api/v1/repositories/nope/imports',
              headers: json,
              body: JSON.stringify({ path: file }),
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await call(server, {
              method: 'POST',
              path: `/api/v1/repositories/${repositoryId}/imports`,
              headers: json,
              body: 'nope',
            })
          ).status,
          400,
        );
      } finally {
        await server.close();
      }
    },
  );
});
