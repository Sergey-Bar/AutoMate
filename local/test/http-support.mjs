// Not a test. A small HTTP client and a browser-session helper for the server tests.
import http from 'node:http';

/**
 * @param {{ port: number }} server
 * @param {{ method?: string, path?: string, headers?: Record<string, string>, body?: string }} [request]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, body: string }>}
 */
export function call(server, request = {}) {
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
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end(request.body);
  });
}

/**
 * A browser session: the cookie, and the Origin a same-site form post carries.
 *
 * @param {{ port: number }} server
 * @param {Record<string, string>} auth
 */
export async function session(server, auth) {
  const response = await call(server, { method: 'POST', path: '/api/v1/session', headers: auth });
  const cookie = String(response.headers['set-cookie']).split(';')[0] ?? '';
  return {
    Cookie: cookie,
    Origin: `http://127.0.0.1:${String(server.port)}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

/** Structural accessibility and safety checks that need no browser. */
export function assertWellFormed(assert, html, name) {
  assert.ok(html.startsWith('<!doctype html>'), `${name}: doctype`);
  assert.match(html, /<html lang="en">/, `${name}: language`);
  assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${name}: one h1`);
  assert.match(html, /<main id="main"/, `${name}: main landmark`);
  for (const control of html.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)) {
    if (/type="hidden"/.test(control[0])) continue;
    const id = /id="([^"]+)"/.exec(control[0])?.[1];
    assert.ok(
      id && html.includes(`<label for="${id}"`),
      `${name}: control ${String(id)} has a label`,
    );
  }
  const tables = html.match(/<table\b/g)?.length ?? 0;
  assert.equal(html.match(/<caption>/g)?.length ?? 0, tables, `${name}: every table has a caption`);
  for (const th of html.matchAll(/<th\b[^>]*>/g))
    assert.match(th[0], /scope="/, `${name}: th scope`);
  assert.ok(!/\sstyle="/.test(html), `${name}: no inline style attribute`);
  assert.ok(!/\son[a-z]+=/.test(html), `${name}: no event handler attribute`);
  assert.ok(!/<script/.test(html), `${name}: no script`);
}
