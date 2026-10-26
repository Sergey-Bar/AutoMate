import { describe, expect, it } from 'vitest';
import { inChunksOf, withinBound } from './bounded-list.js';

describe('withinBound', () => {
  it('returns a copy of a list at or under the bound', () => {
    const ids = ['a', 'b', 'c'];
    const bounded = withinBound(ids, 3);
    expect(bounded).toEqual(ids);
    expect(bounded).not.toBe(ids);
  });

  it('throws on a list over the bound, rather than truncating it silently', () => {
    expect(() => withinBound(['a', 'b', 'c'], 2)).toThrow(RangeError);
    expect(() => withinBound(['a', 'b', 'c'], 2)).toThrow(/3 values, over the bound of 2/u);
  });

  it('refuses a bound that is not a positive integer', () => {
    expect(() => withinBound([], 0)).toThrow(RangeError);
    expect(() => withinBound([], 1.5)).toThrow(RangeError);
  });
});

describe('inChunksOf', () => {
  it('splits a list into chunks of at most the size, in order and complete', () => {
    expect(inChunksOf([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns no chunk for an empty list, so no empty statement is issued', () => {
    expect(inChunksOf([], 10)).toEqual([]);
  });

  it('refuses a non-positive size, which would never advance', () => {
    expect(() => inChunksOf([1], 0)).toThrow(RangeError);
  });
});
