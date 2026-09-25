import { useState, useEffect } from 'react';
import { z } from 'zod/v4';

export const TraceSchema = z.object({
  id: z.string(),
  testName: z.string(),
  status: z.string(),
  durationMs: z.number().nullable().optional(),
  startedAt: z.string(),
  traceUrl: z.string().nullable().optional(),
  actions: z.array(z.object({
    type: z.string(),
    title: z.string(),
    durationMs: z.number().nullable().optional(),
  })).optional(),
  networkRequests: z.array(z.object({
    method: z.string(),
    url: z.string(),
    status: z.number().nullable().optional(),
  })).optional(),
  consoleLogs: z.array(z.object({
    level: z.string(),
    message: z.string(),
  })).optional(),
});

export type Trace = z.infer<typeof TraceSchema>;

export type FetchFn = typeof fetch;

export function useTrace(traceId: string, fetchFn: FetchFn = globalThis.fetch) {
  const [data, setData] = useState<Trace | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchTrace() {
      try {
        setIsLoading(true);
        const res = await fetchFn(`/api/traces/${traceId}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error('Trace not found');
          throw new Error('Failed to fetch trace');
        }
        const json = await res.json();
        const parsed = TraceSchema.parse(json);
        if (mounted) {
          setData(parsed);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    fetchTrace();
    return () => { mounted = false; };
  }, [traceId, fetchFn]);

  return { data, isLoading, error };
}
