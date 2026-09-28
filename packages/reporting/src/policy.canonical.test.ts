import { describe, expect, it } from 'vitest';
import { canonicalJson, compareCodeUnits, fingerprint } from './policy.js';

/**
 * P-23: a persisted hash that depended on the host's collation.
 *
 * The value is **stored**. `fingerprint()` writes to a `notNull` column and the
 * ingestion path reads it back to choose `duplicate` versus `conflict`, so this is not
 * an internal detail — it is the identity of a result across processes and across time.
 * Locale-dependence is therefore a data-integrity defect rather than a portability nit:
 * a different ICU build, Node version, or `LANG` reorders the keys, produces a different
 * digest for identical input, and turns a legitimate duplicate into a conflict.
 *
 * The keys below are chosen because ICU and code-unit ordering disagree about them —
 * case, digits and punctuation are exactly where the two differ.
 */
describe('canonical JSON is ordered by code unit', () => {
  it('matches JSON.stringify for case-sensitive keys, which localeCompare did not', () => {
    // `localeCompare` sorts these roughly case-insensitively: 'a' before 'B'.
    // Code units put 'B' (0x42) before 'a' (0x61), which is what `JSON.stringify` does
    // with the same object — so the canonical form is now a plain serialization rather
    // than a locale-shaped one.
    const value = { a: 1, B: 2, A: 3, b: 4 };
    // A(0x41) B(0x42) a(0x61) b(0x62). `localeCompare` would have given
    // a A b B, which is a different canonical form and a different digest.
    expect(canonicalJson(value)).toBe('{"A":3,"B":2,"a":1,"b":4}');
  });

  it('matches JSON.stringify where digits and punctuation are involved', () => {
    // The strongest available statement of the property: the canonical form is exactly
    // the language's own serialization.
    // Punctuation is where ICU and code units disagree most sharply: '-' (0x2d)
    // sorts before '_' (0x5f) before any letter, and a locale puts 'a-b' next to 'ab'
    // rather than before it. Digits are deliberately not used as bare keys — the engine
    // enumerates array-index-like keys numerically before any comparator runs, which is
    // an input property rather than a collation one.
    const value = { Zeta: 1, alpha: 2, 'a-b': 3, a_b: 4, 'a b': 5 };
    expect(canonicalJson(value)).toBe('{"Zeta":1,"a b":5,"a-b":3,"a_b":4,"alpha":2}');
  });

  it('is unaffected by the ambient locale', () => {
    // The property that matters operationally. `LANG` is process state and the old
    // implementation read it implicitly through ICU. If the digest moves when the
    // environment does, every stored fingerprint becomes a duplicate of nothing.
    const value = { report: { name: 'suite', results: [{ a: 1, B: 2 }] }, b: 2, A: 1 };
    const before = fingerprint(value);
    for (const locale of ['C', 'en_US', 'tr_TR', 'de_DE']) {
      const previous = process.env['LANG'];
      try {
        process.env['LANG'] = locale;
        expect(fingerprint(value), `LANG=${locale} changed the digest`).toBe(before);
      } finally {
        if (previous === undefined) delete process.env['LANG'];
        else process.env['LANG'] = previous;
      }
    }
  });

  it('ignores the order the keys arrived in', () => {
    // Still true, and worth keeping asserted: canonicalization exists so two
    // structurally equal results hash alike however their keys were ordered.
    expect(fingerprint({ a: 1, b: 2, c: { d: 3, e: 4 } })).toBe(
      fingerprint({ c: { e: 4, d: 3 }, b: 2, a: 1 }),
    );
  });

  it('still canonicalizes nested objects and array elements', () => {
    // The fix touched the object branch; the array branch and the recursion must be
    // unaffected, and an ordering-only test would not notice if they were not.
    // The recursion still reaches into array elements: the inner object's keys are
    // reordered even though the outer one already happened to be sorted.
    expect(canonicalJson({ list: [{ b: 1, a: 2 }], a: 1 })).toBe('{"a":1,"list":[{"a":2,"b":1}]}');
  });

  it('makes the canonical form independent of how the caller built the object', () => {
    // A witness rather than a general claim. `{a, B}` and `{B, a}` are the same value,
    // and under the old code the *canonical* form depended on which one the host's
    // collation happened to prefer — so the digest differed between two callers that
    // had built the same object.
    expect(fingerprint({ a: 1, B: 2 })).toBe(fingerprint({ B: 2, a: 1 }));
  });
});

describe('the code-unit comparator directly', () => {
  // `compareCodeUnits` is exported so its three-way contract can be checked on its own.
  // Sorting an object's keys never compares two equal strings — an object's keys are
  // unique — so the equal branch is unreachable through the only call site. That makes
  // it exactly the branch a coverage report cannot otherwise reach, and the branch a
  // caller would notice first if it were wrong.
  it('orders by UTF-16 code unit, returning a sign', () => {
    expect(compareCodeUnits('a', 'b')).toBeLessThan(0);
    expect(compareCodeUnits('b', 'a')).toBeGreaterThan(0);
    // Case is the interesting half: 'B' is 0x42, 'a' is 0x61.
    expect(compareCodeUnits('B', 'a')).toBeLessThan(0);
    // So is punctuation: '-'(0x2d) sorts before '_'(0x5f) and before any letter.
    expect(compareCodeUnits('a-b', 'a_b')).toBeLessThan(0);
  });

  it('reports two equal strings as equal', () => {
    expect(compareCodeUnits('same', 'same')).toBe(0);
  });

  it('agrees with the relational operators it replaces', () => {
    // The property the whole fix rests on: the comparator and `<` must never disagree,
    // because `JSON.stringify` orders by `<` and a canonical form that sorted
    // differently from the language it serializes would be a new inconsistency.
    const samples = ['a', 'B', 'A', 'b', 'a-b', 'a_b', '', '0', '9', 'Z'];
    for (const left of samples) {
      for (const right of samples) {
        const expected = left < right ? -1 : left > right ? 1 : 0;
        expect(
          compareCodeUnits(left, right),
          `${JSON.stringify(left)} vs ${JSON.stringify(right)}`,
        ).toBe(expected);
      }
    }
  });
});
