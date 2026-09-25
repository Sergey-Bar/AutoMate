import type { FastifyInstance } from 'fastify';

/**
 * Registers security response headers on every reply.
 */
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  // Derive the Ollama origin from OLLAMA_HOST env var (defaults to localhost:11434)
  const ollamaHost = process.env.OLLAMA_HOST ?? 'http://localhost:11434';
  let ollamaOrigin: string;
  try {
    ollamaOrigin = new URL(ollamaHost).host;
  } catch {
    app.log.warn({ ollamaHost }, 'Invalid OLLAMA_HOST URL, falling back to localhost:11434');
    ollamaOrigin = 'localhost:11434';
  }

  // Derive allowed WS origins from CORS_ORIGIN or default to self
  const corsOrigin = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
  let wsOrigins: string;
  try {
    if (corsOrigin === '*') {
      wsOrigins = "ws: wss:";
    } else {
      const parsed = new URL(corsOrigin);
      const wsScheme = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      wsOrigins = `${wsScheme}//${parsed.host}`;
    }
  } catch {
    wsOrigins = "ws://localhost:5173";
  }

  app.addHook('onSend', async (_request, reply) => {
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        `connect-src 'self' ${wsOrigins} http://${ollamaOrigin}`,
        "media-src 'self' blob:",
        "object-src 'none'",
        "frame-ancestors 'self'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );

    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  });
}
