/**
 * The local interface: HTTP on the loopback interface, with server-sent events.
 *
 * Security (threats T-09, T-10 in docs/local/runner-and-threat-model.md):
 *
 * - bound to 127.0.0.1 on an operating-system-assigned port;
 * - a per-launch bearer token for the API; a browser exchanges it once for an HttpOnly,
 *   SameSite=Strict session cookie, so the token is never in a URL the server sees or logs;
 * - every request's Host header must be this server's own, which defeats DNS rebinding;
 * - every request carrying an Origin must carry this server's own, and a request that
 *   changes state must carry one when it authenticates by cookie, which is the CSRF check;
 * - no CORS headers are ever sent; there is no remote access;
 * - responses are never cached and carry a restrictive content security policy.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { clearInterval, setInterval } from 'node:timers';
import { URL, URLSearchParams } from 'node:url';
import {
  BOOTSTRAP_SCRIPT_SOURCE,
  CSS,
  bootstrapPage,
  dashboardPage,
  errorPage,
  onboardingPage,
  repositoriesPage,
  reportPage,
} from './ui.mjs';

const MAX_BODY_BYTES = 1024 * 1024;

const sha256Source = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

/** The policy for pages: one inline stylesheet and, on the bootstrap page only, one script. */
function contentSecurityPolicy(withScript) {
  return [
    "default-src 'none'",
    `style-src ${sha256Source(CSS)}`,
    withScript ? `script-src ${sha256Source(BOOTSTRAP_SCRIPT_SOURCE)}` : "script-src 'none'",
    "connect-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/**
 * @param {string} a
 * @param {string} b
 */
function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * @typedef {{ req: http.IncomingMessage, res: http.ServerResponse, url: URL, method: string,
 *   authenticated: boolean, viaCookie: boolean, json: (status: number, body: unknown) => void,
 *   html: (status: number, body: string) => void, error: (status: number, code: string, message: string) => void,
 *   body: () => Promise<string> }} Context
 * @typedef {(context: Context) => Promise<boolean> | boolean} RouteHandler
 */

/**
 * @param {{ engine: ReturnType<import('./engine.mjs').createEngine>, token?: string,
 *   host?: string, port?: number, routes?: RouteHandler[] }} options
 */
export async function startServer(options) {
  const { engine } = options;
  const host = options.host ?? '127.0.0.1';
  const token = options.token ?? randomBytes(32).toString('base64url');
  const sessions = new Set();
  /** @type {Map<string, { status: string, result?: unknown }>} */
  const operations = new Map();
  /** @type {string[]} */
  let allowedHosts = [];
  /** @type {Set<http.ServerResponse>} */
  const streams = new Set();

  /** @param {http.IncomingMessage} req */
  const cookieSession = (req) => {
    const match = /(?:^|;\s*)al_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie ?? '');
    return match !== null && sessions.has(match[1] ?? '');
  };

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    /** @type {URL} */
    let url;
    try {
      url = new URL(req.url ?? '/', 'http://local.invalid');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const baseHeaders = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    /** @param {number} status @param {string} contentType @param {string} body @param {Record<string, string>} [extra] */
    const send = (status, contentType, body, extra = {}) => {
      res.writeHead(status, { ...baseHeaders, 'Content-Type': contentType, ...extra });
      res.end(body);
    };
    const wantsHtml = !url.pathname.startsWith('/api/');
    const error = (status, code, message) => {
      if (wantsHtml)
        send(status, 'text/html; charset=utf-8', errorPage(status, code, message), {
          'Content-Security-Policy': contentSecurityPolicy(false),
        });
      else send(status, 'application/json', JSON.stringify({ error: { code, message } }));
    };

    // 1. Host: the DNS-rebinding defence. Applies to everything, including the bootstrap page.
    if (!allowedHosts.includes((req.headers.host ?? '').toLowerCase())) {
      error(421, 'HOST_NOT_ALLOWED', 'This server answers only to its own loopback address.');
      return;
    }
    // 2. Origin and fetch metadata: refuse anything a foreign page sent.
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedHosts.some((allowed) => origin === `http://${allowed}`)) {
      error(403, 'ORIGIN_NOT_ALLOWED', 'This request came from another origin.');
      return;
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') {
      error(403, 'ORIGIN_NOT_ALLOWED', 'This request came from another site.');
      return;
    }
    if (method === 'OPTIONS') {
      error(405, 'METHOD_NOT_ALLOWED', 'Cross-origin access is not offered.');
      return;
    }

    // 3. Authentication.
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    const viaToken = bearer !== undefined && safeEqual(bearer, token);
    const viaCookie = cookieSession(req);
    const authenticated = viaToken || viaCookie;
    const mutating = method !== 'GET' && method !== 'HEAD';
    // Cookie-authenticated changes need an Origin: a form on another site carries the cookie too.
    if (mutating && viaCookie && !viaToken && origin === undefined) {
      error(403, 'ORIGIN_REQUIRED', 'A change made from the browser must say where it came from.');
      return;
    }

    /** @type {Context} */
    const context = {
      req,
      res,
      url,
      method,
      authenticated,
      viaCookie,
      json: (status, body) => send(status, 'application/json', JSON.stringify(body)),
      html: (status, body) =>
        send(status, 'text/html; charset=utf-8', body, {
          'Content-Security-Policy': contentSecurityPolicy(false),
        }),
      error,
      body: () =>
        new Promise((resolve, reject) => {
          const chunks = [];
          let size = 0;
          req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              reject(new Error('body-too-large'));
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error', reject);
        }),
    };

    try {
      // The session handshake is the one API call that takes only the token.
      if (method === 'POST' && url.pathname === '/api/v1/session') {
        if (!viaToken) return error(401, 'UNAUTHENTICATED', 'A valid token is required.');
        const id = randomBytes(24).toString('base64url');
        sessions.add(id);
        res.writeHead(204, {
          ...baseHeaders,
          'Set-Cookie': `al_session=${id}; HttpOnly; SameSite=Strict; Path=/`,
        });
        res.end();
        return;
      }
      if (method === 'GET' && url.pathname === '/' && !authenticated) {
        send(200, 'text/html; charset=utf-8', bootstrapPage(), {
          'Content-Security-Policy': contentSecurityPolicy(true),
        });
        return;
      }
      if (!authenticated) {
        if (wantsHtml) {
          send(200, 'text/html; charset=utf-8', bootstrapPage(), {
            'Content-Security-Policy': contentSecurityPolicy(true),
          });
          return;
        }
        return error(401, 'UNAUTHENTICATED', 'A valid token is required.');
      }

      for (const route of options.routes ?? []) {
        if (await route(context)) return;
      }
      if (await core(context)) return;
      error(404, 'NOT_FOUND', 'There is nothing at this address.');
    } catch (cause) {
      const message = /** @type {Error} */ (cause).message;
      if (message === 'body-too-large')
        return error(413, 'BODY_TOO_LARGE', 'The request body is too large.');
      error(500, 'INTERNAL_ERROR', 'Something went wrong; the details are in the local log.');
    }
  });

  /** @type {RouteHandler} */
  async function core(ctx) {
    const { url, method } = ctx;
    const segments = url.pathname.split('/').filter(Boolean);

    if (method === 'GET' && url.pathname === '/api/v1/health') {
      ctx.json(200, { status: 'ok', version: engine.version });
      return true;
    }
    if (method === 'GET' && url.pathname === '/api/v1/repositories') {
      ctx.json(200, { repositories: engine.listRepositories() });
      return true;
    }
    if (method === 'POST' && url.pathname === '/api/v1/repositories') {
      let path;
      try {
        path = JSON.parse(await ctx.body()).path;
      } catch {
        return (ctx.error(400, 'BAD_REQUEST', 'The body must be JSON with a path.'), true);
      }
      if (typeof path !== 'string' || path === '')
        return (ctx.error(400, 'BAD_REQUEST', 'A path is required.'), true);
      const scanId = randomBytes(6).toString('hex');
      operations.set(scanId, { status: 'running' });
      engine
        .scan(path, { scanId })
        .then((result) => operations.set(scanId, { status: result.status, result }))
        .catch(() =>
          operations.set(scanId, { status: 'failed', result: { reason: 'internal-error' } }),
        );
      ctx.json(202, { scanId });
      return true;
    }
    if (method === 'GET' && segments[0] === 'api' && segments[2] === 'operations' && segments[3]) {
      const op = operations.get(segments[3]);
      return op === undefined
        ? (ctx.error(404, 'NOT_FOUND', 'No such operation.'), true)
        : (ctx.json(200, op), true);
    }
    if (
      method === 'GET' &&
      segments[0] === 'api' &&
      segments[2] === 'repositories' &&
      segments[4] === 'dashboard'
    ) {
      const dash = engine.dashboard(segments[3] ?? '');
      if (dash === null) return (ctx.error(404, 'NOT_FOUND', 'No such repository.'), true);
      ctx.json(200, {
        repository: dash.repository,
        scan: dash.scan,
        kpis: dash.kpis,
        reconciliation: dash.reconciliation,
      });
      return true;
    }
    if (method === 'GET' && segments[0] === 'api' && segments[2] === 'reports' && segments[3]) {
      if (segments[4] === 'raw') {
        const bytes = engine.rawReport(segments[3]);
        if (bytes === null) return (ctx.error(404, 'NOT_FOUND', 'No such report.'), true);
        ctx.res.writeHead(200, {
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Type': 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${segments[3].slice(0, 12)}.report"`,
        });
        ctx.res.end(Buffer.from(bytes));
        return true;
      }
      const detail = engine.report(segments[3]);
      return detail === null
        ? (ctx.error(404, 'NOT_FOUND', 'No such report.'), true)
        : (ctx.json(200, detail), true);
    }
    if (method === 'GET' && url.pathname === '/api/v1/events') {
      const last =
        Number(url.searchParams.get('cursor') ?? ctx.req.headers['last-event-id'] ?? 0) || 0;
      ctx.res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'X-Content-Type-Options': 'nosniff',
      });
      const write = (event) =>
        ctx.res.write(
          `id: ${String(event.cursor)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
        );
      for (const event of engine.events.since(last)) write(event);
      const unsubscribe = engine.events.subscribe(write);
      const beat = setInterval(() => ctx.res.write(': keep-alive\n\n'), 15_000);
      beat.unref();
      streams.add(ctx.res);
      ctx.req.on('close', () => {
        clearInterval(beat);
        unsubscribe();
        streams.delete(ctx.res);
      });
      return true;
    }

    // Pages
    if (method === 'GET' && url.pathname === '/')
      return (ctx.html(200, repositoriesPage(engine.listRepositories())), true);
    if (method === 'GET' && segments[0] === 'repositories' && segments[1]) {
      const dash = engine.dashboard(segments[1]);
      return dash === null
        ? (ctx.error(404, 'NOT_FOUND', 'No such repository.'), true)
        : (ctx.html(200, dashboardPage(dash)), true);
    }
    if (method === 'GET' && segments[0] === 'reports' && segments[1]) {
      const detail = engine.report(segments[1]);
      return detail === null
        ? (ctx.error(404, 'NOT_FOUND', 'No such report.'), true)
        : (ctx.html(
            200,
            reportPage(detail, { roots: engine.listRepositories().map((r) => r.root_path) }),
          ),
          true);
    }
    if (method === 'POST' && url.pathname === '/ui/repositories') {
      const form = new URLSearchParams(await ctx.body());
      const target = form.get('path') ?? '';
      const result = await engine.scan(target);
      if (result.status === 'failed') {
        const messages = {
          'not-a-directory': 'That path is not a folder that can be read.',
          'filesystem-root': 'A filesystem root is not accepted.',
        };
        ctx.html(
          400,
          onboardingPage({
            message: messages[result.reason] ?? 'That folder could not be scanned.',
          }),
        );
        return true;
      }
      ctx.res.writeHead(303, {
        Location: `/repositories/${result.repositoryId}`,
        'Cache-Control': 'no-store',
      });
      ctx.res.end();
      return true;
    }
    return false;
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  allowedHosts = [`${host}:${String(address.port)}`, `localhost:${String(address.port)}`];

  return {
    host,
    port: address.port,
    token,
    url: `http://${host}:${String(address.port)}`,
    /** The address to open: the token sits after the #, which a browser never sends. */
    bootstrapUrl: `http://${host}:${String(address.port)}/#t=${token}`,
    async close() {
      for (const stream of streams) stream.end();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
