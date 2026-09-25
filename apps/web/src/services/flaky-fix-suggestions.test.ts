/// <reference types="vitest/globals" />
import { suggestFlakyFixes } from './flaky-fix-suggestions.js';
import type { FlakyTest } from './flaky-detection.js';

const makeTest = (overrides: Partial<FlakyTest> = {}): FlakyTest => ({
  testId: 'test-1',
  testName: 'user can click button',
  suiteName: 'Auth Suite',
  flakinessScore: 0.8,
  recentResults: ['passed', 'failed', 'passed', 'failed', 'passed', 'failed'],
  ...overrides,
});

describe('suggestFlakyFixes', () => {
  it('returns add-wait suggestion when alternation rate is high', () => {
    const test = makeTest({
      recentResults: ['passed', 'failed', 'passed', 'failed', 'passed', 'failed'],
    });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.some((s) => s.type === 'add-wait')).toBe(true);
  });

  it('returns stabilize-selector when test name contains selector keyword', () => {
    const test = makeTest({ testName: 'user clicks the submit button' });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.some((s) => s.type === 'stabilize-selector')).toBe(true);
  });

  it('does NOT return stabilize-selector when test name has no selector keyword', () => {
    const test = makeTest({ testName: 'page loads correctly', flakinessScore: 0.8 });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.some((s) => s.type === 'stabilize-selector')).toBe(false);
  });

  it('returns add-retry when flakiness score >= 0.5', () => {
    const test = makeTest({ flakinessScore: 0.6 });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.some((s) => s.type === 'add-retry')).toBe(true);
  });

  it('does NOT return add-retry when flakiness score < 0.5', () => {
    const test = makeTest({
      flakinessScore: 0.35,
      recentResults: ['passed', 'failed', 'passed'],
    });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.some((s) => s.type === 'add-retry')).toBe(false);
  });

  it('returns isolate-state when suiteName is present', () => {
    const test = makeTest({ suiteName: 'Login Suite' });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.some((s) => s.type === 'isolate-state')).toBe(true);
  });

  it('does NOT return isolate-state when suiteName is empty', () => {
    const test = makeTest({ suiteName: '' });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.some((s) => s.type === 'isolate-state')).toBe(false);
  });

  it('each suggestion has codeBefore and codeAfter', () => {
    const test = makeTest();
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions.length).toBeGreaterThan(0);
    for (const s of suggestions) {
      expect(s.codeBefore).toBeTruthy();
      expect(s.codeAfter).toBeTruthy();
    }
  });

  it('returns empty array for a stable test with no suite', () => {
    const test = makeTest({
      testName: 'page loads',
      suiteName: '',
      flakinessScore: 0.1,
      recentResults: ['passed', 'passed', 'passed'],
    });
    const suggestions = suggestFlakyFixes(test);
    expect(suggestions).toHaveLength(0);
  });
});
