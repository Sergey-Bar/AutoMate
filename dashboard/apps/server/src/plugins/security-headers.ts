import type { FastifyInstance } from 'fastify';

/**
 * Registers security response headers on every reply.
 *
 * Adds baseline protections:
 *  - Content-Security-Policy: restricts resource origins
 *  - X-Content-Type-Options: prevents MIME-sniffing
 *  - X-Frame-Options: prevents clickjacking
 *  - Referrer-Policy: limits referrer information leakage
 *  - Permissions-Policy: disables unused browser APIs
 */
export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  app.addHook('onSend', async (_request, reply) => {
    // CSP: allow self, inline styles (Tailwind), WS connections, and data: URIs for fonts/images
    reply.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",                     // Tailwind CSS injects inline styles
        "img-src 'self' data: blob:",                            // screenshots, data URIs
        "font-src 'self' data:",                                 // embedded fonts
        "connect-src 'self' ws: wss:",                           // WebSocket connections
        "media-src 'self' blob:",                                // video playback
        "object-src 'none'",                                     // no Flash / Java applets
        "frame-ancestors 'self'",                                // clickjacking protection (CSP-level)
        "base-uri 'self'",                                       // prevent <base> tag hijacking
        "form-action 'self'",                                    // restrict form submissions
      ].join('; '),
    );

    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  });
}
