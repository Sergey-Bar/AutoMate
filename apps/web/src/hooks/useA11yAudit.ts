import { useState, useEffect } from 'react';

export type A11ySeverity = 'critical' | 'serious' | 'moderate' | 'minor';

export interface A11yViolation {
  id: string;
  ruleId: string;
  description: string;
  severity: A11ySeverity;
  element: string;
  fix: string;
  page: string;
}

export interface A11yAuditResult {
  violations: A11yViolation[];
  pagesScanned: number;
  scannedAt: string;
}

export interface UseA11yAuditResult {
  data: A11yAuditResult | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useA11yAudit(): UseA11yAuditResult {
  const [data, setData] = useState<A11yAuditResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch('/api/a11y/audit', { signal: controller.signal })
      .then(r => {
        if (!r.ok) throw new Error(`Failed to fetch a11y audit: ${r.status}`);
        return r.json();
      })
      .then((result: A11yAuditResult) => {
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if ((err as Error).name !== 'AbortError') {
          setError((err as Error).message);
        }
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [tick]);

  const refetch = () => setTick(t => t + 1);

  return { data, loading, error, refetch };
}
