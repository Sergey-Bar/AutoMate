import { useState, useEffect } from 'react';
import { defaultApiClient, type ApiClient, type A11yAuditResult } from '../lib/api.js';

export interface UseA11yAuditResult {
  data: A11yAuditResult | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useA11yAudit(api: ApiClient = defaultApiClient): UseA11yAuditResult {
  const [data, setData] = useState<A11yAuditResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchAudit() {
      try {
        setIsLoading(true);
        const result = await api.getA11yAudit();
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

    void fetchAudit();

    return () => {
      mounted = false;
    };
  }, [api, tick]);

  const refetch = () => setTick(t => t + 1);

  return { data, isLoading, error, refetch };
}
