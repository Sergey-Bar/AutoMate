import { describe, expect, it } from 'vitest';
import { canonicalJson, digestOf } from './digest.js';

/**
 * The rule, asserted.
 *
 * Three copies of this function existed before it had a home, which means the rule was
 * never written down anywhere — only copied. The cases below are the ones the copies
 * were each silently getting right or wrong in the same way.
 */
describe('canonicalJson', () => {
  it('is indifferent to key order, which is the whole point', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
    // And differs from the naive form, so the test cannot pass by accident on a
    // serialiser that simply returns `JSON.stringify`.
    expect(canonicalJson({ b: 2, a: 1 })).not.toBe(JSON.stringify({ b: 2, a: 1 }));
  });

  it('is indifferent to key order all the way down', () => {
    expect(canonicalJson({ outer: { b: [1, { y: 2, x: 1 }], a: 3 } })).toBe(
      canonicalJson({ outer: { a: 3, b: [1, { x: 1, y: 2 }] } }),
    );
  });

  it('preserves array order, because a list is ordered data', () => {
    // The one place where being order-insensitive would be a bug. A digest that
    // identifies execution steps must not say that `[1, 2]` and `[2, 1]` are the same
    // run.
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('distinguishes values that differ', () => {
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: '1' }));
    expect(canonicalJson({ a: null })).not.toBe(canonicalJson({ a: 0 }));
    expect(canonicalJson({ a: false })).not.toBe(canonicalJson({ a: 0 }));
    expect(canonicalJson({ a: [1] })).not.toBe(canonicalJson({ a: 1 }));
  });

  it('drops undefined properties, so a spread payload has the shape of the one it copied', () => {
    const built = { message: 'started' };
    const spread = { ...built, elapsedMs: undefined };
    expect(canonicalJson(spread)).toBe(canonicalJson(built));
  });

  it('serialises the primitives', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(1)).toBe('1');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson([])).toBe('[]');
    expect(canonicalJson({})).toBe('{}');
  });
});

describe('digestOf', () => {
  it('is the sha256 of the canonical form, so reordered values share a digest', () => {
    expect(digestOf({ b: 2, a: 1 })).toBe(digestOf({ a: 1, b: 2 }));
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
  });

  it('hashes bytes as bytes rather than as an array of numbers', () => {
    // `canonicalJson(new Uint8Array([1, 2]))` would be `{"0":1,"1":2}` — an object,
    // not a byte string — and the digest would then be sensitive to the serialiser
    // rather than to the bytes.
    expect(digestOf(new Uint8Array([1, 2]))).toBe(digestOf(new Uint8Array([1, 2])));
    expect(digestOf(new Uint8Array([1, 2]))).not.toBe(digestOf(new Uint8Array([2, 1])));
    expect(digestOf(new Uint8Array([1, 2]))).toMatch(/^[0-9a-f]{64}$/);
  });
});
