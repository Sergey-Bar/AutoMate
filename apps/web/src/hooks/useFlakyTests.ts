import { useState, useEffect } from 'react';
import { z } from 'zod/v4';
import type { FlakyTest } from '../services/flaky-detection.js';

const FlakyTestSchema = z.object({
  testId: z.string(),
  testName: z.string(),
  suiteName: z.string(),
  flakinessScore: z.number(),
  recentResults: z.array(z.enum(['passed', 'failed'])),
});

export interface UseFlakyTestsResult {
  data: FlakyTest[];
  isLoading: boolean;
  error: Error | null;
}

export function useFlakyTests(fetchFn?: () => Promise<FlakyTest[]>): UseFlakyTestsResult {
  const [data, setData] = useState<FlakyTest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchFlakyTests() {
      try {
        setIsLoading(true);
        let result: FlakyTest[];
        if (fetchFn) {
          result = await fetchFn();
        } else {
          const res = await fetch('/api/observability/flaky');
          if (!res.ok) throw new Error('Failed to fetch flaky tests');
          const raw = await res.json();
          result = z.array(FlakyTestSchema).parse(raw);
        }
        if (mounted) {
          setData(result);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    fetchFlakyTests();

    return () => {
      mounted = false;
    };
  }, [fetchFn]);

  return { data, isLoading, error };
}
