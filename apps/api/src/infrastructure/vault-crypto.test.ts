import { createCipheriv, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  VaultRowUnboundError,
  aadFor,
  clearKeyCache,
  keyCacheSize,
  keyFor,
  openLegacySecret,
  openSecret,
  sealSecret,
  type VaultRowBinding,
} from './vault-crypto.js';

/**
 * P-8, and the defect the rest of this file is about.
 *
 * `sealSecret` took no statement of *which* secret it was sealing, so an envelope could
 * be written into any vault row and would open there. A vault holding one credential per
 * connector returned GitHub's secret when asked for Jira's, and **nothing failed** — no
 * exception, no log line, a clean 200. That is the shape of the worst security finding
 * in this ledger: not a bug that leaks under stress, but one that works perfectly at
 * rest.
 *
 * GCM has a mechanism for exactly this and it was not used: additional authenticated
 * data. The AAD is authenticated but not encrypted, so binding costs nothing.
 */

const SECRET_A = 'a'.repeat(43);
const SECRET_B = 'b'.repeat(43);

const GITHUB: VaultRowBinding = {
  entryId: 'entry-github',
  workspaceId: 'workspace-1',
  name: 'github',
};
const JIRA: VaultRowBinding = {
  entryId: 'entry-jira',
  workspaceId: 'workspace-1',
  name: 'jira',
};

beforeEach(() => clearKeyCache());
/**
 * An envelope produced the way the code produced them before row binding: sealed with
 * no AAD at all, and tagged without one.
 *
 * Written out here rather than exported from the module, because a production export
 * for "seal an unbound secret" is precisely the capability the fix removes. A test that
 * could mint one would be a test that could un-fix it.
 */
function legacyEnvelope(plaintext: string, secret: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(secret, salt.toString('base64url')), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    version: 1 as const,
    algorithm: 'aes-256-gcm' as const,
    keyVersion: 1,
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

describe('a vault envelope is bound to its row', () => {
  it('round-trips a secret for the row that holds it', () => {
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    expect(openSecret(envelope, SECRET_A, GITHUB)).toBe('the credential');
  });

  it("refuses to open one row's envelope in another row", () => {
    // The finding, stated as a test. GitHub's ciphertext in Jira's row, read as Jira's
    // secret — which before the fix is exactly what happened, silently.
    const envelope = sealSecret('ghp_github_secret', SECRET_A, GITHUB);
    expect(() => openSecret(envelope, SECRET_A, JIRA)).toThrow();
  });

  it('refuses when only the name differs', () => {
    const envelope = sealSecret('ghp_github_secret', SECRET_A, GITHUB);
    expect(() => openSecret(envelope, SECRET_A, { ...GITHUB, name: 'bitbucket' })).toThrow();
  });

  it('refuses when only the workspace differs', () => {
    // The tenancy boundary, at the one place a credential could cross it.
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    expect(() =>
      openSecret(envelope, SECRET_A, { ...GITHUB, workspaceId: 'workspace-2' }),
    ).toThrow();
  });

  it('refuses when only the entry id differs, even for identical name and workspace', () => {
    // Two rows in the same workspace holding the same connector name — which is what a
    // non-unique `connectorName` column permits. The id is in the binding precisely so
    // this case is caught rather than served.
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    expect(() => openSecret(envelope, SECRET_A, { ...GITHUB, entryId: 'entry-other' })).toThrow();
  });

  it('refuses a binding whose fields could be confused by a naive join', () => {
    // The subtlety that makes the length-prefixing in `aadFor` load-bearing. Without
    // it, workspace `a` / name `b:c` and workspace `a:b` / name `c` produce identical
    // AAD bytes, and one row's ciphertext opens in the other. With it they cannot.
    const left: VaultRowBinding = { entryId: 'e', workspaceId: 'a', name: 'b:c' };
    const right: VaultRowBinding = { entryId: 'e', workspaceId: 'a:b', name: 'c' };
    expect(aadFor(left).equals(aadFor(right))).toBe(false);
  });

  it('refuses to seal without a complete row identity', () => {
    // Required, not defaulted. An envelope sealed with a blank binding is exactly the
    // unbound envelope this row exists to prevent.
    for (const binding of [
      { entryId: '', workspaceId: 'w', name: 'n' },
      { entryId: 'e', workspaceId: '', name: 'n' },
      { entryId: 'e', workspaceId: 'w', name: '' },
    ]) {
      expect(() => sealSecret('x', SECRET_A, binding), JSON.stringify(binding)).toThrow(
        /complete row identity/,
      );
    }
  });
});

describe('envelopes sealed before row binding existed', () => {
  it('are refused by name rather than reported as a failed tag', () => {
    // The two conditions need opposite responses: a wrong AAD means the ciphertext was
    // moved, and a v1 envelope means the data is intact and merely unattributable. A
    // caller that cannot tell them apart will delete recoverable data.
    const legacy: ReturnType<typeof sealSecret> = {
      ...sealSecret('the credential', SECRET_A, GITHUB),
      version: 1 as 1 | 2,
    };
    expect(() => openSecret(legacy, SECRET_A, GITHUB)).toThrow(VaultRowUnboundError);
    expect(() => openSecret(legacy, SECRET_A, GITHUB)).toThrow(/must be re-sealed in place/);
  });

  it('can still be read for repair, through a separate entry point', () => {
    // Re-sealing is possible precisely because the old envelope was never bound to
    // anything, so its plaintext is intact — which is the reason the error says "do not
    // delete it" rather than "this is corrupt".
    // Built with raw crypto rather than by downgrading a v2 envelope. A v2 envelope
    // has its AAD folded into the tag, so reopening it without the AAD fails — which is
    // correct, and means "version: 1" written over a bound envelope is not a v1
    // envelope at all. Constructing the real thing keeps this test honest about what the
    // repair tool will actually encounter in the database.
    const legacy = legacyEnvelope('the credential', SECRET_A);
    expect(openLegacySecret(legacy, SECRET_A)).toBe('the credential');
  });

  it('refuses to use the repair path on a bound envelope', () => {
    // If `openLegacySecret` accepted a v2 envelope it would be an unauthenticated read
    // with the AAD skipped, and a caller would reach for it precisely when it is
    // convenient — which is exactly when an unbound read is least wanted.
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    expect(() => openLegacySecret(envelope, SECRET_A)).toThrow(/for version 1 envelopes only/);
  });
});

describe('envelope integrity', () => {
  it('rejects an envelope it does not understand', () => {
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    expect(() => openSecret({ ...envelope, version: 3 as 2 }, SECRET_A, GITHUB)).toThrow(
      /Unsupported vault envelope/,
    );
    expect(() =>
      openSecret({ ...envelope, algorithm: 'aes-128-cbc' as 'aes-256-gcm' }, SECRET_A, GITHUB),
    ).toThrow(/Unsupported vault envelope/);
  });

  it('rejects a tampered ciphertext rather than returning corrupt plaintext', () => {
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    const raw = Buffer.from(envelope.ciphertext, 'base64url');
    raw[0] = (raw[0] ?? 0) ^ 0xff;
    expect(() =>
      openSecret({ ...envelope, ciphertext: raw.toString('base64url') }, SECRET_A, GITHUB),
    ).toThrow();
  });

  it('rejects a swapped authentication tag', () => {
    // The tag is the AAD's guarantee as much as the ciphertext's; an attacker who can
    // substitute a tag from another row has to defeat the AAD, and this asserts it does.
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    const other = sealSecret('the credential', SECRET_A, JIRA);
    expect(() => openSecret({ ...envelope, tag: other.tag }, SECRET_A, GITHUB)).toThrow();
  });
});

describe('key derivation', () => {
  it('never serves a key derived from a previous secret', () => {
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    expect(openSecret(envelope, SECRET_A, GITHUB)).toBe('the credential');
    expect(() => openSecret(envelope, SECRET_B, GITHUB)).toThrow();
  });

  it('bounds the cache', () => {
    for (let index = 0; index < 300; index += 1) {
      openSecret(sealSecret(`value-${String(index)}`, SECRET_A, GITHUB), SECRET_A, GITHUB);
    }
    expect(keyCacheSize()).toBeLessThanOrEqual(256);
  });

  it('makes a repeated read materially cheaper than the first', () => {
    const envelope = sealSecret('the credential', SECRET_A, GITHUB);
    // `sealSecret` derives and caches the key on the way in, so without this the
    // "first" read would find a warm cache and measure nothing at all — which is why
    // this test could previously fail or pass by accident depending on ordering.
    clearKeyCache();
    const firstStart = process.hrtime.bigint();
    openSecret(envelope, SECRET_A, GITHUB);
    const first = Number(process.hrtime.bigint() - firstStart) / 1e6;

    const secondStart = process.hrtime.bigint();
    for (let index = 0; index < 20; index += 1) openSecret(envelope, SECRET_A, GITHUB);
    const twenty = Number(process.hrtime.bigint() - secondStart) / 1e6;

    // `pbkdf2Sync` at 100 000 iterations costs tens of milliseconds; twenty cached reads
    // must not cost twenty of those.
    expect(twenty).toBeLessThan(first);
  });

  it('refuses a secret that is too short, before touching the cache', () => {
    expect(() => sealSecret('x', 'short', GITHUB)).toThrow(/at least 32 characters/);
  });

  it('derives the same key for the same secret and salt', () => {
    expect(keyFor(SECRET_A, 'salt-1')).toEqual(keyFor(SECRET_A, 'salt-1'));
    expect(keyFor(SECRET_A, 'salt-1')).not.toEqual(keyFor(SECRET_A, 'salt-2'));
  });
});
