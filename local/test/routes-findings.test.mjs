import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createEngine } from '../src/engine.mjs';
import { findingsRoutes } from '../src/routes.mjs';
import { startServer } from '../src/server.mjs';
import { assertWellFormed, call, session } from './http-support.mjs';
import { URLSearchParams } from 'node:url';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const junit = (tests) =>
  `<testsuite name="s" tests="${String(tests.length)}">${tests
    .map(
      ([n, ok]) =>
        `<testcase classname="s" name="${n}" time="0.1">${
          ok ? '' : '<failure message="boom"/>'
        }</testcase>`,
    )
    .join('')}</testsuite>`;

async function withApp(body) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-rf-repo-'));
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-rf-data-'));
  let clock = NOW - 3 * DAY;
  const engine = createEngine({ dataDir, now: () => new Date(clock) });
  const scanWith = async (commit, tests) => {
    mkdirSync(path.join(root, '.git'), { recursive: true });
    writeFileSync(path.join(root, '.git', 'HEAD'), `${commit}\n`);
    mkdirSync(path.join(root, 'reports'), { recursive: true });
    const file = path.join(root, 'reports', 'junit.xml');
    writeFileSync(file, junit(tests));
    utimesSync(file, new Date(clock), new Date(clock));
    clock += DAY;
    return engine.scan(root);
  };
  const first = await scanWith('a'.repeat(40), [
    ['one', true],
    ['two', true],
  ]);
  await scanWith('b'.repeat(40), [
    ['one', true],
    ['two', false],
  ]);
  clock = NOW;
  const server = await startServer({ engine, routes: [findingsRoutes({ engine })] });
  const auth = { Authorization: `Bearer ${server.token}` };
  try {
    await body({
      engine,
      server,
      auth,
      repositoryId: first.repositoryId,
      headers: await session(server, auth),
    });
  } finally {
    await server.close();
    engine.close();
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5 });
      rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
    } catch {
      // a handle can outlive the test on Windows
    }
  }
}

test('the findings page shows evidence, comparison basis and thresholds, and is well formed', async () => {
  await withApp(async ({ server, headers }) => {
    const page = await call(server, { path: '/findings', headers });
    assert.equal(page.status, 200);
    assertWellFormed(assert, page.body, 'findings');
    assert.match(page.body, /two failed in the latest report and passed in the one before/);
    assert.match(page.body, /the commits differ|commits differ/);
    assert.match(page.body, /Evidence/);
    assert.match(page.body, /False positives/);
    assert.match(page.body, /These numbers are proposals, not measurements/);
    assert.match(page.body, /AI assistance<\/h2>\s*<p>Off\./);
    assert.ok(!/\bbecause\b|root cause|\bcaused by\b/i.test(page.body), 'no cause is named');
  });
});

test('dismissing from the page needs the same checks as every change, hides the finding, and can be undone', async () => {
  await withApp(async ({ server, headers, repositoryId, engine }) => {
    const fingerprint = engine.findings(repositoryId).findings[0].fingerprint;
    const form = (extra = {}) =>
      new URLSearchParams({ repositoryId, fingerprint, ...extra }).toString();

    const noOrigin = await call(server, {
      method: 'POST',
      path: '/ui/findings/dismiss',
      headers: { Cookie: headers.Cookie, 'Content-Type': headers['Content-Type'] },
      body: form(),
    });
    assert.equal(noOrigin.status, 403, 'a cookie alone is what a form on another site would send');
    assert.equal(engine.findings(repositoryId).dismissedCount, 0);

    const done = await call(server, {
      method: 'POST',
      path: '/ui/findings/dismiss',
      headers,
      body: form({ note: 'accepted for now' }),
    });
    assert.equal(done.status, 303);
    assert.equal(engine.findings(repositoryId).findings.length, 0);

    const hidden = await call(server, { path: '/findings', headers });
    assert.match(hidden.body, /Show 1 dismissed/);
    assert.ok(!hidden.body.includes('failed in the latest report'));
    const shown = await call(server, {
      path: `/findings?repository=${repositoryId}&dismissed=1`,
      headers,
    });
    assert.match(shown.body, /accepted for now/);
    assert.match(shown.body, /by the local user/);
    assertWellFormed(assert, shown.body, 'findings (dismissed shown)');

    assert.equal(
      (await call(server, { method: 'POST', path: '/ui/findings/restore', headers, body: form() }))
        .status,
      303,
    );
    assert.equal(engine.findings(repositoryId).findings.length, 1);
    assert.equal(
      (
        await call(server, {
          method: 'POST',
          path: '/ui/findings/dismiss',
          headers,
          body: form({ fingerprint: 'nope' }),
        })
      ).status,
      404,
    );
  });
});

test('the findings API lists, dismisses with a note and restores', async () => {
  await withApp(async ({ server, auth, repositoryId }) => {
    const list = JSON.parse(
      (await call(server, { path: `/api/v1/repositories/${repositoryId}/findings`, headers: auth }))
        .body,
    );
    assert.equal(list.findings.length, 1);
    const fp = list.findings[0].fingerprint;
    const base = `/api/v1/repositories/${repositoryId}/findings/${fp}`;
    const json = { ...auth, 'Content-Type': 'application/json' };
    assert.equal(
      (
        await call(server, {
          method: 'POST',
          path: `${base}/dismiss`,
          headers: json,
          body: JSON.stringify({ note: 'x' }),
        })
      ).status,
      200,
    );
    assert.equal(
      JSON.parse(
        (
          await call(server, {
            path: `/api/v1/repositories/${repositoryId}/findings`,
            headers: auth,
          })
        ).body,
      ).findings.length,
      0,
    );
    assert.equal(
      JSON.parse(
        (
          await call(server, {
            path: `/api/v1/repositories/${repositoryId}/findings?dismissed=1`,
            headers: auth,
          })
        ).body,
      ).findings.length,
      1,
    );
    assert.equal(
      (await call(server, { method: 'POST', path: `${base}/restore`, headers: auth })).status,
      200,
    );
    assert.equal(
      (
        await call(server, {
          method: 'POST',
          path: `${base}/dismiss`,
          headers: json,
          body: 'not json',
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await call(server, {
          method: 'POST',
          path: `/api/v1/repositories/${repositoryId}/findings/nope/dismiss`,
          headers: json,
          body: '{}',
        })
      ).status,
      404,
    );
    assert.equal(
      (await call(server, { path: '/api/v1/repositories/nope/findings', headers: auth })).status,
      404,
    );
    assert.equal(
      (
        await call(server, {
          method: 'POST',
          path: `${base}/dismiss`,
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
      401,
    );
  });
});

test('the AI status endpoint says it is off, and the page offers no way to turn it on', async () => {
  await withApp(async ({ server, auth, headers }) => {
    const status = JSON.parse(
      (await call(server, { path: '/api/v1/ai/status', headers: auth })).body,
    );
    assert.equal(status.enabled, false);
    assert.equal(status.provider, null);
    const page = (await call(server, { path: '/findings', headers })).body;
    assert.ok(!/name="(ai|provider|apikey|model)/i.test(page));
    assert.equal(
      (await call(server, { method: 'POST', path: '/api/v1/ai/ask', headers: auth, body: '{}' }))
        .status,
      404,
    );
  });
});
