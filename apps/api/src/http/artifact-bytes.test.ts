import { describe, expect, it } from 'vitest';
import { decodeArtifactBytes, decodedLength } from './artifact-bytes.js';

/**
 * The artifact byte decoder, on its own.
 *
 * These rules were six inline branches in the artifact route handler, which meant the
 * only way to test them was to upload an artifact — so the one that matters most, the
 * **size** rule, was never tested as a rule at all. It was tested incidentally, by the
 * uploads that happened to be large enough, and it is the rule with a memory implication:
 * base64 expands three bytes to four, so a ceiling applied to the encoded string admits
 * a payload 33% larger than the one the operator configured.
 *
 * That asymmetry is the reason the ceiling is computed from the *encoding*, before
 * anything is allocated. Checking after decoding would mean already holding the oversized
 * buffer, which is the thing the limit exists to prevent.
 */

const encode = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

describe('decodedLength is arithmetic on the encoding, not on a decoded buffer', () => {
  it('reads the padding to know how many of the last three bytes are absent', () => {
    // Four base64 characters carry three bytes. The final group carries fewer, and how
    // many is exactly what the padding says — which is why the length cannot be
    // `encoded.length / 4 * 3`.
    expect(decodedLength('AAAA')).toBe(3);
    expect(decodedLength('AAA=')).toBe(2);
    expect(decodedLength('AA==')).toBe(1);
    expect(decodedLength('AAAAAAA=')).toBe(5);
  });

  it('agrees with what the decoder actually produced', () => {
    for (const size of [0, 1, 2, 3, 4, 5, 17, 255]) {
      const bytes = new Uint8Array(size).fill(65);
      const decoded = decodeArtifactBytes(encode(bytes), 1024);
      expect(decoded.ok).toBe(true);
      if (decoded.ok) {
        // The arithmetic is only trustworthy if it matches reality, so it is checked
        // against the buffer rather than against itself.
        expect(decoded.bytes.byteLength).toBe(size);
        expect(decodedLength(encode(bytes))).toBe(size);
      }
    }
  });
});

describe('the ceiling is applied to the decoded size, not the encoded one', () => {
  it('rejects a payload that only fits once base64 expansion is undone', () => {
    // 8 bytes is 12 base64 characters. A limit of 8 bytes accepts the *decoded* payload
    // exactly; applied to the encoded string, 12 > 8 would have rejected it.
    const eight = encode(new Uint8Array(8).fill(7));
    expect(eight.length).toBe(12);
    expect(decodeArtifactBytes(eight, 8).ok).toBe(true);

    // Nine bytes is 12 characters too — the padding differs — and must be refused,
    // because a limit compared against the encoded length could not tell these apart.
    const nine = encode(new Uint8Array(9).fill(7));
    expect(nine.length).toBe(12);
    const refused = decodeArtifactBytes(nine, 8);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.status).toBe(413);
      expect(refused.code).toBe('ARTIFACT_TOO_LARGE');
      // The configured limit travels with the refusal, so a caller can size its next
      // attempt without reading the server's configuration.
      expect(refused.details).toEqual({ maxBytes: 8 });
    }
  });

  it('never allocates before it has decided, which is the point of the arithmetic', () => {
    // A megabyte of base64 for a 1 KB limit: refused, and the refusal is the only thing
    // this call produces. A decoder that checked after allocating would already be
    // holding ~750 KB of buffer by the time it said no.
    const large = encode(new Uint8Array(1024 * 1024).fill(1));
    const result = decodeArtifactBytes(large, 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('ARTIFACT_TOO_LARGE');
  });
});

describe('malformed input is refused rather than silently repaired', () => {
  it('refuses a payload whose characters are not base64', () => {
    // Node's `Buffer.from(x, 'base64')` does not throw on garbage: it decodes what it
    // can and drops the rest. A check after decoding would therefore accept a payload
    // that arrived corrupted, and the checksum computed over it would be a checksum of
    // bytes the caller never sent — which is worse than a 400, because it looks valid.
    for (const encoded of ['!!!!', 'AAAA=', 'A===', 'AA=A', 'abc!def', 'AAAA\n']) {
      const result = decodeArtifactBytes(encoded, 1024);
      expect(result.ok, `${JSON.stringify(encoded)} was accepted`).toBe(false);
      if (!result.ok) expect(result.code).toBe('INVALID_ARTIFACT_BYTES');
    }
  });

  it('refuses a length that is not a whole number of base64 groups', () => {
    for (const encoded of ['A', 'AA', 'AAA', 'AAAAA']) {
      expect(decodeArtifactBytes(encoded, 1024).ok, encoded).toBe(false);
    }
  });

  it('refuses before it decodes, so a huge malformed payload is not read at all', () => {
    const huge = 'A'.repeat(4_000_000) + '!';
    const result = decodeArtifactBytes(huge, 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('INVALID_ARTIFACT_BYTES');
  });
});

describe('an artifact with no bytes is legal', () => {
  it('accepts absent and empty payloads as an empty artifact', () => {
    // A runner uploading metadata before the trace exists is normal, and the route's own
    // schema decides whether a body had to carry some. Treating "no bytes" as malformed
    // would make a legal sequence of uploads a 400.
    for (const encoded of [undefined, '']) {
      const result = decodeArtifactBytes(encoded, 1024);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.bytes.byteLength).toBe(0);
    }
  });
});
