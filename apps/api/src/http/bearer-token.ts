/**
 * bearer-token.ts — the one place a `Bearer` credential is read out of a header.
 *
 * There were **five** parsers across `apps/api/src`, and they disagreed about four
 * things. The divergence was not cosmetic: the same credential could be accepted on
 * one route and rejected on the other.
 *
 * | parser | trims | empty token | scheme case |
 * | --- | --- | --- | --- |
 * | `middleware/auth.ts` | no | 401 | exact `Bearer` |
 * | `routes/execution.ts` | yes | 401 | exact `Bearer` |
 * | `routes/reporter.ts` | no | **403** | exact `Bearer` |
 * | `routes/reporter-results.ts` | yes | 401 | exact `Bearer` |
 * | `routes/runner.ts` | yes | 401 | exact `Bearer` |
 *
 * So `Authorization: Bearer  <token>` — two spaces, which a client assembling the
 * header from `'Bearer ' + token` produces the moment the token is already trimmed
 * by something else — authenticated against `execution.ts` and `runner.ts` and was
 * rejected by `middleware/auth.ts` and `reporter.ts`. And an empty token
 * (`Authorization: Bearer `) was a 403 on `reporter.ts` and a 401 everywhere else,
 * so a client could not tell "you sent nothing" from "you sent the wrong thing".
 *
 * The case row is a real defect too: RFC 6750 §2.1 defines the scheme as
 * case-insensitive, so `bearer <token>` and `BEARER <token>` are valid requests
 * that all five rejected.
 *
 * **What this changes, and in which direction.** Case-insensitivity and trimming
 * both *widen* the set of accepted credentials. Nothing that authenticated before
 * stops authenticating; credentials that were previously rejected on a
 * now-accepted spelling start working. That is the safe direction for a
 * compatibility fix — a narrowing would lock out callers who are working today.
 * The one behaviour that changes to an *error code* is the empty token on
 * `reporter.ts`, which becomes a 401 (a missing credential) instead of a 403 (a
 * wrong one), matching every other route.
 *
 * Comparison is the caller's job: this returns the token, not a verdict. A parser
 * that also compared the secret would be the second thing deciding what a valid
 * credential is, which is the mistake this module exists to remove.
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
