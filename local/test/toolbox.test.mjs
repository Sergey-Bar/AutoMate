import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  chmodSync,
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
import { createEngine } from '../src/engine.mjs';
import { createRunner } from '../src/runner.mjs';
import { runRoutes, toolboxRoutes } from '../src/routes.mjs';
import { startServer } from '../src/server.mjs';
import { CATALOG_PATH, loadCatalog, recommend, validateCatalog } from '../src/toolbox.mjs';
import { assertWellFormed, call, session } from './http-support.mjs';
import { FILES_DIR } from './support.mjs';
import { URLSearchParams } from 'node:url';

const WINDOWS = process.platform === 'win32';
const fixture = (name) => readFileSync(path.join(FILES_DIR, name));
const shipped = () => JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
/** @param {(catalog: any) => void} change */
const mutated = (change) => {
  const catalog = shipped();
  change(catalog);
  return validateCatalog(catalog);
};

function cleanup(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // a handle can outlive the test on Windows
  }
}

function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-tb-repo-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

const VITEST_ONLY = {
  'package.json': JSON.stringify(
    { scripts: { test: 'vitest run' }, devDependencies: { vitest: '1' } },
    null,
    2,
  ),
  'vitest.config.ts': '',
  'pnpm-lock.yaml': '',
};

test('the shipped catalog passes its own checks', () => {
  const { catalog, errors } = loadCatalog();
  assert.deepEqual(errors, []);
  assert.ok(catalog.tools.length >= 3);
  for (const tool of catalog.tools) {
    assert.ok(['verified', 'unverified'].includes(tool.licence.status), tool.id);
    if (tool.licence.status === 'verified') {
      assert.match(tool.licence.source, /^https:\/\//);
      assert.match(tool.licence.verified, /^\d{4}-\d{2}-\d{2}$/);
    }
    for (const doc of tool.docs) assert.match(doc.url, /^https:\/\//);
  }
});

test('the catalog schema rejects what makes an entry more than data', () => {
  const cases = [
    [
      'an unknown field',
      (c) => (c.tools[0].postInstall = 'node setup.js'),
      /unknown field "postInstall"/,
    ],
    [
      'a command field',
      (c) => (c.tools[0].install.command = 'curl x | sh'),
      /unknown field "command"/,
    ],
    [
      'executable-looking text',
      (c) => (c.tools[0].purpose = 'Run $(rm -rf /) now'),
      /looks executable/,
    ],
    ['a backtick', (c) => (c.tools[0].verify = 'run `id`'), /looks executable/],
    ['a script tag', (c) => (c.tools[0].maintenance = '<script>x</script>'), /looks executable/],
    ['an http link', (c) => (c.tools[0].docs[0].url = 'http://example.test/x'), /https/],
    [
      'a link with credentials',
      (c) => (c.tools[0].docs[0].url = 'https://user:pw@example.test/x'),
      /credentials/,
    ],
    [
      'a package name that is a command',
      (c) => (c.tools[0].install.package = 'x; rm -rf /'),
      /package name/,
    ],
    ['an unknown install kind', (c) => (c.tools[0].install.kind = 'shell'), /install.kind/],
    ['an unknown rule', (c) => (c.tools[0].rule = 'anything'), /unknown rule/],
    ['a verified licence with no source', (c) => delete c.tools[0].licence.source, /source/],
    [
      'a verified licence with no date',
      (c) => (c.tools[0].licence.verified = 'yesterday'),
      /verified: must be a date/,
    ],
    [
      'an unverified licence that still names one',
      (c) => (c.tools[0].licence = { status: 'unverified', identifier: 'MIT' }),
      /unknown field "identifier"/,
    ],
    [
      'a licence status of "probably"',
      (c) => (c.tools[0].licence.status = 'probably'),
      /must be "verified" or "unverified"/,
    ],
    ['a duplicate id', (c) => (c.tools[1].id = c.tools[0].id), /duplicate id/],
    ['a missing field', (c) => delete c.tools[0].verify, /missing "verify"/],
    ['no documentation', (c) => (c.tools[0].docs = []), /documentation link/],
    ['an empty catalog', (c) => (c.tools = []), /non-empty/],
    ['a different schema', (c) => (c.schema = 2), /schema/],
    ['a top-level extra', (c) => (c.url = 'https://x.test'), /unknown field "url"/],
  ];
  assert.equal(validateCatalog(shipped()).ok, true);
  for (const [name, change, expected] of cases) {
    const result = mutated(change);
    assert.equal(result.ok, false, `${name} was accepted`);
    assert.ok(
      result.errors.some((e) => expected.test(e)),
      `${name}: ${result.errors.join(' | ')}`,
    );
  }
  assert.equal(validateCatalog(null).ok, false);
  assert.equal(validateCatalog([]).ok, false);
});

test('an invalid or unreadable catalog is refused whole', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-tb-cat-'));
  try {
    const bad = shipped();
    bad.tools[1].rule = 'nope';
    writeFileSync(path.join(directory, 'bad.json'), JSON.stringify(bad));
    const refused = loadCatalog(path.join(directory, 'bad.json'));
    assert.equal(refused.catalog, null, 'the valid entries are not used either');
    assert.ok(refused.errors.length > 0);
    writeFileSync(path.join(directory, 'broken.json'), '{ nope');
    assert.equal(loadCatalog(path.join(directory, 'broken.json')).catalog, null);
    assert.equal(loadCatalog(path.join(directory, 'missing.json')).catalog, null);
  } finally {
    cleanup(directory);
  }
});

/** A scan result for a recommendation test, built from the real scanner's output. */
async function scanned(files) {
  const root = repository(files);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-tb-data-'));
  const engine = createEngine({ dataDir });
  try {
    const result = await engine.scan(root);
    const view = engine.toolbox(result.repositoryId);
    return {
      view,
      scan: engine.store.latestScan(result.repositoryId),
      repositoryId: result.repositoryId,
      engine,
      root,
      dataDir,
    };
  } catch (error) {
    engine.close();
    throw error;
  }
}

async function withScanned(files, body) {
  const ctx = await scanned(files);
  try {
    await body(ctx);
  } finally {
    ctx.engine.close();
    cleanup(ctx.root);
    cleanup(ctx.dataDir);
  }
}

test('vitest with no coverage report gets a suggestion that carries its evidence and does not call it a problem', async () => {
  await withScanned(VITEST_ONLY, ({ view }) => {
    assert.equal(view.recommendations.length, 1);
    const r = view.recommendations[0];
    assert.equal(r.toolId, 'vitest-coverage-v8');
    assert.ok(r.evidence.length >= 2);
    assert.ok(
      r.evidence.some((e) => e.includes('package.json:') && e.includes('vitest')),
      'a line of package.json is cited',
    );
    assert.ok(
      r.evidence.some((e) => /no(ne)? is a coverage report|none is a coverage report/.test(e)),
      'the scan fact is cited',
    );
    assert.match(r.whyRelevant, /not a sign that anything is wrong/);
    assert.ok(
      !/\b(problem|missing coverage|bad|poor|insufficient)\b/i.test(
        r.whyRelevant.replace('not a sign that anything is wrong', ''),
      ),
      'no judgement wording',
    );
    assert.deepEqual(r.filesThatChange, ['package.json', 'pnpm-lock.yaml']);
    assert.equal(r.licence.status, 'verified');
    assert.ok(r.verify && r.rollback && r.configurationChange && r.limitations.length > 0);
  });
});

test('no suggestion when a coverage report exists, or an equivalent tool is already a dependency', async () => {
  await withScanned(
    { ...VITEST_ONLY, 'coverage/lcov.info': fixture('node-lcov.info') },
    ({ view }) => {
      assert.deepEqual(view.recommendations, []);
    },
  );
  await withScanned(
    {
      ...VITEST_ONLY,
      'package.json': JSON.stringify(
        {
          scripts: { test: 'vitest run' },
          devDependencies: { vitest: '1', '@vitest/coverage-istanbul': '1' },
        },
        null,
        2,
      ),
    },
    ({ view }) => {
      assert.deepEqual(
        view.recommendations,
        [],
        'the istanbul provider is equivalent to the V8 one',
      );
      assert.equal(view.suppressed.length, 1);
      assert.match(view.suppressed[0].reason, /vitest-coverage-istanbul is already a dependency/);
      assert.match(view.suppressed[0].reason, /package\.json:\d+/);
    },
  );
});

test('jest with no JUnit report is offered jest-junit; a JUnit report or the reporter already installed removes it', async () => {
  const jest = {
    'package.json': JSON.stringify({ scripts: { test: 'jest' }, devDependencies: { jest: '1' } }),
    'jest.config.js': '',
  };
  await withScanned(jest, ({ view }) => {
    assert.deepEqual(
      view.recommendations.map((r) => r.toolId),
      ['jest-junit'],
    );
    assert.deepEqual(
      view.recommendations[0].filesThatChange,
      ['package.json', 'package-lock.json'],
      'npm is the default with no lockfile',
    );
  });
  await withScanned({ ...jest, 'reports/junit.xml': fixture('junit-basic.xml') }, ({ view }) =>
    assert.deepEqual(view.recommendations, []),
  );
  await withScanned(
    {
      ...jest,
      'package.json': JSON.stringify({ devDependencies: { jest: '1', 'jest-junit': '1' } }),
    },
    ({ view }) => {
      assert.deepEqual(view.recommendations, []);
      assert.equal(view.suppressed[0].toolId, 'jest-junit');
    },
  );
});

test('pytest is offered pytest-cov, which changes no repository file', async () => {
  await withScanned({ 'pytest.ini': '[pytest]\n' }, ({ view, engine, repositoryId }) => {
    assert.deepEqual(
      view.recommendations.map((r) => r.toolId),
      ['pytest-cov'],
    );
    assert.deepEqual(view.recommendations[0].filesThatChange, []);
    assert.match(view.recommendations[0].installNote, /No file in the repository changes/);
    const request = engine.installRequest(repositoryId, view.recommendations[0].id);
    assert.deepEqual(request.argv, ['python', '-m', 'pip', 'install', 'pytest-cov']);
  });
  await withScanned(
    {
      'pyproject.toml':
        '[tool.pytest.ini_options]\naddopts = "--cov"\n[project.optional-dependencies]\ndev = ["pytest-cov"]\n',
    },
    ({ view }) => {
      assert.deepEqual(view.recommendations, [], 'pytest-cov in the manifest is recognised');
    },
  );
});

test('a recommendation never exists without evidence, and a project without the tool gets none', async () => {
  const catalog = loadCatalog().catalog;
  const bare = {
    relativePath: '.',
    ecosystem: 'node',
    packageManager: 'npm',
    findings: [{ subject: 'test-tool:vitest', evidence: [], confidence: 0.9, limits: [] }],
    commands: [],
  };
  assert.deepEqual(
    recommend({ projects: [bare], reports: [], catalog }).recommendations,
    [],
    'a finding with no evidence yields nothing',
  );
  const unrelated = {
    relativePath: '.',
    ecosystem: 'go',
    packageManager: null,
    findings: [
      { subject: 'test-tool:go-test', evidence: ['go.mod:1'], confidence: 0.9, limits: [] },
    ],
    commands: [],
  };
  assert.deepEqual(recommend({ projects: [unrelated], reports: [], catalog }).recommendations, []);
  await withScanned(VITEST_ONLY, ({ view }) => {
    for (const r of view.recommendations)
      assert.ok(r.evidence.length > 0 && r.evidence.every((e) => e.trim() !== ''));
  });
});

test('reports in another folder of a monorepo do not count for this project', async () => {
  await withScanned(
    {
      'packages/a/package.json': JSON.stringify({ devDependencies: { vitest: '1' } }),
      'packages/a/vitest.config.ts': '',
      'packages/b/coverage/lcov.info': fixture('node-lcov.info'),
    },
    ({ view }) => {
      assert.deepEqual(
        view.recommendations.map((r) => r.projectPath),
        ['packages/a'],
      );
      assert.deepEqual(view.recommendations[0].filesThatChange, [
        'packages/a/package.json',
        'packages/a/package-lock.json',
      ]);
    },
  );
});

test('the install request uses the right manager, never runs install scripts, and is unavailable for managers it does not know', async () => {
  await withScanned(VITEST_ONLY, ({ view, engine, repositoryId }) => {
    const request = engine.installRequest(repositoryId, view.recommendations[0].id);
    assert.deepEqual(request.argv, [
      'pnpm',
      'add',
      '--save-dev',
      '--ignore-scripts',
      '@vitest/coverage-v8',
    ]);
    assert.equal(request.cwd, '.');
    assert.ok(request.deadlineSeconds > 0, 'a deadline is part of the request');
  });
  const { 'pnpm-lock.yaml': _pnpm, ...withoutPnpm } = VITEST_ONLY;
  await withScanned({ ...withoutPnpm, 'yarn.lock': '' }, ({ view, engine, repositoryId }) => {
    assert.equal(view.recommendations[0].installSupported, false);
    assert.equal(engine.installRequest(repositoryId, view.recommendations[0].id), null);
    assert.match(view.recommendations[0].installNote, /yarn/);
  });
  await withScanned(VITEST_ONLY, ({ engine, repositoryId }) => {
    assert.equal(engine.installRequest(repositoryId, 'unknown@.'), null);
    assert.equal(engine.installRequest('nope', 'x'), null);
  });
});

test('a refused catalog means no suggestions, and the engine says why', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-tb-cat-'));
  const root = repository(VITEST_ONLY);
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-tb-data-'));
  try {
    const bad = shipped();
    bad.tools[0].install.command = 'x';
    writeFileSync(path.join(directory, 'tools.json'), JSON.stringify(bad));
    const engine = createEngine({ dataDir, catalogFile: path.join(directory, 'tools.json') });
    const scan = await engine.scan(root);
    const view = engine.toolbox(scan.repositoryId);
    assert.deepEqual(view.recommendations, []);
    assert.ok(view.catalogErrors.length > 0);
    assert.equal(engine.installRequest(scan.repositoryId, 'x'), null);
    engine.close();
  } finally {
    cleanup(directory);
    cleanup(root);
    cleanup(dataDir);
  }
});

/** A package-manager stand-in that records when it is run. */
function fakeManager(directory, name) {
  const marker = path.join(directory, `${name}-was-run.txt`);
  if (WINDOWS) {
    writeFileSync(path.join(directory, `${name}.cmd`), `@echo off\r\necho %* > "${marker}"\r\n`);
  } else {
    writeFileSync(path.join(directory, name), `#!/bin/sh\necho "$@" > "${marker}"\n`);
    chmodSync(path.join(directory, name), 0o755);
  }
  return marker;
}

function digest(root) {
  const hash = createHash('sha256');
  const walk = (directory) => {
    for (const name of readdirSync(directory).sort()) {
      const full = path.join(directory, name);
      hash.update(`${path.relative(root, full)}|${String(statSync(full).mtimeMs)}|`);
      if (statSync(full).isDirectory()) walk(full);
      else hash.update(readFileSync(full));
    }
  };
  walk(root);
  return hash.digest('hex');
}

test('an install goes through the runner: previewing changes nothing, and it runs only after the exact preview is confirmed', async () => {
  const tools = mkdtempSync(path.join(tmpdir(), 'automate-tb-tools-'));
  const marker = fakeManager(tools, 'pnpm');
  try {
    await withScanned(VITEST_ONLY, async ({ engine, view, root, repositoryId, dataDir }) => {
      const runner = createRunner({
        engine,
        dataDir,
        host: {
          ...process.env,
          PATH: `${tools}${path.delimiter}${process.env.PATH ?? ''}`,
          Path: `${tools}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ''}`,
        },
      });
      const request = engine.installRequest(repositoryId, view.recommendations[0].id);
      const before = digest(root);
      const { plan, consentDigest } = await runner.preview(request);
      assert.deepEqual(plan.argv, [
        'pnpm',
        'add',
        '--save-dev',
        '--ignore-scripts',
        '@vitest/coverage-v8',
      ]);
      assert.match(plan.notice, /not isolated/);
      assert.equal(digest(root), before, 'previewing wrote nothing to the repository');
      assert.throws(() => statSync(marker), 'the package manager was not run by the preview');

      await assert.rejects(runner.start({ ...request, consentDigest: 'x' }), /not what was shown/);
      assert.throws(() => statSync(marker), 'a refused start did not run it either');

      const { id } = await runner.start({ ...request, consentDigest });
      await runner.whenDone(id);
      assert.equal(runner.get(id)?.state, 'succeeded');
      assert.match(
        readFileSync(marker, 'utf8'),
        /add --save-dev --ignore-scripts @vitest\/coverage-v8/,
      );
    });
  } finally {
    cleanup(tools);
  }
});

test('the toolbox page and API show a suggestion with its evidence and hand the install to the runner preview', async () => {
  const tools = mkdtempSync(path.join(tmpdir(), 'automate-tb-tools-'));
  fakeManager(tools, 'pnpm');
  try {
    await withScanned(VITEST_ONLY, async ({ engine, repositoryId, dataDir }) => {
      const runner = createRunner({
        engine,
        dataDir,
        host: {
          ...process.env,
          PATH: `${tools}${path.delimiter}${process.env.PATH ?? ''}`,
          Path: `${tools}${path.delimiter}${process.env.Path ?? process.env.PATH ?? ''}`,
        },
      });
      const server = await startServer({
        engine,
        routes: [runRoutes({ engine, runner }), toolboxRoutes({ engine })],
      });
      try {
        const auth = { Authorization: `Bearer ${server.token}` };
        const headers = await session(server, auth);
        const page = await call(server, { path: '/toolbox', headers });
        assert.equal(page.status, 200);
        assertWellFormed(assert, page.body, 'toolbox');
        assert.match(page.body, /Consider Vitest coverage/);
        assert.match(page.body, /package\.json:\d+/);
        assert.match(page.body, /Review the install/);
        assert.match(page.body, /Nothing is installed until you confirm/);
        assert.match(
          page.body,
          /read from <a href="https:\/\/raw\.githubusercontent\.com\/vitest-dev/,
        );

        const catalog = JSON.parse(
          (await call(server, { path: '/api/v1/toolbox/catalog', headers: auth })).body,
        );
        assert.equal(catalog.catalog.tools.length, 3);
        const list = JSON.parse(
          (
            await call(server, {
              path: `/api/v1/repositories/${repositoryId}/recommendations`,
              headers: auth,
            })
          ).body,
        );
        assert.equal(list.recommendations.length, 1);
        const asked = await call(server, {
          path: `/api/v1/repositories/${repositoryId}/recommendations/install-request?id=${encodeURIComponent(
            list.recommendations[0].id,
          )}`,
          headers: auth,
        });
        assert.equal(JSON.parse(asked.body).request.argv[0], 'pnpm');
        assert.equal(
          (
            await call(server, {
              path: `/api/v1/repositories/${repositoryId}/recommendations/install-request?id=nope`,
              headers: auth,
            })
          ).status,
          404,
        );
        assert.equal(
          (await call(server, { path: '/api/v1/repositories/nope/recommendations', headers: auth }))
            .status,
          404,
        );

        // The hidden fields on the page are exactly what the runner's preview form takes.
        const hidden = Object.fromEntries(
          [...page.body.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)">/g)].map(
            (m) => [m[1], m[2].replaceAll('&#39;', "'")],
          ),
        );
        const preview = await call(server, {
          method: 'POST',
          path: '/ui/runs/preview',
          headers,
          body: new URLSearchParams(hidden).toString(),
        });
        assert.equal(preview.status, 200);
        assert.match(preview.body, /Confirm what will run/);
        assert.match(preview.body, /--ignore-scripts/);
        assert.deepEqual(runner.list(), [], 'nothing ran');
      } finally {
        await server.close();
      }
    });
  } finally {
    cleanup(tools);
  }
});

test('the toolbox page for an unscanned repository, no repositories, and a refused catalog are all well formed', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'automate-tb-cat-'));
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-tb-data-'));
  const root = repository({ 'README.md': 'x' });
  try {
    writeFileSync(path.join(directory, 'tools.json'), '{ broken');
    for (const [name, catalogFile, scan] of [
      ['empty', undefined, false],
      ['scanned', undefined, true],
      ['refused', path.join(directory, 'tools.json'), true],
    ]) {
      const data = mkdtempSync(path.join(dataDir, 'e-'));
      const engine = createEngine({
        dataDir: data,
        ...(catalogFile === undefined ? {} : { catalogFile }),
      });
      if (scan) await engine.scan(root);
      const server = await startServer({ engine, routes: [toolboxRoutes({ engine })] });
      try {
        const headers = await session(server, { Authorization: `Bearer ${server.token}` });
        const page = await call(server, { path: '/toolbox', headers });
        assert.equal(page.status, 200, name);
        assertWellFormed(assert, page.body, name);
        if (name === 'refused') assert.match(page.body, /The catalog was refused/);
        if (name === 'scanned') assert.match(page.body, /No suggestions from this scan/);
        if (name === 'empty') assert.match(page.body, /Add a repository first/);
      } finally {
        await server.close();
        engine.close();
      }
    }
  } finally {
    cleanup(directory);
    cleanup(dataDir);
    cleanup(root);
  }
});
