import type { Context } from 'hono';

/** A fixed answer, or one read from the request. */
export type SecureCookies = boolean | ((context: Context) => boolean);

/** The answer for this request. */
export function isSecureFor(policy: SecureCookies | undefined, context: Context): boolean {
  if (policy === undefined) return false;
  return typeof policy === 'boolean' ? policy : policy(context);
}

/**
 * Whether a cookie is `Secure`, decided from how the request actually arrived.
 *
 * The comment above the old `resolveSecureCookies` said exactly this and the code read only
 * `PUBLIC_APP_URL`, once, at boot. That was harmless while the install was loopback-only;
 * a LAN install terminates TLS at the edge, so a browser on https got a cookie without
 * `Secure` whenever the public URL still said http. Now: an explicit `COOKIE_SECURE` wins,
 * an https public URL is always Secure, and otherwise the edge's `X-Forwarded-Proto` decides
 * — read only when `TRUST_PROXY` says our own proxy wrote it.
 */
export function secureCookiePolicy(input: {
  explicit?: string | undefined;
  publicAppUrl?: string | undefined;
  trustProxy?: boolean | undefined;
}): SecureCookies {
  const explicit = input.explicit?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') return true;
  if (explicit === 'false' || explicit === '0' || explicit === 'no') return false;
  if ((input.publicAppUrl ?? '').startsWith('https://')) return true;
  if (input.trustProxy !== true) return false;
  return (context) =>
    context.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase() === 'https';
}
