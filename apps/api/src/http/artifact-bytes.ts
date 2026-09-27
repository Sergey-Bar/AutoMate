/**
 * artifact-bytes.ts — decoding the bytes on an artifact upload.
 *
 * This was inline in the artifact route handler, and it is the densest block in the file:
 * a shape check, a padding adjustment, a decoded-size ceiling, and a decode. Six
 * branches, and each one is a rule about *the same thing* — "are these bytes a valid
 * artifact payload, and are they the size we are willing to accept" — so they belong in
 * one named place where a reader can see the whole rule at once, rather than inline in a
 * handler that also authenticates a runner, checks two lease predicates and writes a row.
 *
 * The size check is the one that earns its own function. **Base64 expands three bytes to
 * four**, so a limit applied to the *encoded* string lets a caller send 4/3 of the
 * intended maximum — and the request that is rejected is then the one that would have
 * been a 33% memory spike on the way in. So the ceiling is applied to the **decoded**
 * length, computed from the encoding rather than measured after the fact, because
 * measuring after the fact means already having allocated the oversized buffer.
 *
 * The returned shape is a discriminated union rather than a thrown error: the handler
 * needs to answer with four *different* status codes depending on which rule was broken
 * (400 for malformed, 413 for too large), and a throw would either lose that or force the
 * codes into a message string the boundary then has to parse.
 */

/** A payload that is not acceptable, with the answer the route should give. */
export interface ArtifactBytesRejection {
  ok: false;
  status: 400 | 413;
  code: 'INVALID_ARTIFACT_BYTES' | 'ARTIFACT_TOO_LARGE';
  message: string;
  details?: Record<string, unknown>;
}

export type ArtifactBytesResult = { ok: true; bytes: Uint8Array } | ArtifactBytesRejection;

/**
 * The byte length the encoded string will decode to, from the encoding alone.
 *
 * Four base64 characters carry three bytes, except the last group, whose padding says
 * how many of those three are absent. This is arithmetic on the *string*, so it can be
 * called before anything is allocated.
 *
 * Exported because the size rule is the part worth stating twice: in the gate, and in
 * whatever reads the value back.
 */
export function decodedLength(encoded: string): number {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

/**
 * Decode a base64 artifact payload, refusing anything malformed or oversized.
 *
 * `encoded` being `undefined` is **not** a rejection: an artifact with no bytes is an
 * empty artifact, which is legal, and the route's own schema decides whether the body
 * had to carry some.
 */
export function decodeArtifactBytes(
  encoded: string | undefined,
  maxBytes: number,
): ArtifactBytesResult {
  if (encoded === undefined || encoded === '') return { ok: true, bytes: new Uint8Array() };

  // Shape first. Node's `Buffer.from(..., 'base64')` does not throw on garbage — it
  // decodes what it can and drops the rest — so a check after decoding would accept a
  // payload that arrived corrupted, and the checksum would then be computed over bytes
  // the caller never sent.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_ARTIFACT_BYTES',
      message: 'Artifact bytes are invalid',
    };
  }

  // Before allocating: the whole point is to not hold an oversized buffer at all.
  const size = decodedLength(encoded);
  if (size > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: 'ARTIFACT_TOO_LARGE',
      message: 'Artifact exceeds the configured maximum size',
      details: { maxBytes },
    };
  }

  try {
    return { ok: true, bytes: new Uint8Array(Buffer.from(encoded, 'base64')) };
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'INVALID_ARTIFACT_BYTES',
      message: 'Artifact bytes are invalid',
    };
  }
}
