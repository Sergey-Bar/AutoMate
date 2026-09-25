/// <reference types="vitest" />
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONFIDENCE_THRESHOLD,
  WEIGHTS,
  analyzeSelector,
  analyzeAndPersist,
  aiSuggestSelector,
  computeAttributeTokenOverlap,
  computeConfidence,
  computeErrorContextMatch,
  computeHistoricalStabilitySignal,
  computeSelectorStructureSimilarity,
  generateAlternatives,
  isSelectorFailure,
  type SelectorContext,
} from './locator-intelligence.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockOnConflictDoNothing = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockValues = vi.hoisted(() => vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing }));
const mockInsert = vi.hoisted(() => vi.fn().mockReturnValue({ values: mockValues }));

vi.mock('../db/client.js', () => ({
  db: {
    insert: mockInsert,
  },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

const mockCreateCompletion = vi.hoisted(() => vi.fn());
const mockGetAiProvider = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    adapter: { createCompletion: mockCreateCompletion },
    config: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
  }),
);

vi.mock('./ai-provider-registry.js', () => ({
  getAiProvider: mockGetAiProvider,
}));

describe('locator-intelligence', () => {
  it('computeAttributeTokenOverlap returns expected Jaccard similarity', () => {
    const original = "button.primary#submit[data-testid='submit-btn']";
    const candidate = "button.secondary#submit[data-testid='submit-btn']";

    const overlap = computeAttributeTokenOverlap(original, candidate);
    expect(overlap).toBeCloseTo(4 / 6, 6);
  });

  it('computeSelectorStructureSimilarity compares structures correctly', () => {
    const similarA = 'button.primary[data-testid="checkout"] > span.label';
    const similarB = 'button.secondary[data-testid="pay"] > span.icon';
    const different = 'ul > li:nth-child(3) a';

    const closeScore = computeSelectorStructureSimilarity(similarA, similarB);
    const farScore = computeSelectorStructureSimilarity(similarA, different);

    expect(closeScore).toBeGreaterThan(0.8);
    expect(farScore).toBeLessThan(closeScore);
  });

  it('computeHistoricalStabilitySignal returns 1.0 for exact historical match', () => {
    const score = computeHistoricalStabilitySignal('[data-testid="login-btn"]', [
      '#legacy-login',
      '[data-testid="login-btn"]',
    ]);

    expect(score).toBe(1);
  });

  it('computeHistoricalStabilitySignal returns 0.5 for no history', () => {
    const score = computeHistoricalStabilitySignal('.candidate', []);
    expect(score).toBe(0.5);
  });

  it('computeErrorContextMatch extracts relevance from error messages', () => {
    const score = computeErrorContextMatch(
      '[data-testid="checkout-button"]',
      'Unable to find element with data-testid checkout-button after waiting 30000ms',
    );

    expect(score).toBeGreaterThan(0.5);
  });

  it('computeConfidence applies weighted formula correctly', () => {
    const context: SelectorContext = {
      originalSelector: '.checkout-button',
      errorMessage: 'Unable to locate checkout button',
      historicalSelectors: ['[data-testid="checkout-button"]'],
    };
    const candidate = '[data-testid="checkout-button"]';

    const confidence = computeConfidence(context.originalSelector, candidate, context);
    const expected =
      WEIGHTS.attributeTokenOverlap *
        computeAttributeTokenOverlap(context.originalSelector, candidate) +
      WEIGHTS.selectorStructureSimilarity *
        computeSelectorStructureSimilarity(context.originalSelector, candidate) +
      WEIGHTS.historicalStabilitySignal *
        computeHistoricalStabilitySignal(candidate, context.historicalSelectors ?? []) +
      WEIGHTS.errorContextMatch *
        computeErrorContextMatch(candidate, context.errorMessage);

    expect(confidence).toBeCloseTo(expected, 6);
  });

  it('suggestions include confidence score and rationale fields', () => {
    const context: SelectorContext = {
      originalSelector: '.login-button',
      errorMessage: 'Timeout waiting for login-button data-testid',
      historicalSelectors: ['[data-testid="login-button"]'],
    };

    const suggestions = analyzeSelector('result-1', context);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const suggestion of suggestions) {
      expect(suggestion.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
      expect(suggestion.rationale).toContain('attributeTokenOverlap');
      expect(suggestion.rationale).toContain('selectorStructureSimilarity');
      expect(suggestion.rationale).toContain('historicalStabilitySignal');
      expect(suggestion.rationale).toContain('errorContextMatch');
    }
  });

  it('configurable confidence threshold excludes weak candidates', () => {
    const context: SelectorContext = {
      originalSelector: '.save-button',
      errorMessage: 'Element not found',
      historicalSelectors: ['.old-save-target'],
    };

    const strict = analyzeSelector('result-2', context, 0.95);
    expect(strict).toEqual([]);
  });

  it('high-confidence suggestion appears for obvious alternatives', () => {
    const context: SelectorContext = {
      originalSelector: '.checkout-btn',
      errorMessage: 'Unable to find checkout-btn via data-testid',
      historicalSelectors: ['[data-testid="checkout-btn"]'],
    };

    const suggestions = analyzeSelector('result-3', context);
    expect(suggestions.some((s) => s.suggestedSelector === '[data-testid="checkout-btn"]')).toBe(
      true,
    );
  });

  it('low-confidence alternatives are filtered out', () => {
    const context: SelectorContext = {
      originalSelector: 'main .totally-unique-widget > div:nth-child(7)',
      errorMessage: null,
      historicalSelectors: [],
    };

    const suggestions = analyzeSelector('result-4', context);
    expect(suggestions.every((s) => s.confidence >= CONFIDENCE_THRESHOLD)).toBe(true);
  });

  it('generateAlternatives produces reasonable candidates', () => {
    const context: SelectorContext = {
      originalSelector: 'form .login-button > div > span:nth-child(2)',
      errorMessage: null,
      historicalSelectors: ['[data-testid="login-button"]'],
    };

    const alternatives = generateAlternatives(context);
    expect(alternatives).toContain('[data-testid="login-button"]');
    expect(alternatives.some((a) => a.includes('aria-label'))).toBe(true);
    expect(alternatives.some((a) => a.includes('text='))).toBe(true);
  });

  it('analyzeSelector returns sorted and filtered suggestions', () => {
    const context: SelectorContext = {
      originalSelector: '.pay-button',
      errorMessage: 'Cannot find pay-button in DOM',
      historicalSelectors: ['[data-testid="pay-button"]', '.pay-button'],
    };

    const suggestions = analyzeSelector('result-5', context);

    expect(suggestions.every((s) => s.confidence >= CONFIDENCE_THRESHOLD)).toBe(true);
    for (let i = 1; i < suggestions.length; i += 1) {
      expect(suggestions[i - 1].confidence).toBeGreaterThanOrEqual(suggestions[i].confidence);
    }
  });

  it('is deterministic for same input', () => {
    const context: SelectorContext = {
      originalSelector: '.profile-link > span',
      errorMessage: 'profile-link not found',
      historicalSelectors: ['[data-testid="profile-link"]'],
    };

    const a = analyzeSelector('result-6', context);
    const b = analyzeSelector('result-6', context);

    expect(a).toEqual(b);
  });
});

describe('isSelectorFailure', () => {
  it('returns true for locator.click timeout message', () => {
    expect(isSelectorFailure('locator.click: Timeout waiting for selector')).toBe(true);
  });

  it('returns true for waitForSelector error', () => {
    expect(isSelectorFailure('waitForSelector(".btn") timed out after 30000ms')).toBe(true);
  });

  it('returns true for getByRole error', () => {
    expect(isSelectorFailure('getByRole("button") failed to find element')).toBe(true);
  });

  it('returns true for getByTestId error', () => {
    expect(isSelectorFailure('getByTestId("submit") expected to be visible')).toBe(true);
  });

  it('returns true for strict mode violation', () => {
    expect(isSelectorFailure('strict mode violation: multiple elements')).toBe(true);
  });

  it('returns true for No elements found', () => {
    expect(isSelectorFailure('No elements found for selector .primary-button')).toBe(true);
  });

  it('returns false for non-selector error', () => {
    expect(isSelectorFailure('Expected 200 but got 404')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isSelectorFailure(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isSelectorFailure('')).toBe(false);
  });
});

describe('aiSuggestSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish default mock return after clearAllMocks
    mockGetAiProvider.mockResolvedValue({
      adapter: { createCompletion: mockCreateCompletion },
      config: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
    });
  });

  it('returns LocatorSuggestion when AI returns valid JSON', async () => {
    mockCreateCompletion.mockResolvedValue(
      '{ "selector": "getByRole(\\"button\\", { name: \\"Submit\\" })", "rationale": "Use accessible role selector" }',
    );

    const context: SelectorContext = {
      originalSelector: '.submit-btn',
      errorMessage: 'locator.click: Timeout waiting for selector .submit-btn',
    };

    const result = await aiSuggestSelector(context);

    expect(result).not.toBeNull();
    expect(result?.suggestedSelector).toBe('getByRole("button", { name: "Submit" })');
    expect(result?.rationale).toBe('Use accessible role selector');
    expect(result?.originalSelector).toBe('.submit-btn');
    expect(result?.status).toBe('pending');
    expect(typeof result?.confidence).toBe('number');
    expect(typeof result?.id).toBe('string');
  });

  it('strips markdown code fences from AI response', async () => {
    mockCreateCompletion.mockResolvedValue(
      '```json\n{ "selector": "getByLabel(\\"Email\\")", "rationale": "Use label selector" }\n```',
    );

    const context: SelectorContext = {
      originalSelector: '#email-input',
      errorMessage: 'No elements found',
    };

    const result = await aiSuggestSelector(context);

    expect(result).not.toBeNull();
    expect(result?.suggestedSelector).toBe('getByLabel("Email")');
  });

  it('returns null when AI returns malformed JSON', async () => {
    mockCreateCompletion.mockResolvedValue('Not valid JSON at all !!!');

    const context: SelectorContext = {
      originalSelector: '.btn',
      errorMessage: 'locator.click timeout',
    };

    const result = await aiSuggestSelector(context);

    expect(result).toBeNull();
  });

  it('returns null when AI returns JSON missing required fields', async () => {
    mockCreateCompletion.mockResolvedValue('{ "text": "something" }');

    const context: SelectorContext = {
      originalSelector: '.btn',
      errorMessage: 'locator.click timeout',
    };

    const result = await aiSuggestSelector(context);

    expect(result).toBeNull();
  });

  it('returns null when createCompletion throws', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('API error'));

    const context: SelectorContext = {
      originalSelector: '.btn',
      errorMessage: 'locator.click timeout',
    };

    const result = await aiSuggestSelector(context);

    expect(result).toBeNull();
  });

  it('returns null when AI returns empty selector string', async () => {
    mockCreateCompletion.mockResolvedValue('{ "selector": "", "rationale": "empty suggestion" }');

    const context: SelectorContext = {
      originalSelector: '.btn',
      errorMessage: 'locator.click timeout',
    };

    const result = await aiSuggestSelector(context);

    expect(result).toBeNull();
  });

  it('returns null when getAiProvider is not configured', async () => {
    mockGetAiProvider.mockRejectedValueOnce(new Error('No AI provider configured'));

    const context: SelectorContext = {
      originalSelector: '.btn',
      errorMessage: 'locator.click timeout',
    };

    const result = await aiSuggestSelector(context);

    expect(result).toBeNull();
  });
});

describe('analyzeAndPersist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore mock defaults after clear
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    mockOnConflictDoNothing.mockResolvedValue(undefined);
    mockGetAiProvider.mockResolvedValue({
      adapter: { createCompletion: mockCreateCompletion },
      config: { provider: 'openai', model: 'gpt-4o', apiKey: 'test-key' },
    });
    mockCreateCompletion.mockResolvedValue(
      '{ "selector": "getByRole(\\"button\\")", "rationale": "AI suggestion" }',
    );
  });

  it('persists heuristic suggestions when selector has alternatives', async () => {
    const context: SelectorContext = {
      originalSelector: '.checkout-btn',
      errorMessage: 'Unable to find checkout-btn via data-testid',
      historicalSelectors: ['[data-testid="checkout-btn"]'],
    };

    await analyzeAndPersist('test-id-1', 'run-id-1', 'result-id-1', context);

    // Should have inserted suggestions
    expect(mockInsert).toHaveBeenCalled();
  });

  it('attempts AI strategy when no high-confidence heuristic suggestions', async () => {
    // Use a selector that won't generate high-confidence heuristics
    const context: SelectorContext = {
      originalSelector: 'main .totally-unique-widget > div:nth-child(7)',
      errorMessage: null,
      historicalSelectors: [],
    };

    mockCreateCompletion.mockResolvedValue(
      '{ "selector": "getByTestId(\\"unique-widget\\")", "rationale": "Use testid" }',
    );

    await analyzeAndPersist('test-id-2', 'run-id-2', 'result-id-2', context);

    // AI was attempted (even if no insert — depends on confidence threshold)
    expect(mockCreateCompletion).toHaveBeenCalled();
  });

  it('does not persist more than 3 suggestions', async () => {
    const context: SelectorContext = {
      originalSelector: '.pay-button',
      errorMessage: 'Cannot find pay-button in DOM',
      historicalSelectors: [
        '[data-testid="pay-button"]',
        '[aria-label="pay-button"]',
        '.pay-button',
        '.payment-btn',
      ],
    };

    await analyzeAndPersist('test-id-3', 'run-id-3', 'result-id-3', context);

    expect(mockInsert.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('skips gracefully when AI strategy throws', async () => {
    mockCreateCompletion.mockRejectedValue(new Error('Network error'));

    const context: SelectorContext = {
      originalSelector: 'div.weird-element:nth-child(99)',
      errorMessage: null,
      historicalSelectors: [],
    };

    // Should not throw
    await expect(analyzeAndPersist('test-id-4', 'run-id-4', 'result-id-4', context)).resolves.toBeUndefined();
  });
});
