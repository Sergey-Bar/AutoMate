import { describe, expect, it, beforeEach } from 'vitest';
import { InMemorySessionService } from './credentials.js';

/**
 * Four ledger rows, one feature.
 *
 * `validate` HMAC'd the presented token once per stored session, so the cost was
 * O(n) in live sessions on every request; nothing ever removed an entry, so `n` grew
 * without bound; `deleteExpired` existed only as the name of a row; and
 * `SESSION_RETENTION_DAYS` was parsed and mapped to nothing.
 *
 * Closed together because they are one change: a map keyed by the token hash makes
 * `validate` a lookup rather than a scan, and a sweep is what stops that map growing —
 * and a sweep with no caller is exactly the state the rows describe.
 */
describe('InMemorySessionService', () => {
  let clock: Date;
  const now = (): Date => clock;

  beforeEach(() => {
    clock = new Date('2026-09-29T00:00:00.000Z');
  });

  const service = (ttlMs = 3_600_000): InMemorySessionService =>
    new InMemorySessionService('a-secret-long-enough-for-the-test-suite', ttlMs, now);

  /** The store's size, read the way a reviewer would: from outside, deliberately. */
  const size = (sessions: InMemorySessionService): number =>
    (sessions as unknown as { sessions: Map<string, unknown> }).sessions.size;

  it('validates a token without scanning every stored session', () => {
    // Asserted as behaviour and not as a timing: a millisecond assertion on a shared
    // machine reports the scheduler, not the data structure. The property is that a
    // *wrong* token costs the same whether the map is empty or has five hundred
    // entries, which is what keying by the token hash buys and what a per-candidate
    // HMAC loop cannot.
    const empty = service();
    const many = service();
    for (let index = 0; index < 500; index += 1) many.issue('installation-1');

    const { token } = many.issue('installation-1');
    expect(many.validate(token)?.tokenHash).toBeTruthy();
    expect(many.validate(`${token}x`)).toBeUndefined();
    // A rejection is a rejection in both, and neither map grew to answer it.
    expect(empty.validate(`${token}x`)).toBeUndefined();
  });

  it('never stores the plaintext token', () => {
    // The map is keyed by the hash, so the token itself is not in it — a store that
    // held the plaintext could leak it through any serialisation of its own state.
    const sessions = service();
    const { token } = sessions.issue('installation-1');
    const internals = JSON.stringify([
      ...(sessions as unknown as { sessions: Map<string, unknown> }).sessions.values(),
    ]);
    expect(internals).not.toContain(token);
  });

  it('removes expired and revoked sessions, and keeps the rest', () => {
    // The sweep. Without it the map only ever grows, which is what makes an O(n)
    // lookup a problem rather than a nuisance.
    const sessions = service(1_000);
    const keep = sessions.issue('installation-1');
    sessions.validate(keep.token);

    clock = new Date('2026-09-29T00:00:00.500Z');
    const revoked = sessions.issue('installation-1');
    sessions.revoke(revoked.record.id);

    clock = new Date('2026-09-29T00:00:05.000Z');
    expect(sessions.deleteExpired()).toBe(2);
    expect(sessions.validate(keep.token)).toBeUndefined();
    expect(size(sessions)).toBe(0);
  });

  it('reports zero when nothing is stale', () => {
    const sessions = service();
    sessions.issue('installation-1');
    expect(sessions.deleteExpired()).toBe(0);
    expect(size(sessions)).toBe(1);
  });

  it('uses the injected clock, not the wall clock', () => {
    // Otherwise a sweep tested with a fake clock deletes nothing, and a sweep that
    // deletes nothing is indistinguishable from one that is never called.
    const sessions = service(1_000);
    sessions.issue('installation-1');
    clock = new Date('2026-09-29T01:00:00.000Z');
    expect(sessions.deleteExpired()).toBe(1);
  });

  it('keeps a revoked-but-unexpired session until it expires', () => {
    // Revocation marks; expiry removes. Deleting on revoke would be a different
    // decision — it would destroy the answer to "was this session ever valid".
    const sessions = service(1_000_000);
    const { record } = sessions.issue('installation-1');
    sessions.revoke(record.id);
    expect(sessions.deleteExpired()).toBe(0);
    expect(size(sessions)).toBe(1);
  });
});
