import { describe, expect, it } from 'vitest';
import { InMemorySessionService, hashCredential } from './credentials.js';

/**
 * The in-memory session service is what a deployment without a database runs, and it
 * had no test at all. `packages/auth`'s coverage floor was 95/90/93/100 statements to
 * lines, and the `100` line floor is the reason deleting the trivially-covered
 * `session.ts` exposed the gap: one fully-covered file was carrying a package average
 * that said nothing about the service that actually issues sessions.
 *
 * The behaviours asserted here are the ones that are true and should stay true. The
 * service's *deficiencies* — the O(n) scan on every validation, the absent expiry
 * sweep, `issue` handing back the live internal record, an empty secret and a
 * non-positive TTL being accepted, the dead `lastUsedAt` — are recorded as open rows in
 * `docs/quality/findings-ledger.json` (S-1 through S-7, wave W3.3). They are deliberately
 * not asserted here as correct: a test that pins a defect is a test that makes the
 * defect look like a decision.
 */
const ISSUED = new Date('2026-01-01T00:00:00.000Z');

/** A service with a movable clock, so expiry is a fact about the test, not a sleep. */
function service(overrides: { secret?: string; ttlMs?: number } = {}) {
  let now = ISSUED.getTime();
  return {
    sessions: new InMemorySessionService(
      overrides.secret ?? 'a-secret-long-enough-to-be-realistic',
      overrides.ttlMs ?? 60_000,
      () => new Date(now),
    ),
    advance(ms: number): void {
      now += ms;
    },
  };
}

describe('InMemorySessionService', () => {
  it('issues a session whose token validates', () => {
    const { sessions } = service();
    const { token, record } = sessions.issue('installation-1');

    expect(token).not.toBe('');
    expect(record.installationId).toBe('installation-1');
    expect(record.tokenHash).toBe(hashCredential('a-secret-long-enough-to-be-realistic', token));
    // The raw token is not what is stored, so reading the record does not yield a
    // credential.
    expect(record.tokenHash).not.toBe(token);
    expect(sessions.validate(token)?.id).toBe(record.id);
  });

  it('issues a distinct token per session', () => {
    const { sessions } = service();
    const first = sessions.issue('installation-1');
    const second = sessions.issue('installation-1');

    expect(first.token).not.toBe(second.token);
    expect(first.record.id).not.toBe(second.record.id);
    // Both still validate, and neither validates as the other.
    expect(sessions.validate(first.token)?.id).toBe(first.record.id);
    expect(sessions.validate(second.token)?.id).toBe(second.record.id);
  });

  it('rejects a token it never issued', () => {
    const { sessions } = service();
    sessions.issue('installation-1');

    expect(sessions.validate('not-a-real-token')).toBeUndefined();
    expect(sessions.validate('')).toBeUndefined();
  });

  it('stops accepting a token once the session has expired', () => {
    const { sessions, advance } = service({ ttlMs: 1_000 });
    const { token } = sessions.issue('installation-1');
    expect(sessions.validate(token)).toBeDefined();

    // One millisecond before expiry it is still valid; the boundary is the contract.
    advance(999);
    expect(sessions.validate(token)).toBeDefined();

    advance(2);
    expect(sessions.validate(token)).toBeUndefined();
  });

  it('stops accepting a revoked token, and reports whether it did the revoking', () => {
    const { sessions } = service();
    const { token, record } = sessions.issue('installation-1');

    expect(sessions.revoke(record.id)).toBe(true);
    expect(sessions.validate(token)).toBeUndefined();
    // Revoking twice is not a second revocation, so a caller can treat `false` as
    // "already gone" rather than as a failure.
    expect(sessions.revoke(record.id)).toBe(false);
  });

  it('refuses to revoke a session that does not exist', () => {
    const { sessions } = service();
    expect(sessions.revoke('00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('leaves other sessions alone when one is revoked', () => {
    const { sessions } = service();
    const kept = sessions.issue('installation-1');
    const dropped = sessions.issue('installation-1');

    sessions.revoke(dropped.record.id);

    expect(sessions.validate(kept.token)?.id).toBe(kept.record.id);
    expect(sessions.validate(dropped.token)).toBeUndefined();
  });

  it('keeps sessions for two installations apart', () => {
    const { sessions } = service();
    const first = sessions.issue('installation-1');
    const second = sessions.issue('installation-2');

    expect(sessions.validate(first.token)?.installationId).toBe('installation-1');
    expect(sessions.validate(second.token)?.installationId).toBe('installation-2');
  });

  it('works with the default clock, which is how production constructs it', () => {
    // Every other case injects a movable clock. This one does not, so it covers the
    // `() => new Date()` default on `issue` — the construction `main.ts` and the
    // in-memory composition actually use, and the one an injected-clock test never
    // reaches.
    const sessions = new InMemorySessionService('a-secret', 60_000);
    const before = Date.now();
    const { token, record } = sessions.issue('installation-1');
    const after = Date.now();

    expect(record.issuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(record.issuedAt.getTime()).toBeLessThanOrEqual(after);
    expect(record.expiresAt.getTime()).toBe(record.issuedAt.getTime() + 60_000);
    expect(sessions.validate(token)?.id).toBe(record.id);
  });
});
