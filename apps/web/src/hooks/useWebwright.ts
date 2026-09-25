import { useState, useEffect, useCallback } from 'react';
import {
  createTask,
  getTask,
  connectTaskStream,
  type WebwrightTask,
} from '../services/webwright-client.js';

export interface UseWebwrightTaskResult {
  task: WebwrightTask | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export interface UseCreateWebwrightTaskResult {
  create: (url: string, actions: string[]) => Promise<WebwrightTask>;
  isCreating: boolean;
  error: Error | null;
}

export function useWebwrightTask(id: string | null): UseWebwrightTaskResult {
  const [task, setTask] = useState<WebwrightTask | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    try {
      const data = await getTask(id);
      setTask(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!id) return;

    let mounted = true;

    setIsLoading(true);
    getTask(id)
      .then((data) => {
        if (mounted) {
          setTask(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (mounted) setError(err as Error);
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    const stream = connectTaskStream(id);
    stream.onMessage((updated) => {
      if (mounted) setTask(updated);
    });
    stream.onError((event) => {
      if (mounted) setError(new Error(`WebSocket error: ${event.type}`));
    });

    return () => {
      mounted = false;
      stream.close();
    };
  }, [id]);

  return { task, isLoading, error, refresh };
}

export function useCreateWebwrightTask(): UseCreateWebwrightTaskResult {
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const create = useCallback(async (url: string, actions: string[]): Promise<WebwrightTask> => {
    setIsCreating(true);
    setError(null);
    try {
      const task = await createTask(url, actions);
      return task;
    } catch (err) {
      const e = err as Error;
      setError(e);
      throw e;
    } finally {
      setIsCreating(false);
    }
  }, []);

  return { create, isCreating, error };
}
