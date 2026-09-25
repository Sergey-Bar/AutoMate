import { useState, useEffect, useCallback } from 'react';

export interface Schedule {
  id: string;
  name: string;
  cron: string;
  suiteId: string;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
}

export type CreateScheduleInput = Omit<Schedule, 'id' | 'lastRun' | 'nextRun'>;
export type UpdateScheduleInput = Partial<CreateScheduleInput>;

export function useSchedules() {
  const [data, setData] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const load = useCallback(async () => {
    let mounted = true;
    try {
      setIsLoading(true);
      const res = await fetch('/api/schedules');
      if (!res.ok) {
        throw new Error(`Failed to fetch schedules: ${res.status}`);
      }
      const json = (await res.json()) as Schedule[];
      if (mounted) {
        setData(json);
        setError(null);
      }
    } catch (err) {
      if (mounted) setError(err as Error);
    } finally {
      if (mounted) setIsLoading(false);
    }
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setIsLoading(true);
        const res = await fetch('/api/schedules');
        if (!res.ok) throw new Error(`Failed to fetch schedules: ${res.status}`);
        const json = (await res.json()) as Schedule[];
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err as Error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    run();
    return () => { cancelled = true; };
  }, []);

  const createSchedule = useCallback(async (input: CreateScheduleInput): Promise<Schedule> => {
    const res = await fetch('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Failed to create schedule: ${res.status}`);
    const created = (await res.json()) as Schedule;
    setData(prev => [...prev, created]);
    return created;
  }, []);

  const updateSchedule = useCallback(async (id: string, input: UpdateScheduleInput): Promise<Schedule> => {
    const res = await fetch(`/api/schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`Failed to update schedule: ${res.status}`);
    const updated = (await res.json()) as Schedule;
    setData(prev => prev.map(s => s.id === id ? updated : s));
    return updated;
  }, []);

  const deleteSchedule = useCallback(async (id: string): Promise<void> => {
    const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`Failed to delete schedule: ${res.status}`);
    setData(prev => prev.filter(s => s.id !== id));
  }, []);

  const toggleSchedule = useCallback(async (id: string, enabled: boolean): Promise<Schedule> => {
    return updateSchedule(id, { enabled });
  }, [updateSchedule]);

  return {
    data,
    isLoading,
    error,
    reload: load,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    toggleSchedule,
  };
}
