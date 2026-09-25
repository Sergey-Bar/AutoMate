import type { FlakyTest } from './flaky-detection.js';

export type FixType = 'add-wait' | 'stabilize-selector' | 'add-retry' | 'isolate-state';

export interface FlakySuggestion {
  type: FixType;
  description: string;
  codeBefore: string;
  codeAfter: string;
}

/**
 * Analyse a flaky test's history and return an ordered list of fix suggestions.
 *
 * Heuristics (all pattern-based, no AI calls):
 *  - High flakiness score (≥ 0.7)  → add-retry
 *  - Many alternations in recent results → add-wait
 *  - Test name contains selector-like keywords → stabilize-selector
 *  - Suite name present (shared state risk) → isolate-state
 */
export function suggestFlakyFixes(test: FlakyTest): FlakySuggestion[] {
  const suggestions: FlakySuggestion[] = [];

  // 1. add-wait — frequent alternations suggest timing issues
  const alternations = countAlternations(test.recentResults);
  const alternationRate = test.recentResults.length > 1
    ? alternations / (test.recentResults.length - 1)
    : 0;

  if (alternationRate >= 0.4) {
    suggestions.push({
      type: 'add-wait',
      description: 'Add an explicit wait for the element or condition before interacting with it to avoid race conditions.',
      codeBefore: `await page.click('${selectorHint(test.testName)}');`,
      codeAfter: `await page.waitForSelector('${selectorHint(test.testName)}', { state: 'visible' });\nawait page.click('${selectorHint(test.testName)}');`,
    });
  }

  // 2. stabilize-selector — test name hints at brittle selectors
  if (hasSelectorKeyword(test.testName)) {
    suggestions.push({
      type: 'stabilize-selector',
      description: 'Replace fragile CSS/XPath selectors with stable data-testid attributes to reduce selector-related flakiness.',
      codeBefore: `await page.click('.btn-primary > span');`,
      codeAfter: `await page.click('[data-testid="submit-button"]');`,
    });
  }

  // 3. add-retry — high overall flakiness score
  if (test.flakinessScore >= 0.5) {
    suggestions.push({
      type: 'add-retry',
      description: 'Wrap the flaky assertion in a retry loop so transient failures do not cause the whole test to fail.',
      codeBefore: `expect(await page.textContent('#status')).toBe('Ready');`,
      codeAfter: `await expect(page.locator('#status')).toHaveText('Ready', { timeout: 10_000 });`,
    });
  }

  // 4. isolate-state — shared suite state can cause cross-test pollution
  if (test.suiteName) {
    suggestions.push({
      type: 'isolate-state',
      description: 'Reset shared state in beforeEach/afterEach hooks to prevent test pollution from other tests in the suite.',
      codeBefore: `// No cleanup between tests\ntest('${test.testName}', async () => { ... });`,
      codeAfter: `beforeEach(async () => { await resetAppState(); });\ntest('${test.testName}', async () => { ... });`,
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countAlternations(results: Array<'passed' | 'failed'>): number {
  let count = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i] !== results[i - 1]) count++;
  }
  return count;
}

const SELECTOR_KEYWORDS = ['click', 'button', 'input', 'form', 'select', 'link', 'nav', 'menu', 'dropdown'];

function hasSelectorKeyword(testName: string): boolean {
  const lower = testName.toLowerCase();
  return SELECTOR_KEYWORDS.some((kw) => lower.includes(kw));
}

function selectorHint(testName: string): string {
  const lower = testName.toLowerCase();
  for (const kw of SELECTOR_KEYWORDS) {
    if (lower.includes(kw)) return `[data-testid="${kw}"]`;
  }
  return '[data-testid="element"]';
}
