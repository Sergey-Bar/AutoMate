/**
 * The one place a `Bearer` credential is read out of a header.
 *
 * Comparison is the caller's job: this returns the token, not a verdict. A parser that
 * also compared the secret would be the second thing deciding what a valid credential
 * is, which is the mistake this module exists to remove.
 */

/** The scheme, in the casing RFC 6750 permits. */
const BEARER_SCHEME = 'bearer';

/**
 * The credential from an `Authorization` header, or `undefined` when there is not
 * a usable one.
 *
 * `undefined` covers all three "no credential here" cases — no header, a different
 * scheme, and the scheme with nothing after it — because a caller cannot act on any
 * of them differently. Returning `''` for one and `undefined` for another is what
 * let the same mistake surface as two different status codes.
 */
export function bearerToken(header: string | undefined | null): string | undefined {
  if (typeof header !== 'string') return undefined;
  // Trimmed first, so a header padded by a proxy or a hand-rolled client still has
  // its scheme at the front. Then the first space separates the scheme from the
  // credential: RFC 6750's `token68` grammar excludes spaces from a token, so the
  // first one is unambiguously the separator however many follow.
  const trimmed = header.trim();
  const separator = trimmed.indexOf(' ');
  if (separator === -1) return undefined;
  // Case-insensitive, per RFC 6750 §2.1. Compared on the prefix only, so a token
  // that happens to contain the word is not mistaken for a scheme.
  if (trimmed.slice(0, separator).toLowerCase() !== BEARER_SCHEME) return undefined;
  // A second trim for the whitespace *between* the scheme and the token, which is
  // the case `'Bearer ' + alreadyTrimmedToken` produces.
  const token = trimmed.slice(separator + 1).trim();
  return token.length > 0 ? token : undefined;
}
