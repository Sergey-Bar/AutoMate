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
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(
    private readonly secret: string,
    private readonly ttlMs: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    this.sessions.set(record.id, record);
    return { token, record };
  }

  validate(token: string): SessionRecord | undefined {
    const record = [...this.sessions.values()].find((candidate) =>
      verifyCredential(this.secret, token, candidate.tokenHash),
    );
    if (!record || record.revokedAt || record.expiresAt <= this.now()) return undefined;
    return record;
  }

  revoke(id: string): boolean {
    const record = this.sessions.get(id);
    if (!record || record.revokedAt) return false;
    record.revokedAt = this.now();
    return true;
  }
}
