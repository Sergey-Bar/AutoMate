/**
 * Structured request/response logging plugin.
 * Logs every request with method, url, statusCode, responseTime, and userAgent.
 * Skips health endpoints to reduce noise.
 */
import type { FastifyInstance } from 'fastify';

const SKIP_PATHS = new Set(['/health', '/health/live', '/health/ready']);

/** Query parameter names that should be redacted from logged URLs. */
const SENSITIVE_PARAMS = new Set(['token', 'key', 'apiKey', 'api_key', 'secret', 'password', 'authorization']);

/** Strip sensitive query parameters from a URL for safe logging. */
function redactUrl(rawUrl: string): string {
  const qIndex = rawUrl.indexOf('?');
  if (qIndex === -1) return rawUrl;

  const base = rawUrl.slice(0, qIndex);
  const query = rawUrl.slice(qIndex + 1);
  const parts = query.split('&').map((pair) => {
    const eqIndex = pair.indexOf('=');
    const name = eqIndex === -1 ? pair : pair.slice(0, eqIndex);
    if (SENSITIVE_PARAMS.has(name.toLowerCase())) {
      return `${name}=[REDACTED]`;
    }
    return pair;
  });
  return `${base}?${parts.join('&')}`;
}

export async function registerRequestLogger(app: FastifyInstance) {
  app.addHook('onResponse', (req, reply, done) => {
    if (SKIP_PATHS.has(req.url)) {
      done();
      return;
    }

    app.log.info(
      {
        method: req.method,
        url: redactUrl(req.url),
        statusCode: reply.statusCode,
        responseTime: Math.round(reply.elapsedTime),
        userAgent: req.headers['user-agent'] ?? 'unknown',
        contentLength: reply.getHeader('content-length') ?? null,
      },
      'request completed',
    );

    done();
  });
}
