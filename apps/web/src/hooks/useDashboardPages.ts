import { useState, useEffect } from 'react';
import { defaultApiClient, type Run, type Suite, type Test } from '../lib/api.js';
import type { ApiClient } from '../lib/api.js';

export function useRun(id: string, api: ApiClient = defaultApiClient) {
  const [data, setData] = useState<Run | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchRun() {
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
    fetchRun();
    return () => { mounted = false; };
  }, [id, api]);

  return { data, isLoading, error };
}

export function useSuites(api: ApiClient = defaultApiClient) {
  const [data, setData] = useState<Suite[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchSuites() {
      try {
        setIsLoading(true);
        const res = await api.getSuites();
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
    fetchSuites();
    return () => { mounted = false; };
  }, [api]);

  return { data, isLoading, error };
}

export function useTests(api: ApiClient = defaultApiClient) {
  const [data, setData] = useState<Test[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    async function fetchTests() {
      try {
        setIsLoading(true);
        const res = await api.getTests();
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
    fetchTests();
    return () => { mounted = false; };
  }, [api]);

  return { data, isLoading, error };
}
