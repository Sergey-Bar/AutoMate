import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createEngine } from '../src/engine.mjs';
import { startServer } from '../src/server.mjs';
import { BOOTSTRAP_SCRIPT_SOURCE } from '../src/ui.mjs';
import { FILES_DIR } from './support.mjs';

const fixture = (name) => readFileSync(path.join(FILES_DIR, name));

/**
 * @param {{ port: number }} server
 * @param {{ method?: string, path?: string, headers?: Record<string, string>, body?: string }} [request]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: Buffer }>}
 */
function call(server, request = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        method: request.method ?? 'GET',
        path: request.path ?? '/',
        headers: { Host: `127.0.0.1:${String(server.port)}`, ...request.headers },
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(request.body);
  });
}

/** @param {(ctx: { engine: any, server: any, auth: Record<string, string>, dataDir: string }) => Promise<void>} body */
async function withServer(body) {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'automate-server-data-'));
  const engine = createEngine({ dataDir });
  const server = await startServer({ engine });
  try {
    await body({ engine, server, auth: { Authorization: `Bearer ${server.token}` }, dataDir });
  } finally {
    await server.close();
    engine.close();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
  }
}

function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'automate-server-repo-'));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, ...relative.split('/'));
    mkdirSync(path.dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
  }
  return root;
}

test('the API needs the token', async () => {
  await withServer(async ({ server, auth }) => {
    assert.equal((await call(server, { path: '/api/v1/health' })).status, 401);
    assert.equal(
      (await call(server, { path: '/api/v1/health', headers: { Authorization: 'Bearer wrong' } }))
        .status,
      401,
    );
    assert.equal(
      (
        await call(server, {
          path: '/api/v1/health',
          headers: { Authorization: `Bearer ${server.token}x` },
        })
      ).status,
      401,
    );
    const ok = await call(server, { path: '/api/v1/health', headers: auth });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body.toString()).status, 'ok');
  });
});

test('a foreign Host header is refused even with the token (DNS rebinding)', async () => {
  await withServer(async ({ server, auth }) => {
    for (const host of [
      'evil.example',
      `evil.example:${String(server.port)}`,
      '127.0.0.1',
      `127.0.0.1:${String(server.port + 1)}`,
    ]) {
      const response = await call(server, {
        path: '/api/v1/health',
        headers: { ...auth, Host: host },
      });
      assert.equal(response.status, 421, host);
    }
    const localhost = await call(server, {
      path: '/api/v1/health',
      headers: { ...auth, Host: `localhost:${String(server.port)}` },
    });
    assert.equal(localhost.status, 200);
  });
});

test('a foreign Origin or a cross-site fetch is refused, and no CORS header is ever sent', async () => {
  await withServer(async ({ server, auth }) => {
    const foreign = await call(server, {
      path: '/api/v1/health',
      headers: { ...auth, Origin: 'http://evil.example' },
    });
    assert.equal(foreign.status, 403);
    const own = await call(server, {
      path: '/api/v1/health',
      headers: { ...auth, Origin: server.url },
    });
    assert.equal(own.status, 200);
    const cross = await call(server, {
      path: '/api/v1/health',
      headers: { ...auth, 'Sec-Fetch-Site': 'cross-site' },
    });
    assert.equal(cross.status, 403);
    const preflight = await call(server, {
      method: 'OPTIONS',
      path: '/api/v1/health',
      headers: { ...auth, Origin: 'http://evil.example' },
    });
    assert.ok([403, 405].includes(preflight.status));
    for (const response of [foreign, own, cross, preflight]) {
      assert.ok(
        !Object.keys(response.headers).some((name) => name.startsWith('access-control-')),
        'a CORS header was sent',
      );
    }
  });
});

test('the browser exchanges the token for a session cookie, and a state change needs an Origin', async () => {
  await withServer(async ({ server }) => {
    const refused = await call(server, { method: 'POST', path: '/api/v1/session' });
    assert.equal(refused.status, 401);
    const granted = await call(server, {
      method: 'POST',
      path: '/api/v1/session',
      headers: { Authorization: `Bearer ${server.token}` },
    });
    assert.equal(granted.status, 204);
    const cookie = String(granted.headers['set-cookie']?.[0] ?? '');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    const session = cookie.split(';')[0] ?? '';

    assert.equal(
      (await call(server, { path: '/api/v1/health', headers: { Cookie: session } })).status,
      200,
    );
    const noOrigin = await call(server, {
      method: 'POST',
      path: '/ui/repositories',
      headers: { Cookie: session, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'path=x',
    });
    assert.equal(
      noOrigin.status,
      403,
      'a form posted from another site carries the cookie and no matching Origin',
    );
    const forged = await call(server, {
      method: 'POST',
      path: '/ui/repositories',
      headers: { Cookie: session, Origin: 'http://evil.example' },
      body: 'path=x',
    });
    assert.equal(forged.status, 403);
    assert.equal(
      (await call(server, { path: '/api/v1/health', headers: { Cookie: 'al_session=forged' } }))
        .status,
      401,
    );
  });
});

test('before a session the only page is the bootstrap, whose one script is pinned by hash and carries no token', async () => {
  await withServer(async ({ server }) => {
    const page = await call(server, { path: '/' });
    assert.equal(page.status, 200);
    const csp = String(page.headers['content-security-policy']);
    const expected = `'sha256-${createHash('sha256')
      .update(BOOTSTRAP_SCRIPT_SOURCE)
      .digest('base64')}'`;
    assert.ok(csp.includes(`script-src ${expected}`), csp);
    assert.ok(page.body.toString().includes(BOOTSTRAP_SCRIPT_SOURCE));
    assert.ok(!page.body.toString().includes(server.token));
    assert.ok(!JSON.stringify(page.headers).includes(server.token));
    // Any other page without a session is the same bootstrap page, not data.
    const other = await call(server, { path: '/repositories/abc' });
    assert.ok(other.body.toString().includes('Opening your session'));
  });
});

test('pages after login allow no script, are not cached, and cannot be framed', async () => {
  await withServer(async ({ server, auth }) => {
    const page = await call(server, { path: '/', headers: auth });
    const csp = String(page.headers['content-security-policy']);
    assert.match(csp, /script-src 'none'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.equal(page.headers['x-content-type-options'], 'nosniff');
    assert.ok(!page.body.toString().includes('<script'));
  });
});

test('the server is bound to loopback on an assigned port, and two servers get different ports', async () => {
  await withServer(async ({ server }) => {
    assert.equal(server.host, '127.0.0.1');
    assert.ok(server.port > 0);
    const dir = mkdtempSync(path.join(tmpdir(), 'automate-server-data-'));
    const engine = createEngine({ dataDir: dir });
    const second = await startServer({ engine });
    try {
      assert.notEqual(second.port, server.port);
      assert.notEqual(second.token, server.token);
    } finally {
      await second.close();
      engine.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});

test('scan through the API, read the dashboard and the original file back', async () => {
  const root = repository({
    'reports/junit.xml': fixture('junit-basic.xml'),
    'coverage/lcov.info': fixture('node-lcov.info'),
  });
  try {
    await withServer(async ({ server, auth }) => {
      const started = await call(server, {
        method: 'POST',
        path: '/api/v1/repositories',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: root }),
      });
      assert.equal(started.status, 202);
      const { scanId } = JSON.parse(started.body.toString());
      let operation;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        operation = JSON.parse(
          (
            await call(server, { path: `/api/v1/operations/${scanId}`, headers: auth })
          ).body.toString(),
        );
        if (operation.status !== 'running') break;
        await delay(20);
      }
      assert.equal(operation.status, 'complete');

      const dash = JSON.parse(
        (
          await call(server, {
            path: `/api/v1/repositories/${operation.result.repositoryId}/dashboard`,
            headers: auth,
          })
        ).body.toString(),
      );
      assert.equal(dash.kpis.testsFound.value, 4);

      const page = (
        await call(server, {
          path: `/repositories/${operation.result.repositoryId}`,
          headers: auth,
        })
      ).body.toString();
      assert.ok(page.includes('First-pass rate'));
      assert.ok(page.includes('87.76'));

      const sha = createHash('sha256').update(fixture('junit-basic.xml')).digest('hex');
      const raw = await call(server, { path: `/api/v1/reports/${sha}/raw`, headers: auth });
      assert.deepEqual(raw.body, fixture('junit-basic.xml'));
      assert.match(String(raw.headers['content-disposition']), /attachment/);
      assert.equal(
        (await call(server, { path: `/api/v1/reports/${'0'.repeat(64)}/raw`, headers: auth }))
          .status,
        404,
      );
      assert.equal(
        (await call(server, { path: '/api/v1/reports/not-a-digest/raw', headers: auth })).status,
        404,
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('report text from a hostile repository is escaped on every page', async () => {
  const hostile = `<?xml version="1.0"?><testsuite name="s"><testcase classname="c" name="&lt;script&gt;alert(1)&lt;/script&gt;" file="x.test.js"><failure message="&lt;img src=x onerror=alert(2)&gt;"/></testcase></testsuite>`;
  const root = repository({ 'reports/junit.xml': hostile });
  try {
    await withServer(async ({ engine, server, auth }) => {
      const scanned = await engine.scan(root);
      const dash = await call(server, {
        path: `/repositories/${scanned.repositoryId}`,
        headers: auth,
      });
      const sha = createHash('sha256').update(hostile).digest('hex');
      const report = await call(server, { path: `/reports/${sha}`, headers: auth });
      for (const response of [dash, report]) {
        const text = response.body.toString();
        assert.ok(!text.includes('<script>alert'), 'script injected');
        assert.ok(!text.includes('<img src=x'), 'markup injected');
      }
      assert.ok(report.body.toString().includes('&lt;script&gt;alert(1)'));
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('events stream with ids, and a reconnecting client receives only what it missed', async () => {
  const root = repository({ 'reports/junit.xml': fixture('junit-basic.xml') });
  try {
    await withServer(async ({ engine, server, auth }) => {
      await engine.scan(root);
      const read = (headers, query) =>
        new Promise((resolve) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: server.port,
              path: `/api/v1/events${query}`,
              headers: { Host: `127.0.0.1:${String(server.port)}`, ...auth, ...headers },
            },
            (res) => {
              let text = '';
              res.on('data', (chunk) => {
                text += chunk;
                if (text.includes('scan.completed')) {
                  req.destroy();
                  resolve(text);
                }
              });
            },
          );
          req.end();
        });
      const all = await read({}, '');
      const ids = [...all.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
      assert.ok(ids.length >= 3 && ids[0] === 1);
      const later = await read({ 'Last-Event-ID': String(ids[1]) }, '');
      const laterIds = [...later.matchAll(/^id: (\d+)$/gm)].map((m) => Number(m[1]));
      assert.deepEqual(laterIds, ids.slice(2));
      assert.ok(!later.includes('scan.started'));
    });
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('a path that is not a folder is refused with a message, and a huge body is refused', async () => {
  await withServer(async ({ server, auth }) => {
    const bad = await call(server, {
      method: 'POST',
      path: '/api/v1/repositories',
      headers: auth,
      body: '{"nope":1}',
    });
    assert.equal(bad.status, 400);
    assert.equal(JSON.parse(bad.body.toString()).error.code, 'BAD_REQUEST');
    const big = await call(server, {
      method: 'POST',
      path: '/api/v1/repositories',
      headers: auth,
      body: 'x'.repeat(1024 * 1024 + 10),
    }).catch(() => ({ status: 413 }));
    assert.equal(big.status, 413);
    const missing = await call(server, { path: '/api/v1/nothing', headers: auth });
    assert.equal(missing.status, 404);
    assert.equal(JSON.parse(missing.body.toString()).error.code, 'NOT_FOUND');
  });
});

test('the server module makes no outbound connection', () => {
  const source = readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'server.mjs'), 'utf8');
  assert.ok(
    !/https|fetch\(|http\.request\(|http\.get\(|net\.connect|WebSocket/.test(
      source.replace(/https?:\/\/local\.invalid/g, ''),
    ),
  );
});
