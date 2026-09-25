/**
 * cookie-auth-prehandler.ts — Fastify preHandler for Dashboard session cookie auth
 *
 * When `unified-auth` feature flag is enabled, this preHandler:
 *   1. Parses the `automate_session` cookie from the request
 *   2. Calls `request.server.introspectSessionCookie(token)` to validate it
 *   3. On success, sets `request.user = { id, username }` for downstream handlers
 *   4. On failure or missing cookie, passes through (does not block the request)
 *
 * Designed to be additive — existing auth methods still apply after this handler.
 * Part of the unified-auth gateway (Task 11).
 */
import type { FastifyRequest, FastifyReply } from 'fastify';
import { isEnabled } from '../services/feature-flags.js';
// Import to ensure the FastifyInstance type augmentation (introspectSessionCookie) is in scope
import type { IntrospectionResult } from './cookie-introspection.js';

// Suppress unused import warning — IntrospectionResult is used implicitly via the type augmentation
 
type _EnsureAugmentation = IntrospectionResult;

// ── FastifyRequest type augmentation ──────────────────────────────────────────
declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; username: string };
  }
}

// ── Cookie parser ──────────────────────────────────────────────────────────────

/**
 * Parse a raw Cookie header string into a key→value map.
 * e.g. "session=abc; theme=dark" → { session: 'abc', theme: 'dark' }
 */
function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const eqIndex = part.indexOf('=');
    if (eqIndex === -1) continue;
    const name = part.slice(0, eqIndex).trim();
    const value = part.slice(eqIndex + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  }
  return cookies;
}

// ── Session cookie name ────────────────────────────────────────────────────────
const AUTOMATE_SESSION_COOKIE = 'automate_session';

// ── PreHandler ────────────────────────────────────────────────────────────────

export async function cookieAuthPreHandler(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  // Skip entirely when the feature flag is off
  if (!isEnabled('unified-auth')) {
    return;
  }

  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return;
  }

  const cookies = parseCookies(cookieHeader);
  const token = cookies[AUTOMATE_SESSION_COOKIE];
  if (!token) {
    return;
  }

  const result = await request.server.introspectSessionCookie(token);

  if (result.valid && result.userId) {
    request.user = {
      id: result.userId,
      username: result.username ?? result.userId,
    };
  }
}
