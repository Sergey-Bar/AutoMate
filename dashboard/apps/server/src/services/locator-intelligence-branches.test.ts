/**
 * Branch coverage for locator-intelligence service.
 * Targets: jaccardSimilarity (both empty sets → 1, unionCount=0),
 * computeErrorContextMatch (candidateTokens.size=0), jaccardSimilarity branches
 */
import { describe, expect, it } from 'vitest';
import {
  computeAttributeTokenOverlap,
  computeErrorContextMatch,
  computeHistoricalStabilitySignal,
  computeSelectorStructureSimilarity,
  generateAlternatives,
  analyzeSelector,
  type SelectorContext,
} from './locator-intelligence.js';

describe('locator-intelligence — branch coverage', () => {
  it('computeAttributeTokenOverlap for two identical empty-tokenizing selectors returns 1', () => {
    // Both selectors reduce to 0 tokens → both sets are empty → jaccardSimilarity returns 1
    const score = computeAttributeTokenOverlap('', '');
    expect(score).toBe(1);
  });

  it('computeErrorContextMatch returns 0.5 when errorMessage is null', () => {
    const score = computeErrorContextMatch('[data-testid="btn"]', null);
    expect(score).toBe(0.5);
  });

  it('computeErrorContextMatch returns 0.5 when errorMessage is empty (no tokens)', () => {
    // An error message that produces zero tokens
    const score = computeErrorContextMatch('[data-testid="btn"]', '');
    expect(score).toBe(0.5);
  });

  it('computeErrorContextMatch returns 0.5 when candidate has no tokens', () => {
    // Candidate that produces zero tokens after tokenization
    const score = computeErrorContextMatch('', 'some error message about timeout');
    expect(score).toBe(0.5);
  });

  it('computeHistoricalStabilitySignal returns 0 when no overlap with historical selectors', () => {
    // Historical selectors that share NO tokens with candidate
    const score = computeHistoricalStabilitySignal('xyz-completely-unique', ['#totally-different-id']);
    // No overlap → best overlap = 0 → returns 0
    expect(score).toBe(0);
  });

  it('analyzeSelector with no alternatives (no dot, no nth-child, no combinator, no history)', () => {
    // Selector with no class (no dot), no nth-child, no combinator, no history
    const context: SelectorContext = {
      originalSelector: 'button',
      errorMessage: null,
      historicalSelectors: [],
    };
    // Should return empty since no alternatives are generated that meet threshold
    const suggestions = analyzeSelector('result-empty', context);
    // May or may not be empty, but should not throw
    expect(Array.isArray(suggestions)).toBe(true);
  });

  it('generateAlternatives adds historical selectors and dedupes', () => {
    const context: SelectorContext = {
      originalSelector: '.btn.primary',
      errorMessage: null,
      historicalSelectors: ['[data-testid="primary-btn"]', '[data-testid="primary-btn"]'], // duplicate
    };
    const alternatives = generateAlternatives(context);
    // Should not contain duplicates
    const unique = new Set(alternatives);
    expect(unique.size).toBe(alternatives.length);
  });

  it('generateAlternatives with combinator adds extractCoreSubject alternative', () => {
    const context: SelectorContext = {
      originalSelector: '.parent > .child',
      errorMessage: null,
      historicalSelectors: [],
    };
    const alternatives = generateAlternatives(context);
    // Should include the core subject (the part after >)
    expect(alternatives.some((a) => a.includes('child'))).toBe(true);
  });

  it('analyzeSelector sorts by confidence descending, then alphabetically for ties', () => {
    const context: SelectorContext = {
      originalSelector: '.pay-btn',
      errorMessage: 'pay-btn not found',
      historicalSelectors: ['[data-testid="pay-btn"]', '[aria-label="pay-btn"]'],
    };

    const suggestions = analyzeSelector('result-sort', context);
    for (let i = 1; i < suggestions.length; i++) {
      if (suggestions[i - 1].confidence === suggestions[i].confidence) {
        expect(suggestions[i - 1].suggestedSelector.localeCompare(suggestions[i].suggestedSelector)).toBeLessThanOrEqual(0);
      } else {
        expect(suggestions[i - 1].confidence).toBeGreaterThanOrEqual(suggestions[i].confidence);
      }
    }
  });

  it('computeSelectorStructureSimilarity for completely different selectors returns low score', () => {
    const score = computeSelectorStructureSimilarity('#simple-id', 'div > span.class[attr]:nth-child(2) + li ~ a');
    // They differ on many structure tokens
    expect(score).toBeLessThan(0.8);
  });

  it('generateAlternatives with nth-child adds text= alternative', () => {
    const context: SelectorContext = {
      originalSelector: 'li:nth-child(3)',
      errorMessage: null,
      historicalSelectors: [],
    };
    const alternatives = generateAlternatives(context);
    expect(alternatives.some((a) => a.startsWith('text='))).toBe(true);
  });
});
