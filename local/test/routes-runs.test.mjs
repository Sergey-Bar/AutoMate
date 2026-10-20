import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEngine } from '../src/engine.mjs';
import { createRunner } from '../src/runner.mjs';
import { requestFromForm, runRoutes } from '../src/routes.mjs';
import { startServer } from '../src/server.mjs';
import { runPage, runsPage, previewPage } from '../src/ui-runs.mjs';
import { assertWellFormed as wellFormed, call, session } from './http-support.mjs';
import { sleep, waitFor } from './tree-harness.mjs';
import { URLSearchParams } from 'node:url';

const assertWellFormed = (html, name) => wellFormed(assert, html, name);

const FIXTURE = path.resolve(import.meta.dirname, 'runner-fixture.mjs');

async function withApp(body) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-rr-data-'));
  const root = mkdtempSync(path.join(tmpdir(), 'automate-rr-repo-'));
  const engine = createEngine({ dataDir });
  const scanned = await engine.scan(root);
  const runner = createRunner({ engine, dataDir });
  const server = await startServer({ engine, routes: [runRoutes({ engine, runner })] });
  const repositoryId = scanned.repositoryId;
  const auth = { Authorization: `Bearer ${server.token}` };
  const json = { 'Content-Type': 'application/json' };
  try {
    await body({ engine, runner, server, auth, json, repositoryId, root });
  } finally {
    if (runner.activeId() !== null) {
      runner.cancel(runner.activeId());
      await runner.whenDone(/** @type {string} */ (runner.list()[0]?.id));
    }
    await server.close();
    engine.close();
    try {
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // a handle can outlive the test on Windows
    }
  }
}

const request = (repositoryId, args, extra = {}) => ({
  repositoryId,
  argv: [process.execPath, FIXTURE, ...args],
  deadlineSeconds: 30,
  ...extra,
});

test('the API previews, starts only with the previewed digest, and reports the result', async () => {
  await withApp(async ({ server, auth, json, repositoryId, runner }) => {
    const shown = request(repositoryId, ['print', 'via api']);
    const preview = await call(server, {
      method: 'POST',
      path: '/api/v1/runs/preview',
      headers: { ...auth, ...json },
      body: JSON.stringify(shown),
    });
    assert.equal(preview.status, 200);
    const { consentDigest, plan } = JSON.parse(preview.body);
    assert.match(plan.notice, /not isolated/);

    const wrong = await call(server, {
      method: 'POST',
      path: '/api/v1/runs',
      headers: { ...auth, ...json },
      body: JSON.stringify({ ...shown, consentDigest: 'x' }),
    });
    assert.equal(wrong.status, 409);
    assert.equal(JSON.parse(wrong.body).error.code, 'CONSENT_MISMATCH');
    assert.deepEqual(
      JSON.parse((await call(server, { path: '/api/v1/runs', headers: auth })).body).runs,
      [],
    );

    const started = await call(server, {
      method: 'POST',
      path: '/api/v1/runs',
      headers: { ...auth, ...json },
      body: JSON.stringify({ ...shown, consentDigest }),
    });
    assert.equal(started.status, 202);
    const { id } = JSON.parse(started.body);
    await runner.whenDone(id);
    const record = JSON.parse(
      (await call(server, { path: `/api/v1/runs/${id}`, headers: auth })).body,
    );
    assert.equal(record.state, 'succeeded');
    const output = JSON.parse(
      (await call(server, { path: `/api/v1/runs/${id}/output?stream=stdout`, headers: auth })).body,
    );
    assert.equal(output.text.trim(), 'via api');
    assert.equal((await call(server, { path: '/api/v1/runs/nope', headers: auth })).status, 404);
  });
});

test('the run endpoints sit behind the same checks as everything else', async () => {
  await withApp(async ({ server, auth, json, repositoryId }) => {
    const body = JSON.stringify(request(repositoryId, ['print', 'x']));
    for (const target of ['/api/v1/runs', '/api/v1/runs/preview']) {
      assert.equal(
        (await call(server, { method: 'POST', path: target, headers: json, body })).status,
        401,
        `${target}: no token`,
      );
      assert.equal(
        (
          await call(server, {
            method: 'POST',
            path: target,
            headers: { ...json, Authorization: 'Bearer wrong' },
            body,
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await call(server, {
            method: 'POST',
            path: target,
            headers: { ...auth, ...json, Host: 'evil.example' },
            body,
          })
        ).status,
        421,
        `${target}: foreign host`,
      );
      assert.equal(
        (
          await call(server, {
            method: 'POST',
            path: target,
            headers: { ...auth, ...json, Origin: 'http://evil.example' },
            body,
          })
        ).status,
        403,
        `${target}: foreign origin`,
      );
    }
    // A cookie alone, with no Origin, is what a form on another site would send.
    const cookie = String(
      (await call(server, { method: 'POST', path: '/api/v1/session', headers: auth })).headers[
        'set-cookie'
      ],
    ).split(';')[0];
    const forged = await call(server, {
      method: 'POST',
      path: '/api/v1/runs/preview',
      headers: { Cookie: cookie, ...json },
      body,
    });
    assert.equal(forged.status, 403);
    assert.equal(JSON.parse(forged.body).error.code, 'ORIGIN_REQUIRED');
    const formForged = await call(server, {
      method: 'POST',
      path: '/ui/runs/preview',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'argv=x',
    });
    assert.equal(formForged.status, 403);
  });
});

test('a malformed request is a clear 400, not a crash', async () => {
  await withApp(async ({ server, auth, json }) => {
    for (const body of ['not json', '[]', '"x"', '{}']) {
      const response = await call(server, {
        method: 'POST',
        path: '/api/v1/runs/preview',
        headers: { ...auth, ...json },
        body,
      });
      assert.ok(
        response.status === 400 || response.status === 404,
        `${body}: ${String(response.status)}`,
      );
      assert.ok(JSON.parse(response.body).error.code);
    }
  });
});

test('cancelling over the API ends the run', async () => {
  await withApp(async ({ server, auth, json, repositoryId, runner }) => {
    const shown = request(repositoryId, ['sleep']);
    const { consentDigest } = JSON.parse(
      (
        await call(server, {
          method: 'POST',
          path: '/api/v1/runs/preview',
          headers: { ...auth, ...json },
          body: JSON.stringify(shown),
        })
      ).body,
    );
    const { id } = JSON.parse(
      (
        await call(server, {
          method: 'POST',
          path: '/api/v1/runs',
          headers: { ...auth, ...json },
          body: JSON.stringify({ ...shown, consentDigest }),
        })
      ).body,
    );
    assert.ok(
      await waitFor(
        () => JSON.parse(runner.output(id, 'stdout').text === '' ? '"x"' : '"y"') === 'y',
        15_000,
      ),
    );
    const second = await call(server, {
      method: 'POST',
      path: '/api/v1/runs',
      headers: { ...auth, ...json },
      body: JSON.stringify({ ...shown, consentDigest }),
    });
    assert.equal(second.status, 409);
    assert.equal(JSON.parse(second.body).error.code, 'BUSY');
    assert.equal(
      (await call(server, { method: 'POST', path: `/api/v1/runs/${id}/cancel`, headers: auth }))
        .status,
      202,
    );
    await runner.whenDone(id);
    assert.equal(runner.get(id)?.state, 'cancelled');
    assert.equal(
      (await call(server, { method: 'POST', path: `/api/v1/runs/${id}/cancel`, headers: auth }))
        .status,
      409,
    );
  });
});

test('the form flow: preview shows the exact request, and only the digest is posted to start', async () => {
  await withApp(async ({ server, auth, repositoryId, runner }) => {
    const headers = await session(server, auth);
    const form = new URLSearchParams({
      repositoryId,
      argv: `${process.execPath}\n${FIXTURE}\nprint\nfrom a form & more`,
      cwd: '.',
      deadlineSeconds: '30',
      env: 'DEMO_API_TOKEN=form-secret-value-0001',
      secrets: '',
    });
    const preview = await call(server, {
      method: 'POST',
      path: '/ui/runs/preview',
      headers,
      body: form.toString(),
    });
    assert.equal(preview.status, 200);
    assert.match(preview.body, /Not isolated/);
    assert.match(preview.body, /from a form &amp; more/);
    assert.match(preview.body, /DEMO_API_TOKEN/);
    assert.ok(!preview.body.includes('form-secret-value-0001'), 'no value in the preview page');
    const digest = /name="consentDigest" value="([0-9a-f]{64})"/.exec(preview.body)?.[1];
    assert.ok(digest, 'the preview carries the digest');
    assert.ok(!preview.body.includes('name="argv"'), 'the request is not echoed back in the form');

    const bad = await call(server, {
      method: 'POST',
      path: '/ui/runs',
      headers,
      body: 'consentDigest=' + '0'.repeat(64),
    });
    assert.equal(bad.status, 409, 'an unknown digest starts nothing');
    assert.deepEqual(runner.list(), []);

    const started = await call(server, {
      method: 'POST',
      path: '/ui/runs',
      headers,
      body: `consentDigest=${digest}`,
    });
    assert.equal(started.status, 303);
    const location = String(started.headers.location);
    const id = location.split('/').pop() ?? '';
    await runner.whenDone(id);
    assert.equal(runner.get(id)?.state, 'succeeded');
    const again = await call(server, {
      method: 'POST',
      path: '/ui/runs',
      headers,
      body: `consentDigest=${digest}`,
    });
    assert.equal(again.status, 409, 'a preview can be used once');
    const detail = await call(server, { path: location, headers });
    assert.equal(detail.status, 200);
    assert.match(detail.body, /from a form &amp; more/);
    assert.match(detail.body, /succeeded/);
  });
});

test('the form shows why a request is refused and keeps what was typed', async () => {
  await withApp(async ({ server, auth, repositoryId }) => {
    const headers = await session(server, auth);
    const form = new URLSearchParams({
      repositoryId,
      argv: 'node',
      cwd: '..',
      deadlineSeconds: '30',
    });
    const response = await call(server, {
      method: 'POST',
      path: '/ui/runs/preview',
      headers,
      body: form.toString(),
    });
    assert.equal(response.status, 400);
    assert.match(response.body, /inside the repository/);
    assert.match(response.body, /role="alert"/);
    const noDeadline = await call(server, {
      method: 'POST',
      path: '/ui/runs/preview',
      headers,
      body: new URLSearchParams({ repositoryId, argv: 'node' }).toString(),
    });
    assert.match(noDeadline.body, /deadline is required/);
  });
});

test('requestFromForm reads lines, keeps interior blank arguments and rejects malformed variables', () => {
  const form = new URLSearchParams({
    repositoryId: 'r',
    argv: 'a\n\nb\n\n',
    deadlineSeconds: ' 12 ',
    passThrough: ' PATH \n',
    env: 'A=b=c\n\n',
  });
  const parsed = requestFromForm(form);
  assert.deepEqual(parsed.argv, ['a', '', 'b']);
  assert.equal(parsed.deadlineSeconds, 12);
  assert.deepEqual(parsed.passThrough, ['PATH']);
  assert.deepEqual(parsed.env, { A: 'b=c' });
  assert.throws(() => requestFromForm(new URLSearchParams({ env: 'novalue' })), /not NAME=value/);
  assert.ok(
    Number.isNaN(requestFromForm(new URLSearchParams({ deadlineSeconds: '1e3' })).deadlineSeconds),
  );
  assert.equal(requestFromForm(new URLSearchParams({})).deadlineSeconds, undefined);
});

test('the run pages are well formed, escape what they show, and never claim isolation', () => {
  const repositories = [{ id: 'r1', root_path: 'C:\\Work\\repo' }];
  const hostile = '"><script>alert(1)</script>';
  const run = {
    id: 'abc',
    state: 'failed',
    reason: 'exit code 1',
    argv: ['node', hostile],
    cwd: 'C:\\Work\\repo\\sub',
    startedAt: '2026-10-19T10:00:00Z',
    finishedAt: '2026-10-19T10:00:01Z',
    exitCode: 1,
    deadlineMs: 5000,
    envNames: { explicit: ['A'], passThrough: ['PATH'] },
    retryOf: null,
    termination: null,
    collection: {
      status: 'partial',
      reports: [
        { path: 'a.xml', outcome: 'missing' },
        { path: 'b.xml', outcome: 'ingested', sha256: 'a'.repeat(64) },
      ],
    },
  };
  const pages = [
    runsPage({ repositories, runs: [], activeId: null, notice: 'n' }),
    runsPage({ repositories: [], runs: [], activeId: null, notice: 'n' }),
    runsPage({
      repositories,
      runs: [run],
      activeId: 'abc',
      notice: 'n',
      message: 'Something is wrong.',
      prefill: { argv: ['x'], needsValues: ['A'], retryOf: 'abc' },
    }),
    previewPage({
      consentDigest: 'a'.repeat(64),
      roots: ['C:\\Work\\repo'],
      plan: {
        resolvedExecutable: 'C:\\n\\node.exe',
        viaCmdShim: false,
        argv: ['node', hostile],
        cwd: 'C:\\Work\\repo',
        deadlineSeconds: 5,
        explicitEnvNames: ['A'],
        passThroughNames: [],
        artifactPaths: [],
        notice: 'Not isolated text.',
        platformNote: 'p',
      },
    }),
    runPage({
      run,
      stdout: { text: hostile, truncated: true, final: true, withheld: false },
      stderr: { text: '', withheld: true },
      roots: ['C:\\Work\\repo'],
      repositories,
    }),
    runPage({
      run: { ...run, state: 'running', finishedAt: null, exitCode: null, collection: null },
      stdout: { text: '', truncated: false },
      stderr: { text: '', truncated: false },
      roots: [],
      repositories,
    }),
  ];
  pages.forEach((html, index) => assertWellFormed(html, `page ${String(index)}`));
  const all = pages.join('\n');
  assert.ok(!all.includes(hostile), 'hostile text is never emitted raw');
  assert.ok(all.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.match(all, /withheld/);
  assert.match(all, /Not isolated/);
  assert.ok(
    !all.includes('C:\\Work\\repo\\sub'),
    'a path inside the repository is shown relative to it',
  );
  assert.match(all, /&lt;repo&gt;/);
});

test('settling: a run finished by the time the page is read is shown with its final output', async () => {
  await withApp(async ({ server, auth, repositoryId, runner }) => {
    const headers = await session(server, auth);
    const shown = request(repositoryId, ['print', 'final output']);
    const { consentDigest } = await runner.preview(shown);
    const { id } = await runner.start({ ...shown, consentDigest });
    await runner.whenDone(id);
    await sleep(10);
    const page = await call(server, { path: `/runs/${id}`, headers });
    assert.match(page.body, /final output/);
    assert.match(page.body, /Repeat this run/);
    const list = await call(server, { path: '/runs', headers });
    assert.match(list.body, new RegExp(id));
    const retry = await call(server, { path: `/runs?retry=${id}`, headers });
    assert.equal(retry.status, 200);
    assert.match(retry.body, /print/);
    assert.equal((await call(server, { path: '/runs/doesnotexist', headers })).status, 404);
  });
});
