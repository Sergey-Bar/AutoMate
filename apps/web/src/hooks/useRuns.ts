import { useState, useEffect } from 'react';
import { defaultApiClient, type Run } from '../lib/api.js';

export function useRuns(api = defaultApiClient) {
  const [runs, setRuns] = useState<Run[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    async function fetchRuns() {
      try {
        setIsLoading(true);
        const data = await api.getRuns();
        if (mounted) {
          setRuns(data);
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

    fetchRuns();

    const unsubscribe = api.onRunUpdated((event) => {
      setRuns((prev) => {
        const index = prev.findIndex((r) => r.id === event.runId);
        if (index >= 0) {
          // Update existing run
          const updated = [...prev];
          updated[index] = { ...updated[index], status: event.status };
          return updated;
        } else {
          // Add as a new run
          const newRun: Run = {
            id: event.runId,
            projectName: 'Unknown Project',
            status: event.status,
            startedAt: event.timestamp,
          };
          return [newRun, ...prev];
        }
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [api]);

  return { runs, isLoading, error };
}
