import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashCredential(secret: string, credential: string): string {
  return createHmac('sha256', secret).update(credential, 'utf8').digest('hex');
}

export function verifyCredential(
  secret: string,
  credential: string,
  expectedHash: string,
): boolean {
  const actual = Buffer.from(hashCredential(secret, credential), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Constant-time comparison of a presented value against a configured **secret**.
 *
 * This replaces `validateApiKey`, which had the same body and a name that said
 * `storedHash`. That mismatch was the defect: a caller who passed a hash got
 * `timingSafeEqual(presentedSecret, storedHash)`, which is a comparison of two
 * unrelated values and returns `false` for the right reason by accident. It returned
 * `false` for the *wrong* reason, and a caller who read the signature would reasonably
 * believe a hash had been checked. `apps/api/src/middleware/auth.ts` called it on the
 * in-memory fallback arm, so it was live, not dead code.
 *
 * The name is the point. This compares two plaintext secrets the process already
 * holds; it does not and cannot verify a hash. Anything that needs hash verification
 * wants `verifyCredential`, which needs a pepper.
 *
 * @param provided the value the caller presented
 * @param expected the configured secret
 */
export function verifySharedSecret(provided: string, expected: string): boolean {
  // Two empty strings are equal, and `timingSafeEqual` on two empty buffers says so.
  // That is a true statement about the comparison and the wrong answer to the
  // question: a deployment whose API key resolved to the empty string would
  // authenticate any caller who sent an empty bearer token. `validateApiKey` returned
  // `true` here, and `apps/api/src/middleware/auth.ts` reached it whenever
  // `installationApiKey` was unset. The middleware no longer can — an empty
  // `apiKey` is falsy and never reaches this function — but the primitive has to be
  // safe on its own, because the next caller will not know that.
  if (provided.length === 0 || expected.length === 0) {
    // Still burn a comparison so an empty input is not distinguishable by timing
    // from a short one.
    timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  const actual = Buffer.from(provided, 'utf8');
  const known = Buffer.from(expected, 'utf8');
  if (actual.length !== known.length) {
    // A length mismatch is reported without skipping the comparison: the branch
    // itself leaks the length, which is inherent to comparing variable-length inputs
    // and is why the configured secret is a fixed-width token.
    timingSafeEqual(known, known);
    return false;
  }
  return timingSafeEqual(actual, known);
}

export interface SessionRecord {
  id: string;
  tokenHash: string;
  installationId: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt?: Date;
}

export class InMemorySessionService {
  /**
   * Live sessions, keyed by the token's hash.
   *
   * **Ledger S-1 and S-2, which are the same defect.** It used to be keyed by record
   * id, so `validate` could not look a presented token up and instead walked every
   * entry, running a keyed HMAC and a constant-time comparison on each — O(n) in live
   * sessions, on **every request**. And nothing ever removed an entry: `revoke` only
   * stamped `revokedAt`, so `n` grew without bound and the scan grew with it. A
   * thousand sessions meant a thousand HMACs per request, forever.
   *
   * Keyed by the hash, `validate` hashes the presented token once and looks it up.
   * Hashing is not the sensitive part — comparing two values is, and that still goes
   * through {@link verifyCredential} — so the constant-time property is untouched and
   * the scan is gone. Production already used an indexed store, which is why the cost
   * was invisible there; this is the development path.
   */
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly secret: string,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    // Ledger S-4. A zero or negative TTL produced `expiresAt === issuedAt`, so
    // `issue` returned a token that `validate` rejected on the very next line — a
    // service that appears to work and hands back a session that is already dead.
    // Refused here rather than discovered by a caller.
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error('InMemorySessionService requires a positive, finite ttlMs');
    }
    // **A correction to the row, deliberately weaker than the row claims.** The row
    // calls an empty secret "trivially verifiable"; it is not. An empty key still
    // produces a keyed HMAC over a 32-byte random token, so knowing the secret does
    // not let anyone mint a valid token without the preimage. The real cost of an
    // empty secret is that `hashCredential` stops being a secret operation at all —
    // it becomes a plain digest of a value in the spool. So this is a hardening
    // refusal, not a forgery hole, and is recorded as one.
    //
    // Production cannot reach either case: `resolveAuthSecrets` refuses a missing
    // `COOKIE_SECRET` and floors it at 32 characters.
    if (secret.length === 0) {
      throw new Error('InMemorySessionService requires a non-empty secret');
    }
  }

  issue(installationId: string): { token: string; record: SessionRecord } {
    const token = createOpaqueToken();
    const issuedAt = this.now();
    const record: SessionRecord = {
      id: randomBytes(16).toString('hex'),
      tokenHash: hashCredential(this.secret, token),
      installationId,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + this.ttlMs),
    };
    // Keyed by the hash, so a presented token is one lookup rather than a scan.
    this.sessions.set(record.tokenHash, record);
    // Ledger S-3. This used to hand back the stored object itself, so a caller could
    // write `record.expiresAt = <the far future>` or `delete record.revokedAt` and
    // change the service's own state — extending a session, or un-revoking one,
    // through a value it was only given to read. The durable backend already builds
    // its record locally, writes a field-by-field copy, and returns the literal, so
    // the two implementations disagreed on whether the return value *is* the store.
    // They do not now: the caller gets a copy and the store keeps the original.
    return { token, record: { ...record } };
  }

  validate(token: string): SessionRecord | undefined {
    // One hash of the presented token, one lookup. The previous version ran a fresh
    // HMAC *and* a constant-time comparison against every stored session, per
    // request — see the note on the field above.
    const hash = hashCredential(this.secret, token);
    const record = this.sessions.get(hash);
    if (record === undefined) return undefined;
    // No second comparison. There used to be one, and it was dead code by
    // construction: the map is keyed by `hashCredential(secret, token)` — the very
    // value `verifyCredential` would have compared against — so a record found by
    // that key always compares equal, and the branch was unreachable.
    //
    // The property it was there to preserve still holds, and holds more directly. The
    // loop it replaced ran one comparison per stored session so that a presented
    // token cost the same whatever the collection's size. A map lookup costs the same
    // whatever the collection's size, so a caller cannot learn how many live
    // sessions there are from how long validation took. The HMAC is the secret
    // operation; the lookup is against its output.
    if (record.revokedAt || record.expiresAt <= this.now()) return undefined;
    return record;
  }

  revoke(id: string): boolean {
    // Still scans: `id` is a record id and the map is keyed by the token hash, so a
    // lookup would need a second index to be worth having. Revocation is rare and
    // not on the request path, which is where the O(n) cost used to hurt.
    for (const record of this.sessions.values()) {
      if (record.id !== id) continue;
      if (record.revokedAt) return false;
      record.revokedAt = this.now();
      return true;
    }
    return false;
  }

  /**
   * Removes every session that has expired, and returns how many went.
   *
   * **Ledger S-7, which named this method before it existed.** Revocation marks and
   * expiry discards are kept apart on purpose: deleting a *revoked* session on revoke
   * would destroy the answer to "was this ever a valid session", and the durable
   * backend keeps the row for the same reason. So the sweep removes on expiry, and a
   * revoked session goes when it would have expired anyway.
   *
   * There must be a caller. A sweep that is defined and never invoked removes nothing
   * and reports nothing, which is the state the row described — the method existing
   * is not the retention; the retention is somebody calling it.
   *
   * @returns how many sessions were removed
   */
  deleteExpired(): number {
    const at = this.now();
    let removed = 0;
    for (const [hash, record] of this.sessions) {
      if (record.expiresAt > at) continue;
      this.sessions.delete(hash);
      removed += 1;
    }
    return removed;
  }
}
