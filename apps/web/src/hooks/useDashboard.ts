import { useState, useEffect } from 'react';
import { defaultApiClient, type AnalyticsSummary, type QuarantineEntry, type Run } from '../lib/api.js';

export function useAnalytics(api = defaultApiClient) {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetch() {
      try {
        setIsLoading(true);
        const res = await api.getAnalyticsSummary();
        if (mounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    fetch();
    return () => { mounted = false; };
  }, [api]);

  return { data, isLoading, error };
}

export function useRunDetail(id: string, api = defaultApiClient) {
  const [data, setData] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetch() {
      try {
        setIsLoading(true);
        const res = await api.getRun(id);
        if (mounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    fetch();
    return () => { mounted = false; };
  }, [id, api]);

  return { data, isLoading, error };
}

export function useQuarantine(api = defaultApiClient) {
  const [data, setData] = useState<QuarantineEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetch() {
      try {
        setIsLoading(true);
        const res = await api.getQuarantine();
        if (mounted) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (mounted) setError(err as Error);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    fetch();
    return () => { mounted = false; };
  }, [api]);

  const addQuarantine = async (entry: { testTitle: string; testFile: string; reason?: string }) => {
    const newEntry = await api.addQuarantine(entry);
    setData((prev) => [...prev, newEntry]);
    return newEntry;
  };

  return { data, isLoading, error, addQuarantine };
}
