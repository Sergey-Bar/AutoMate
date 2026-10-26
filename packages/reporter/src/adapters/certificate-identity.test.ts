import type { X509Certificate } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { certificateIdentity, identityTrusted } from './certificate-identity.js';

/** Just the two fields the reader touches, so malformed inputs can be built directly. */
const fake = (subjectAltName: string | undefined, raw: Uint8Array = new Uint8Array()) =>
  ({ subjectAltName, raw: Buffer.from(raw) }) as unknown as X509Certificate;

const tlv = (tag: number, body: number[]): number[] => [tag, body.length, ...body];
const bytes = (text: string) => [...Buffer.from(text)];
// 1.3.6.1.4.1.57264.1.8 and .1.1 as OBJECT IDENTIFIER content octets.
const ISSUER_V2 = [0x2b, 6, 1, 4, 1, 0x83, 0xbf, 0x30, 1, 8];
const ISSUER_LEGACY = [0x2b, 6, 1, 4, 1, 0x83, 0xbf, 0x30, 1, 1];

/** Certificate → tbs → [3] → Extensions, with no other fields: all the reader walks. */
function withExtensions(...extensions: number[][]): Uint8Array {
  const list = tlv(0x30, extensions.flat());
  return new Uint8Array(tlv(0x30, tlv(0x30, tlv(0xa3, list))));
}
const extension = (oid: number[], value: number[]) =>
  tlv(0x30, [...tlv(0x06, oid), ...tlv(0x04, value)]);

describe('certificateIdentity', () => {
  it('reads URI and email SANs, skips other kinds, and decodes a value Node escaped', () => {
    const identity = certificateIdentity(
      fake('DNS:example.com, URI:https://a.example/x, email:"a,b@example.com", IP Address:1.2.3.4'),
    );
    expect(identity.subjects).toEqual(['https://a.example/x', 'a,b@example.com']);
  });

  it('stops at an escaped value it cannot read, and reads nothing from oversized or absent text', () => {
    expect(certificateIdentity(fake('URI:https://a.example, email:"broken\\')).subjects).toEqual([
      'https://a.example',
    ]);
    expect(certificateIdentity(fake(`URI:${'a'.repeat(9000)}`)).subjects).toEqual([]);
    expect(certificateIdentity(fake(undefined)).subjects).toEqual([]);
  });

  it('prefers the DER issuer extension, falls back to the legacy one, and guesses nothing', () => {
    const v2 = extension(ISSUER_V2, tlv(0x0c, bytes('https://v2.example')));
    const legacy = extension(ISSUER_LEGACY, bytes('https://legacy.example'));
    expect(certificateIdentity(fake('', withExtensions(legacy, v2))).issuer).toBe(
      'https://v2.example',
    );
    // A .8 value that is not a UTF8String is not read; the legacy one still is.
    const notUtf8 = extension(ISSUER_V2, tlv(0x04, bytes('x')));
    expect(certificateIdentity(fake('', withExtensions(notUtf8, legacy))).issuer).toBe(
      'https://legacy.example',
    );
    expect(certificateIdentity(fake('', withExtensions(notUtf8))).issuer).toBeNull();
    // An extension with no OID or no value is skipped.
    expect(certificateIdentity(fake('', withExtensions(tlv(0x30, [])))).issuer).toBeNull();
  });

  it('reads no issuer from DER that is truncated, empty, or claims an absurd length', () => {
    const good = withExtensions(extension(ISSUER_LEGACY, bytes('https://legacy.example')));
    expect(certificateIdentity(fake('', good.subarray(0, good.length - 3))).issuer).toBeNull();
    expect(certificateIdentity(fake('', new Uint8Array())).issuer).toBeNull();
    expect(
      certificateIdentity(fake('', new Uint8Array([0x30, 0x85, 1, 1, 1, 1, 1]))).issuer,
    ).toBeNull();
    expect(certificateIdentity(fake('', new Uint8Array([0x30, 0x80]))).issuer).toBeNull();
    expect(certificateIdentity(fake('', new Uint8Array(tlv(0x30, [])))).issuer).toBeNull();
  });
});

describe('identityTrusted', () => {
  const identity = { subjects: ['https://a.example/x'], issuer: 'https://issuer.example' };
  it('needs the exact subject, and the issuer only when the policy names one', () => {
    expect(identityTrusted(identity, [{ subject: 'https://a.example/x' }])).toBe(true);
    expect(
      identityTrusted(identity, [
        { subject: 'https://a.example/x', issuer: 'https://issuer.example' },
      ]),
    ).toBe(true);
    expect(
      identityTrusted(identity, [{ subject: 'https://a.example/x', issuer: 'https://other' }]),
    ).toBe(false);
    expect(identityTrusted(identity, [{ subject: 'https://a.example/' }])).toBe(false);
    expect(identityTrusted({ subjects: [], issuer: null }, [])).toBe(false);
  });
});
