import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEngine } from '../src/engine.mjs';
import { RunnerError, createRunner, isAlive, quoteWindowsArg } from '../src/runner.mjs';
import { FILES_DIR } from './support.mjs';
import { recorded, sleep, sweep, waitFor } from './tree-harness.mjs';

const WINDOWS = process.platform === 'win32';
const FIXTURE = path.resolve(import.meta.dirname, 'runner-fixture.mjs');
const JUNIT = path.join(FILES_DIR, 'junit-basic.xml');
const NODE = process.execPath;

/** @param {string} directory */
function cleanup(directory) {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
  } catch {
    // a handle can outlive the test on Windows; the system temp folder is not ours to fight
  }
}

/**
 * @param {(ctx: { runner: ReturnType<typeof createRunner>, engine: ReturnType<typeof createEngine>,
 *   root: string, repositoryId: string, dataDir: string, req: (args: string[], extra?: object) => any }) => Promise<void>} body
 * @param {Partial<Parameters<typeof createRunner>[0]> & { files?: Record<string, string> }} [options]
 */
async function withRunner(body, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-run-repo-'));
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-run-data-'));
  for (const [relative, content] of Object.entries(options.files ?? {})) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  const engine = createEngine({ dataDir });
  try {
    const scanned = await engine.scan(root);
    const repositoryId = /** @type {string} */ (scanned.repositoryId);
    const { files: _files, ...runnerOptions } = options;
    const runner = createRunner({ engine, dataDir, ...runnerOptions });
    /** @type {(args: string[], extra?: object) => any} */
    const req = (args, extra = {}) => ({
      repositoryId,
      argv: [NODE, FIXTURE, ...args],
      deadlineSeconds: 30,
      ...extra,
    });
    await body({ runner, engine, root, repositoryId, dataDir, req });
  } finally {
    engine.close();
    cleanup(root);
    cleanup(dataDir);
  }
}

/**
 * Previews, then starts with the digest the preview returned.
 *
 * @param {ReturnType<typeof createRunner>} runner
 * @param {any} request
 */
async function run(runner, request) {
  const { consentDigest } = await runner.preview(request);
  const { id } = await runner.start({ ...request, consentDigest });
  return id;
}

/**
 * @param {Promise<unknown>} promise
 * @param {string} code
 */
async function refused(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof RunnerError && error.code === code,
    `expected ${code}`,
  );
}

test('a preview shows exactly what would run, names the variables and never their values', async () => {
  await withRunner(async ({ runner, req }) => {
    const { plan, consentDigest } = await runner.preview(
      req(['print', 'hi'], {
        env: { MY_API_TOKEN: 'sekret-value-1234' },
        artifactPaths: ['reports/junit.xml'],
      }),
    );
    assert.match(consentDigest, /^[0-9a-f]{64}$/);
    assert.deepEqual(plan.argv.slice(1), [FIXTURE, 'print', 'hi']);
    assert.equal(plan.resolvedExecutable, NODE);
    assert.deepEqual(plan.explicitEnvNames, ['MY_API_TOKEN']);
    assert.equal(plan.deadlineSeconds, 30);
    assert.match(plan.notice, /not isolated/);
    assert.ok(!JSON.stringify(plan).includes('sekret-value-1234'), 'no value in the preview');
    assert.ok(!(await runner.preview(req(['print', 'hi']))).consentDigest.includes(consentDigest));
  });
});

test('a command that succeeds is recorded with its redacted output and its exit code', async () => {
  await withRunner(async ({ runner, req }) => {
    const id = await run(runner, req(['print', 'hello world']));
    await runner.whenDone(id);
    const record = runner.get(id);
    assert.equal(record?.state, 'succeeded');
    assert.equal(record?.exitCode, 0);
    assert.equal(runner.output(id, 'stdout').text.trim(), 'hello world');
    assert.equal(runner.list().length, 1);
    assert.equal(runner.activeId(), null);
  });
});

test('a failing command is recorded as failed with its exit code', async () => {
  await withRunner(async ({ runner, req }) => {
    const id = await run(runner, req(['exit', '3']));
    await runner.whenDone(id);
    const record = runner.get(id);
    assert.equal(record?.state, 'failed');
    assert.equal(record?.exitCode, 3);
    assert.match(record?.reason ?? '', /exit code 3/);
  });
});

test('consent is bound to the exact request: any change after the preview is refused and nothing runs', async () => {
  await withRunner(async ({ runner, req }) => {
    const shown = req(['print', 'one']);
    const { consentDigest } = await runner.preview(shown);
    for (const changed of [
      req(['print', 'two']),
      req(['print', 'one'], { deadlineSeconds: 31 }),
      req(['print', 'one'], { env: { X_Y: '1' } }),
      req(['print', 'one'], { artifactPaths: ['a.xml'] }),
      req(['print', 'one'], { passThrough: ['PATH'] }),
    ]) {
      await refused(runner.start({ ...changed, consentDigest }), 'CONSENT_MISMATCH');
    }
    await refused(runner.start({ ...shown }), 'CONSENT_MISMATCH');
    assert.deepEqual(runner.list(), [], 'no run was recorded');
    const id = (await runner.start({ ...shown, consentDigest })).id;
    await runner.whenDone(id);
  });
});

test('the same explicit variable with a different value is a different request', async () => {
  await withRunner(async ({ runner, req }) => {
    const a = await runner.preview(req(['print', 'x'], { env: { SOME_FLAG: 'a' } }));
    const b = await runner.preview(req(['print', 'x'], { env: { SOME_FLAG: 'b' } }));
    assert.notEqual(a.consentDigest, b.consentDigest);
  });
});

test('a deadline is mandatory and bounded', async () => {
  await withRunner(async ({ runner, req }) => {
    const { deadlineSeconds: _drop, ...without } = req(['print', 'x']);
    await refused(runner.preview(without), 'DEADLINE_REQUIRED');
    await refused(runner.preview(req(['print', 'x'], { deadlineSeconds: 0 })), 'INVALID_REQUEST');
    await refused(
      runner.preview(req(['print', 'x'], { deadlineSeconds: 999_999_999 })),
      'INVALID_REQUEST',
    );
    await refused(runner.preview(req(['print', 'x'], { deadlineSeconds: 1.5 })), 'INVALID_REQUEST');
  });
});

test('the working directory must be a folder inside the repository, by its resolved path', async () => {
  const outside = mkdtempSync(path.join(tmpdir(), 'automate-run-outside-'));
  try {
    await withRunner(
      async ({ runner, req, root }) => {
        mkdirSync(path.join(root, 'inner'));
        const ok = await runner.preview(req(['pwd'], { cwd: 'inner' }));
        assert.equal(ok.plan.cwd, path.join(root, 'inner'));
        await refused(runner.preview(req(['pwd'], { cwd: '..' })), 'CWD_OUTSIDE_REPOSITORY');
        await refused(
          runner.preview(req(['pwd'], { cwd: 'inner/../..' })),
          'CWD_OUTSIDE_REPOSITORY',
        );
        await refused(runner.preview(req(['pwd'], { cwd: outside })), 'CWD_OUTSIDE_REPOSITORY');
        await refused(runner.preview(req(['pwd'], { cwd: 'missing' })), 'CWD_OUTSIDE_REPOSITORY');
        symlinkSync(outside, path.join(root, 'link'), 'junction');
        await refused(runner.preview(req(['pwd'], { cwd: 'link' })), 'CWD_OUTSIDE_REPOSITORY');
      },
      { files: { 'package.json': '{}' } },
    );
  } finally {
    cleanup(outside);
  }
});

test('the command runs in the folder that was shown', async () => {
  await withRunner(async ({ runner, req, root }) => {
    mkdirSync(path.join(root, 'inner'));
    const id = await run(runner, req(['pwd'], { cwd: 'inner' }));
    await runner.whenDone(id);
    assert.equal(runner.get(id)?.state, 'succeeded');
    const printed = runner.output(id, 'stdout').text;
    assert.match(printed, /inner$/, 'the folder name survives redaction');
  });
});

test('arguments reach the command exactly as given: shell metacharacters are data', async () => {
  const tricky = [
    'plain',
    'with space',
    'a & echo pwned > pwned.txt',
    'a | b',
    '"quoted"',
    '%PATH%',
    '!VAR!',
    'trailing\\',
    'dir with space\\',
    'say "hi" \\"there\\"',
    '',
    '$(whoami)',
    '`id`',
    '; rm -rf /',
    'line\nbreak',
  ];
  await withRunner(async ({ runner, req, root }) => {
    const id = await run(runner, req(['args', ...tricky]));
    await runner.whenDone(id);
    assert.equal(runner.get(id)?.state, 'succeeded');
    assert.deepEqual(JSON.parse(runner.output(id, 'stdout').text), tricky);
    assert.ok(!existsSync(path.join(root, 'pwned.txt')), 'no shell interpreted the text');
  });
});

test('quoting follows the Windows command-line rules', () => {
  const cases = [
    ['plain', 'plain'],
    ['', '""'],
    ['a b', '"a b"'],
    ['a"b', '"a\\"b"'],
    ['a\\', 'a\\'],
    ['a b\\', '"a b\\\\"'],
    ['a\\"b', '"a\\\\\\"b"'],
  ];
  for (const [input, expected] of cases) assert.equal(quoteWindowsArg(input ?? ''), expected);
});

if (WINDOWS) {
  test('a .cmd launcher runs through cmd.exe only when no argument could be read by cmd.exe', async () => {
    await withRunner(
      async ({ runner, req, root }) => {
        const shim = '.\\tool.cmd';
        const request = (/** @type {string[]} */ args) => ({
          repositoryId: req([]).repositoryId,
          argv: [shim, ...args],
          deadlineSeconds: 30,
        });
        const id = await run(runner, request(['print', 'through', 'shim']));
        await runner.whenDone(id);
        assert.equal(runner.get(id)?.state, 'succeeded');
        assert.equal(runner.output(id, 'stdout').text.trim(), 'through shim');
        assert.equal((await runner.preview(request(['print', 'x']))).plan.viaCmdShim, true);
        for (const bad of ['a&b', 'a|b', 'a<b', 'a>b', 'a^b', '%PATH%', '!x!', 'a"b', 'a\nb']) {
          await refused(runner.preview(request(['print', bad])), 'UNSAFE_ARGUMENT');
        }
        assert.ok(!existsSync(path.join(root, 'b')), 'nothing was redirected into a file');
      },
      { files: { 'tool.cmd': `@echo off\r\n"${NODE}" "${FIXTURE}" %*\r\n` } },
    );
  });
}

test('a command that does not exist is refused at the preview', async () => {
  await withRunner(async ({ runner, req }) => {
    await refused(
      runner.preview({ ...req([]), argv: ['no-such-program-anywhere'] }),
      'EXECUTABLE_NOT_FOUND',
    );
  });
});

test('the child sees an allowlist, named variables and explicit ones, and nothing else from the parent', async () => {
  const host = { ...process.env, AUTOMATE_LEAK_CHECK: 'leak', AUTOMATE_PASSED: 'visible' };
  await withRunner(
    async ({ runner, req }) => {
      const id = await run(
        runner,
        req(['env'], { passThrough: ['AUTOMATE_PASSED'], env: { EXPLICIT_ONE: '1' } }),
      );
      await runner.whenDone(id);
      const names = /** @type {string[]} */ (JSON.parse(runner.output(id, 'stdout').text));
      assert.ok(names.includes('AUTOMATE_PASSED'));
      assert.ok(names.includes('EXPLICIT_ONE'));
      assert.ok(names.some((n) => n.toUpperCase() === 'PATH'));
      assert.ok(
        !names.includes('AUTOMATE_LEAK_CHECK'),
        'an unlisted parent variable does not reach the child',
      );
    },
    { host },
  );
});

test('a variable passed through that is not set is refused rather than passed empty', async () => {
  await withRunner(async ({ runner, req }) => {
    await refused(
      runner.preview(req(['env'], { passThrough: ['AUTOMATE_SURELY_UNSET_VARIABLE'] })),
      'INVALID_REQUEST',
    );
    await refused(runner.preview(req(['env'], { env: { 'bad name': '1' } })), 'INVALID_REQUEST');
  });
});

test('values of secret-looking variables and registered secrets never appear in output or history', async () => {
  const secret = 'hunter2-not-a-real-secret-value';
  const other = 'another-registered-value-98765';
  await withRunner(async ({ runner, req, dataDir }) => {
    const id = await run(
      runner,
      req(['getenv', 'MY_API_TOKEN'], { env: { MY_API_TOKEN: secret } }),
    );
    await runner.whenDone(id);
    const out = runner.output(id, 'stdout').text;
    assert.ok(!out.includes(secret), 'the secret is not in the output');
    assert.match(out, /\[redacted\]/);
    const files = readdirSync(path.join(dataDir, 'runs', id));
    assert.deepEqual(files.sort(), ['stderr.txt', 'stdout.txt'], 'the raw output is gone');
    for (const file of files)
      assert.ok(!readFileSync(path.join(dataDir, 'runs', id, file), 'utf8').includes(secret));

    const second = await run(runner, req(['print', '--value', other], { secrets: [other] }));
    await runner.whenDone(second);
    assert.ok(!runner.output(second, 'stdout').text.includes(other));
    assert.ok(!JSON.stringify(runner.get(second)).includes(other), 'nor in the stored command');
    assert.ok(!JSON.stringify(runner.get(id)).includes(secret), 'nor in the stored record');
  });
});

test('output shown while the command runs is redacted too', async () => {
  const secret = 'live-secret-value-abcdef123456';
  await withRunner(async ({ runner, req }) => {
    const id = await run(
      runner,
      req(['getenv', 'DEPLOY_TOKEN'], { env: { DEPLOY_TOKEN: secret }, deadlineSeconds: 30 }),
    );
    await runner.whenDone(id);
    assert.ok(!runner.output(id, 'stdout').text.includes(secret));

    const live = await run(runner, req(['sleep']));
    assert.ok(
      await waitFor(() => runner.output(live, 'stdout').text.includes('started'), 15_000),
      'output is visible while running',
    );
    assert.equal(runner.output(live, 'stdout').final, false);
    runner.cancel(live);
    await runner.whenDone(live);
  });
});

test('a deadline ends the command and records why', async () => {
  await withRunner(async ({ runner, req }) => {
    const started = Date.now();
    const id = await run(runner, req(['sleep'], { deadlineSeconds: 1 }));
    await runner.whenDone(id);
    const record = runner.get(id);
    assert.equal(record?.state, 'timed-out');
    assert.match(record?.reason ?? '', /deadline of 1 s/);
    assert.ok(Date.now() - started < 15_000);
    assert.equal(
      JSON.parse(record?.termination ?? 'null').rootGone,
      true,
      'the process that was started is confirmed gone',
    );
    assert.equal(runner.activeId(), null);
  });
});

test('cancelling ends the command AND everything it started', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automate-run-tree-'));
  const record = path.join(dir, 'pids.txt');
  try {
    await withRunner(async ({ runner, req }) => {
      const id = await run(runner, req(['tree', record], { deadlineSeconds: 60 }));
      assert.ok(await waitFor(() => recorded(record).length >= 3, 20_000), 'the tree started');
      const before = recorded(record);
      try {
        runner.cancel(id);
        await runner.whenDone(id);
        assert.equal(runner.get(id)?.state, 'cancelled');
        assert.ok(
          await waitFor(() => before.every((entry) => !isAlive(entry.pid)), 8000),
          'every process in the tree is gone',
        );
      } finally {
        sweep(before);
      }
    });
  } finally {
    cleanup(dir);
  }
});

if (WINDOWS) {
  test('ending a run also ends a tree started through a .cmd launcher, which killing only the child would leave running', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'automate-run-tree-'));
    const record = path.join(dir, 'pids.txt');
    try {
      await withRunner(
        async ({ runner, req }) => {
          const id = await run(runner, {
            repositoryId: req([]).repositoryId,
            argv: ['.\\tree.cmd', record],
            deadlineSeconds: 60,
          });
          assert.ok(await waitFor(() => recorded(record).length >= 3, 20_000), 'the tree started');
          const before = recorded(record);
          try {
            runner.cancel(id);
            await runner.whenDone(id);
            assert.ok(
              await waitFor(() => before.every((entry) => !isAlive(entry.pid)), 8000),
              'every process is gone',
            );
          } finally {
            sweep(before);
          }
        },
        { files: { 'tree.cmd': `@echo off\r\n"${NODE}" "${FIXTURE}" tree %1\r\n` } },
      );
    } finally {
      cleanup(dir);
    }
  });
}

test('a deadline also ends a whole tree', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'automate-run-tree-'));
  const record = path.join(dir, 'pids.txt');
  try {
    await withRunner(async ({ runner, req }) => {
      const id = await run(runner, req(['tree', record], { deadlineSeconds: 4 }));
      assert.ok(await waitFor(() => recorded(record).length >= 3, 20_000));
      const before = recorded(record);
      try {
        await runner.whenDone(id);
        assert.equal(runner.get(id)?.state, 'timed-out');
        assert.ok(await waitFor(() => before.every((entry) => !isAlive(entry.pid)), 8000));
      } finally {
        sweep(before);
      }
    });
  } finally {
    cleanup(dir);
  }
});

test('only one run at a time, and cancelling something that is not running is refused', async () => {
  await withRunner(async ({ runner, req }) => {
    await refused(
      Promise.resolve().then(() => runner.cancel('nope')),
      'NOT_RUNNING',
    );
    const first = await run(runner, req(['sleep']));
    await refused(run(runner, req(['print', 'second'])), 'BUSY');
    assert.equal(runner.list().length, 1, 'the refused run left no record');
    await refused(
      Promise.resolve().then(() => runner.cancel('someone-else')),
      'NOT_RUNNING',
    );
    runner.cancel(first);
    await runner.whenDone(first);
    const next = await run(runner, req(['print', 'now']));
    await runner.whenDone(next);
    assert.equal(runner.get(next)?.state, 'succeeded');
  });
});

test('a command that writes without limit is ended at the output limit', async () => {
  await withRunner(
    async ({ runner, req }) => {
      const id = await run(runner, req(['flood'], { deadlineSeconds: 60 }));
      await runner.whenDone(id);
      const record = runner.get(id);
      assert.equal(record?.state, 'output-limit');
      assert.match(record?.reason ?? '', /wrote more than 65536 bytes/);
      const shown = runner.output(id, 'stdout');
      assert.ok(shown.text.length <= runner.limits.tailBytes, 'what is served is bounded');
    },
    { limits: { maxOutputBytes: 64 * 1024, tailBytes: 8 * 1024 } },
  );
});

test('reports a run produced are collected; a missing one makes the collection partial, a stale one is named', async () => {
  await withRunner(async ({ runner, req, root, repositoryId, engine }) => {
    const stale = path.join(root, 'old', 'junit.xml');
    mkdirSync(path.dirname(stale), { recursive: true });
    writeFileSync(stale, readFileSync(JUNIT));
    const past = new Date(Date.now() - 3_600_000);
    utimesSync(stale, past, past);

    const id = await run(
      runner,
      req(['report', path.join(root, 'out', 'junit.xml'), JUNIT], {
        artifactPaths: ['out/junit.xml', 'out/missing.xml', 'old/junit.xml'],
      }),
    );
    await runner.whenDone(id);
    const { collection } = /** @type {any} */ (runner.get(id));
    assert.equal(collection.status, 'partial');
    const outcome = Object.fromEntries(
      collection.reports.map((/** @type {any} */ r) => [r.path, r.outcome]),
    );
    assert.match(outcome['out/junit.xml'], /^(ingested|already-ingested)$/);
    assert.equal(outcome['out/missing.xml'], 'missing');
    assert.equal(outcome['old/junit.xml'], 'stale');
    const dashboard = engine.dashboard(repositoryId);
    assert.ok(
      dashboard !== null && dashboard.items.length >= 1,
      'the dashboard sees what the run produced',
    );
  });
});

test('collection is complete only when every declared report is there, and a run that declares none says so', async () => {
  await withRunner(async ({ runner, req, root }) => {
    const ok = await run(
      runner,
      req(['report', path.join(root, 'r.xml'), JUNIT], { artifactPaths: ['r.xml'] }),
    );
    await runner.whenDone(ok);
    assert.equal(/** @type {any} */ (runner.get(ok)).collection.status, 'complete');
    const none = await run(runner, req(['print', 'x']));
    await runner.whenDone(none);
    assert.equal(/** @type {any} */ (runner.get(none)).collection.status, 'not-declared');
    const missing = await run(runner, req(['exit', '1'], { artifactPaths: ['never.xml'] }));
    await runner.whenDone(missing);
    assert.equal(/** @type {any} */ (runner.get(missing)).collection.status, 'none');
    assert.equal(
      runner.get(missing)?.state,
      'failed',
      'a failed run and a missing report are separate facts',
    );
  });
});

test('report paths must stay inside the repository', async () => {
  await withRunner(async ({ runner, req }) => {
    for (const bad of ['../x.xml', '/etc/x.xml', 'C:\\x.xml', 'a/../../x.xml']) {
      await refused(
        runner.preview(req(['print', 'x'], { artifactPaths: [bad] })),
        'INVALID_REQUEST',
      );
    }
  });
});

test('history survives a restart, and a run left running is marked crashed with its output redacted and the raw file removed', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-run-data-'));
  const root = mkdtempSync(path.join(tmpdir(), 'automate-run-repo-'));
  try {
    let id = '';
    let repositoryId = '';
    {
      const engine = createEngine({ dataDir });
      repositoryId = /** @type {string} */ ((await engine.scan(root)).repositoryId);
      const runner = createRunner({ engine, dataDir });
      id = await run(runner, {
        repositoryId,
        argv: [NODE, FIXTURE, 'print', 'kept'],
        deadlineSeconds: 30,
      });
      await runner.whenDone(id);
      // A run that never finished: a record still marked running, and raw output on disk.
      engine.store.insertExecution({
        id: 'abandoned',
        repositoryId,
        retryOf: null,
        argv: ['x'],
        cwd: root,
        envNames: [],
        deadlineMs: 1000,
        artifactPaths: [],
        state: 'running',
        startedAt: new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      });
      mkdirSync(path.join(dataDir, 'runs', 'abandoned'), { recursive: true });
      writeFileSync(
        path.join(dataDir, 'runs', 'abandoned', 'stdout.raw'),
        'password=hunter2hunter2\nfine line\n',
      );
      engine.close();
    }
    {
      const engine = createEngine({ dataDir });
      const runner = createRunner({ engine, dataDir });
      assert.equal(runner.get(id)?.state, 'succeeded', 'completed history is unchanged');
      assert.equal(runner.get('abandoned')?.state, 'crashed');
      assert.match(runner.get('abandoned')?.reason ?? '', /ended while this run was in progress/);
      const left = readdirSync(path.join(dataDir, 'runs', 'abandoned'));
      assert.deepEqual(left, ['stdout.txt'], 'the raw file is gone');
      const text = runner.output('abandoned', 'stdout').text;
      assert.ok(!text.includes('hunter2hunter2'));
      assert.match(text, /fine line/);
      assert.equal(runner.activeId(), null);
      engine.close();
    }
  } finally {
    cleanup(root);
    cleanup(dataDir);
  }
});

test('a retry is a new run linked to the old one and needs a new preview and consent', async () => {
  await withRunner(async ({ runner, req }) => {
    const first = await run(
      runner,
      req(['exit', '2'], { env: { SOME_FLAG: 'value' }, passThrough: ['PATH'] }),
    );
    await runner.whenDone(first);
    const { request, needsValues } = runner.retryRequest(first);
    assert.deepEqual(
      needsValues,
      ['SOME_FLAG'],
      'explicit values are not kept, so they are asked for again',
    );
    assert.deepEqual(request.passThrough, ['PATH']);
    await refused(
      runner.start({ ...request, consentDigest: 'not-the-digest' }),
      'CONSENT_MISMATCH',
    );
    const second = await run(runner, { ...request, env: { SOME_FLAG: 'value' } });
    await runner.whenDone(second);
    assert.equal(runner.get(second)?.retryOf, first);
    assert.equal(runner.get(first)?.retryOf, null);
    await refused(
      Promise.resolve().then(() => runner.retryRequest('nonexistent')),
      'RUN_NOT_FOUND',
    );
  });
});

test('a run whose command held a redacted value cannot be repeated automatically', async () => {
  await withRunner(async ({ runner, req }) => {
    const id = await run(runner, req(['print', 'password=hunter2hunter2']));
    await runner.whenDone(id);
    assert.ok(runner.get(id)?.argv.some((a) => a.includes('[redacted]')));
    await refused(
      Promise.resolve().then(() => runner.retryRequest(id)),
      'RETRY_NEEDS_INPUT',
    );
  });
});

test('a launcher that throws is recorded as launch-failed and does not leave the runner busy', async () => {
  await withRunner(
    async ({ runner, req }) => {
      const id = await run(runner, req(['print', 'x']));
      assert.equal(runner.get(id)?.state, 'launch-failed');
      assert.equal(runner.activeId(), null);
    },
    {
      launcher: () => {
        throw Object.assign(new Error('spawn failed'), { code: 'EACCES' });
      },
    },
  );
});

if (WINDOWS) {
  test('if the job object cannot be created the command is not run and the record says so', async () => {
    await withRunner(
      async ({ runner, req }) => {
        const id = await run(runner, req(['print', 'x']));
        await runner.whenDone(id);
        const record = runner.get(id);
        assert.equal(record?.state, 'refused');
        assert.match(record?.reason ?? '', /job object/);
        assert.match(record?.reason ?? '', /nothing was run/);
      },
      {
        launcher: () => ({
          pid: undefined,
          exited: Promise.resolve(3000102),
          terminate: () => Promise.resolve({ taskkillExit: null }),
        }),
      },
    );
  });

  test('a run whose root process cannot be confirmed gone says so', async () => {
    await withRunner(
      async ({ runner, req }) => {
        const id = await run(runner, req(['sleep'], { deadlineSeconds: 1 }));
        await runner.whenDone(id);
        const record = runner.get(id);
        assert.equal(record?.state, 'timed-out');
        assert.match(record?.reason ?? '', /could not be confirmed gone/);
      },
      {
        limits: { terminateWaitMs: 200 },
        launcher: () => {
          let release = () => {};
          const exited = new Promise((resolve) => {
            release = () => resolve(null);
          });
          // A command that ignores termination for longer than the wait, then ends.
          setTimeout(release, 1500);
          return {
            pid: process.pid,
            exited,
            terminate: () => Promise.resolve({ taskkillExit: null }),
          };
        },
      },
    );
    await sleep(0);
  });
}
