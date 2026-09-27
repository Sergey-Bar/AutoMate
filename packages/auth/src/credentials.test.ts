import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { hashCredential, verifyCredential, verifySharedSecret } from './credentials.js';

/**
 * `verifySharedSecret` replaces `validateApiKey`, whose second parameter was named
 * `storedHash` and whose body compared the presented value to whatever it was given.
 *
 * These cases are written around the shape that made it dangerous rather than around
 * the shape that made it work. Given a plaintext key it returned `true`, so every
 * test that only exercised the plaintext path passed and the name went unread. The
 * case that matters is the one where the caller does what the signature says and hands
 * it a hash.
 */
describe('verifySharedSecret', () => {
  const SECRET = 'k'.repeat(43);

  it('accepts the configured secret', () => {
    expect(verifySharedSecret(SECRET, SECRET)).toBe(true);
  });

  it('rejects a different secret of the same length', () => {
    // Same length on purpose: a length mismatch takes a different branch, so a test
    // using a shorter wrong value would not exercise the comparison at all.
    expect(verifySharedSecret('x'.repeat(43), SECRET)).toBe(false);
  });

  it('rejects a secret differing only in case', () => {
    expect(verifySharedSecret('K'.repeat(43), SECRET)).toBe(false);
  });

  it('rejects a shorter and a longer secret', () => {
    expect(verifySharedSecret('', SECRET)).toBe(false);
    expect(verifySharedSecret(`${SECRET}extra`, SECRET)).toBe(false);
  });

  it('rejects two empty secrets, where the old function accepted them', () => {
    // `validateApiKey('', '')` returned `true`. A deployment that configured an empty
    // API key authenticated anyone who sent an empty bearer token. There is no
    // configuration for which "both sides are empty" should mean "authorised".
    expect(verifySharedSecret('', '')).toBe(false);
  });

  it('rejects a stored hash, which is the defect the old signature invited', () => {
    // A caller reading `storedHash` and passing `hashCredential(pepper, key)` — the
    // stored form from the database — got `timingSafeEqual(presentedSecret, hash)`.
    // That is `false`, so it looked safe, and the signature still claimed a check the
    // code never performed.
    //
    // The assertion is deliberately one-directional. A *secret* must not authenticate
    // against a stored hash. The reverse — presenting the stored hash when the
    // deployment configured that hash as its secret — is a deployment that holds a
    // hash in the `apiKey` slot, which is the misconfiguration, not a defect in this
    // function: equal strings match, which is the whole contract.
    const stored = hashCredential('a-pepper', SECRET);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(verifySharedSecret(SECRET, stored)).toBe(false);
    expect(verifySharedSecret(stored, SECRET)).toBe(false);
  });

  it('does not treat a hash as a secret in the middleware either', () => {
    // The integration shape: a deployment that passes a hash where a secret belongs
    // must not authenticate the pre-image. Covered end to end in
    // `apps/api/src/middleware/auth.test.ts`; here it pins the primitive.
    const stored = hashCredential('a-pepper', SECRET);
    expect(verifySharedSecret(SECRET, stored)).toBe(false);
  });
});

describe('the two comparisons are not interchangeable', () => {
  const PEPPER = 'pepper-that-is-not-guessable';
  const KEY = 'k'.repeat(43);

  it('verifyCredential accepts the presented value and rejects a stored hash', () => {
    const stored = hashCredential(PEPPER, KEY);
    expect(verifyCredential(PEPPER, KEY, stored)).toBe(true);
    expect(verifyCredential(PEPPER, stored, stored)).toBe(false);
    expect(verifyCredential('wrong-pepper', KEY, stored)).toBe(false);
  });

  it('a hash is not interchangeable with a secret in either direction', () => {
    // Pins the distinction the names exist to make. If these two ever converge, one of
    // the two middleware arms is comparing the wrong kind of thing.
    const stored = createHmac('sha256', PEPPER).update(KEY, 'utf8').digest('hex');
    expect(verifySharedSecret(KEY, KEY)).toBe(true);
    expect(verifySharedSecret(KEY, stored)).toBe(false);
    expect(verifyCredential(PEPPER, KEY, stored)).toBe(true);
  });
});
