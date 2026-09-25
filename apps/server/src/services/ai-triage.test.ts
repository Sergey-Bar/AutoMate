import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { triageFailedRun, getTriageForRun, triageResults } from './ai-triage.js';
import type { RunResultCallback } from '../routes/run-callback.js';

const OLLAMA_HOST = 'http://localhost:11434';
const MODEL = 'llama3.1';

const baseOptions = { ollamaHost: OLLAMA_HOST, model: MODEL };

function makeRunResult(overrides: Partial<RunResultCallback> = {}): RunResultCallback {
  return {
    runId: 'run-test-123',
    status: 'failed',
    total: 3,
    passed: 2,
    failed: 1,
    failedTests: [
      { title: 'login should work', file: 'auth.spec.ts', errorMessage: 'Expected true got false' },
    ],
    ...overrides,
  };
}

describe('ai-triage service', () => {
  beforeEach(() => {
    triageResults.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('triageFailedRun', () => {
    it('calls Ollama and returns structured triage result for failed tests', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: '{ "rootCause": "Element not found", "suggestedFix": "Check selector", "confidence": "high" }',
        }),
      });
      globalThis.fetch = mockFetch;

      const runResult = makeRunResult();
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.runId).toBe('run-test-123');
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.testTitle).toBe('login should work');
      expect(result.failures[0]?.rootCause).toBe('Element not found');
      expect(result.failures[0]?.suggestedFix).toBe('Check selector');
      expect(result.failures[0]?.confidence).toBe('high');
      expect(result.summary).toContain('1 failed test');
      expect(result.analyzedAt).toBeTruthy();

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockFetch).toHaveBeenCalledWith(
        `${OLLAMA_HOST}/api/generate`,
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('login should work'),
        }),
      );
    });

    it('stores the triage result in triageResults map', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: '{ "rootCause": "Timeout", "suggestedFix": "Increase timeout", "confidence": "medium" }',
        }),
      });

      const runResult = makeRunResult({ runId: 'run-store-check' });
      await triageFailedRun(runResult, baseOptions);

      expect(triageResults.has('run-store-check')).toBe(true);
      const stored = triageResults.get('run-store-check');
      expect(stored?.failures).toHaveLength(1);
    });

    it('returns empty triage when failed count is 0', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const runResult = makeRunResult({ failed: 0, failedTests: [] });
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures).toHaveLength(0);
      expect(result.summary).toBe('No failures to analyze.');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty triage when failedTests is empty array', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const runResult = makeRunResult({ failed: 1, failedTests: [] });
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('returns empty triage when failedTests is undefined', async () => {
      const mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      const runResult = makeRunResult({ failed: 1, failedTests: undefined });
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('uses fallback analysis when Ollama is unavailable (fetch throws)', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      const runResult = makeRunResult();
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]?.rootCause).toBe('Unable to analyze - AI service unavailable');
      expect(result.failures[0]?.suggestedFix).toBe('Check error message manually');
      expect(result.failures[0]?.confidence).toBe('low');
    });

    it('uses fallback analysis when Ollama returns non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

      const runResult = makeRunResult();
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures[0]?.rootCause).toBe('Unable to analyze - AI service unavailable');
      expect(result.failures[0]?.confidence).toBe('low');
    });

    it('uses fallback analysis when Ollama returns malformed JSON', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response: 'not json at all' }),
      });

      const runResult = makeRunResult();
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures[0]?.rootCause).toBe('Unable to analyze - AI service unavailable');
      expect(result.failures[0]?.confidence).toBe('low');
    });

    it('uses fallback when JSON is valid but missing required fields', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response: '{ "foo": "bar" }' }),
      });

      const runResult = makeRunResult();
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures[0]?.rootCause).toBe('Unable to analyze - AI service unavailable');
    });

    it('uses default ollamaHost and model when options are not provided', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: '{ "rootCause": "r", "suggestedFix": "s", "confidence": "high" }',
        }),
      });
      globalThis.fetch = mockFetch;

      const runResult = makeRunResult();
      await triageFailedRun(runResult, {});

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({ body: expect.stringContaining('"llama3.1"') }),
      );
    });

    it('handles multiple failed tests and generates summary', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: '{ "rootCause": "Selector broke", "suggestedFix": "Fix selector", "confidence": "high" }',
        }),
      });

      const runResult = makeRunResult({
        failed: 2,
        failedTests: [
          { title: 'test one', file: 'a.spec.ts', errorMessage: 'err 1' },
          { title: 'test two', file: 'b.spec.ts', errorMessage: 'err 2' },
        ],
      });
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures).toHaveLength(2);
      expect(result.summary).toContain('2 failed test');
      expect(result.summary).toContain('2 high-confidence');
    });

    it('includes test metadata in failure results', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: '{ "rootCause": "r", "suggestedFix": "s", "confidence": "medium" }',
        }),
      });

      const runResult = makeRunResult({
        failedTests: [{ title: 'my test', file: 'my.spec.ts', errorMessage: 'my error' }],
      });
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures[0]?.testTitle).toBe('my test');
      expect(result.failures[0]?.file).toBe('my.spec.ts');
      expect(result.failures[0]?.errorMessage).toBe('my error');
    });

    it('handles test with no file or errorMessage', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: '{ "rootCause": "r", "suggestedFix": "s", "confidence": "low" }',
        }),
      });

      const runResult = makeRunResult({
        failedTests: [{ title: 'bare test' }],
      });
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures[0]?.file).toBeUndefined();
      expect(result.failures[0]?.errorMessage).toBeUndefined();
    });

    it('uses fallback when JSON.parse throws on structurally broken JSON', async () => {
      // The regex matches `{...}` but JSON.parse throws because it's invalid
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response: '{ rootCause: broken json }' }),
      });

      const runResult = makeRunResult();
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures[0]?.rootCause).toBe('Unable to analyze - AI service unavailable');
    });

    it('extracts JSON embedded in surrounding text from Ollama response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: 'Sure! Here is the analysis: { "rootCause": "Network error", "suggestedFix": "Mock the request", "confidence": "high" } Hope that helps.',
        }),
      });

      const runResult = makeRunResult();
      const result = await triageFailedRun(runResult, baseOptions);

      expect(result.failures[0]?.rootCause).toBe('Network error');
      expect(result.failures[0]?.confidence).toBe('high');
    });
  });

  describe('getTriageForRun', () => {
    it('returns stored triage result for a known runId', async () => {
      const stored = {
        runId: 'run-known',
        analyzedAt: new Date().toISOString(),
        failures: [],
        summary: 'All good',
      };
      triageResults.set('run-known', stored);

      const result = await getTriageForRun('run-known');
      expect(result).toEqual(stored);
    });

    it('returns undefined for an unknown runId', async () => {
      const result = await getTriageForRun('run-does-not-exist');
      expect(result).toBeUndefined();
    });
  });
});
