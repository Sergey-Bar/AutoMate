import type { WhoAmI } from './health-client.js';

/**
 * What the signed-in caller may do, as the screens decide what to draw.
 *
 * The API is what enforces access — every write here is behind `requireRole` — so these only
 * decide whether a control is offered. Offering an operator's button to a viewer would be a
 * button that always fails, which reads as a broken product rather than a permission.
 */
export function canOperate(who: Pick<WhoAmI, 'role'>): boolean {
  return who.role === 'operator' || who.role === 'admin';
}

export function canAdminister(who: Pick<WhoAmI, 'role'>): boolean {
  return who.role === 'admin';
}

/** The server's sentence from a thrown client error, or `fallback`. */
export function failureText(error: unknown, fallback: string): string {
  const detail = (error as { detail?: unknown } | null)?.detail;
  if (typeof detail === 'string' && detail.length > 0) return detail;
  return error instanceof Error && error.message.length > 0 ? error.message : fallback;
}
