import { describe, it, expect } from 'vitest';
import { SUGGESTED_QUERIES } from '../SuggestedQueries';

describe('SuggestedQueries', () => {
  describe('SUGGESTED_QUERIES', () => {
    it('should have at least 3 suggestions', () => {
      expect(SUGGESTED_QUERIES.length).toBeGreaterThanOrEqual(3);
    });

    it('should contain non-empty strings', () => {
      for (const q of SUGGESTED_QUERIES) {
        expect(typeof q).toBe('string');
        expect(q.trim().length).toBeGreaterThan(0);
      }
    });

    it('should not have duplicates', () => {
      const unique = new Set(SUGGESTED_QUERIES);
      expect(unique.size).toBe(SUGGESTED_QUERIES.length);
    });

    it('should include flaky-related query', () => {
      const hasFlaky = SUGGESTED_QUERIES.some((q) => /flaky/i.test(q));
      expect(hasFlaky).toBe(true);
    });

    it('should include failure-related query', () => {
      const hasFailure = SUGGESTED_QUERIES.some((q) => /fail/i.test(q));
      expect(hasFailure).toBe(true);
    });

    it('should include performance-related query', () => {
      const hasPerf = SUGGESTED_QUERIES.some((q) => /slow|p95|duration/i.test(q));
      expect(hasPerf).toBe(true);
    });
  });
});
