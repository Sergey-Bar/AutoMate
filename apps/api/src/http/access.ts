import type { MiddlewareHandler } from 'hono';

/**
 * How a route declares who may call it, in a form the authz matrix can read back.
 *
 * `docs/quality/authz-matrix.json` is generated from the composed application, and the access
 * class of a route has to come from the code that enforces it rather than from a column
 * somebody types. A guard is therefore a middleware that does the check **and** carries a
 * tag: the generator walks the handler chain Hono will actually run for each route and reads
 * the tags off it. A route with no tagged middleware is `open`, which is the posture ADR-006
 * gives the install, and which the matrix test verifies by sending a request with no
 * credential and expecting it not to be refused for want of one.
 *
 * The tag is a property on the function under a registered symbol, so the generator (a
 * dependency-free script reading the built application) finds it with `Symbol.for` and does
 * not import this module.
 */

/** The credentials a guard can demand. Absence from a route's chain means `open`. */
export const GUARDED_ACCESS = [
  'reporter-secret',
  'runner-registration-secret',
  'runner-credential',
  'enrollment-token',
] as const;

export type GuardedAccess = (typeof GUARDED_ACCESS)[number];

/** Registered (not local) so a script reading the built app can find it without importing us. */
export const ACCESS_TAG = Symbol.for('automate.access-class');

/** Tags `middleware` as enforcing `access`, and returns the same function. */
export function guard<T extends MiddlewareHandler>(access: GuardedAccess, middleware: T): T {
  Object.defineProperty(middleware, ACCESS_TAG, { value: access, enumerable: false });
  return middleware;
}

/** The access a handler enforces, or `undefined` when it enforces none. */
export function accessOf(handler: unknown): GuardedAccess | undefined {
  if (typeof handler !== 'function') return undefined;
  const tag: unknown = (handler as unknown as Record<symbol, unknown>)[ACCESS_TAG];
  return GUARDED_ACCESS.find((access) => access === tag);
}
