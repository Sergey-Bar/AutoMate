import { describe, expect, it } from 'vitest';

import { SCORE_CATEGORIES, isScoreCategory } from './vocabulary.js';

describe('isScoreCategory', () => {
  it.each(SCORE_CATEGORIES)('accepts the category %s', (category) => {
    expect(isScoreCategory(category)).toBe(true);
  });

  it('rejects a string that is not a category, including near misses', () => {
    expect(isScoreCategory('smoke')).toBe(false);
    expect(isScoreCategory('Unit')).toBe(false);
    expect(isScoreCategory('unit ')).toBe(false);
    expect(isScoreCategory('')).toBe(false);
  });

  it('rejects every non-string, even one that stringifies to a category', () => {
    expect(isScoreCategory(undefined)).toBe(false);
    expect(isScoreCategory(null)).toBe(false);
    expect(isScoreCategory(1)).toBe(false);
    expect(isScoreCategory(['unit'])).toBe(false);
    expect(isScoreCategory({ toString: () => 'unit' })).toBe(false);
  });

  it('does not accept an inherited object property name', () => {
    expect(isScoreCategory('constructor')).toBe(false);
    expect(isScoreCategory('length')).toBe(false);
  });
});
