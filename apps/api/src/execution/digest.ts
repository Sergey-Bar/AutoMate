import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * One canonical serialisation, for everything that hashes a value to identify it.
 *
 * `JSON.stringify` preserves key insertion order, so `{"a":1,"b":2}` and `{"b":2,"a":1}`
 * are the same value and produce different strings. Anywhere that hashes a value to
 * answer "is this the same thing I already have?" inherits that ambiguity, and the
 * answer it gives is *no* — which is the answer that costs the most, because the
 * recovery from a false negative is to redo the work rather than to resend it.
 *
 * This file exists because there were three byte-identical copies of the function in
 * `execution/` — in `quality-gate.ts`, `drizzle-execution-store.ts` and
 * `in-memory-execution-store.ts` — and a fourth was about to be written in
 * `services/runner-control.ts`. Four copies is not a deduplication problem; it is a
 * rule with no home, and the next person to need it writes the fifth.
 *
 * Named `digest` rather than `canonical` because `execution/canonical.ts` is already
 * the *contract projection* module — it maps an `ExecutionRun` onto the public
 * `NormalizedRun` shape. Two modules called "canonical", meaning two unrelated things,
 * is the naming that made the third copy invisible in the first place.
 *
 * **Arrays keep their order.** A list is ordered data, and sorting it would make
 * `steps: [1, 2]` and `steps: [2, 1]` hash the same — which, for a digest that
 * identifies work, is worse than the key-order ambiguity this file exists to remove.
 *
 * `undefined` properties are dropped rather than emitted as `null`, matching the
 * copies this replaces: a payload built by spreading a partial object has the same
 * shape as one built without it, and those are the same event.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

/**
 * The sha256 of a value's canonical form.
 *
 * Bytes are hashed as they are: a `Uint8Array` is already canonical, and serialising
 * it as an array of numbers would make the hash of an artifact depend on nothing at
 * all being wrong with the serialiser.
 */
export function digestOf(value: unknown): string {
  return createHash('sha256')
    .update(value instanceof Uint8Array ? value : canonicalJson(value))
    .digest('hex');
}

/**
 * Whether a presented token is the one whose hash was stored.
 *
 * Hash, compare, and compare in **constant time** — `timingSafeEqual` throws on a
 * length mismatch, so the length is checked first, and comparing lengths in the clear
 * leaks nothing: a hex digest's length is a constant, not a secret.
 *
 * This was a byte-identical private function in both execution stores, which is the
 * shape that lets a timing-comparison rule be relaxed in one of them without anyone
 * noticing the other still has it.
 */
export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(digestOf(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
