import type { Context } from 'hono';
import { ErrorCode } from '../errors/domain-error.js';

/**
 * A 400 `INVALID_REQUEST` for a query or body that failed its schema, with the Zod issues as
 * `details`.
 *
 * One copy for the repository-health, agent-quality, AI-code, delivery and scorecard routes,
 * which each carried this function byte for byte. It answers directly rather than throwing a
 * `DomainError`, so the body carries no `requestId`; the routes that throw
 * `INVALID_REQUEST_BODY` (`notifications.ts`, `issue-tracking.ts`) go through the boundary.
 * Moving these onto the boundary changes their response body, so it is a change of its own.
 */
export function invalidRequest(context: Context, message: string, details: unknown): Response {
  return context.json({ error: { code: ErrorCode.INVALID_REQUEST, message, details } }, 400);
}
