import { useState, useEffect, useCallback } from 'react';

export type AlertCondition = 'on_failure' | 'on_flaky' | 'on_threshold';
export type AlertChannel = 'slack' | 'jira';

export interface AlertRule {
  id: string;
  name: string;
  condition: AlertCondition;
  channel: AlertChannel;
  target: string;
  enabled: boolean;
}

export interface UseAlertRulesOptions {
  fetchFn?: typeof fetch;
}

export function useAlertRules(options: UseAlertRulesOptions = {}) {
  const fetchFn = options.fetchFn ?? fetch;

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetchFn('/api/integrations/alert-rules');
        if (!res.ok) {
          if (res.status === 404) {
            if (mounted) setIsLoading(false);
            return;
          }
          throw new Error('Failed to load alert rules');
        }
        const data = (await res.json()) as AlertRule[];
        if (mounted) setRules(data);
      } catch (err) {
        if (mounted) setError((err as Error).message);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [fetchFn]);

  const createRule = useCallback(async (rule: Omit<AlertRule, 'id'>) => {
    try {
      setError(null);
      const res = await fetchFn('/api/integrations/alert-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule),
      });
      if (!res.ok) throw new Error('Failed to create alert rule');
      const created = (await res.json()) as AlertRule;
      setRules(prev => [...prev, created]);
      return created;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [fetchFn]);

  const updateRule = useCallback(async (id: string, updates: Partial<Omit<AlertRule, 'id'>>) => {
    try {
      setError(null);
      const res = await fetchFn(`/api/integrations/alert-rules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Failed to update alert rule');
      const updated = (await res.json()) as AlertRule;
      setRules(prev => prev.map(r => r.id === id ? updated : r));
      return updated;
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, [fetchFn]);

  const deleteRule = useCallback(async (id: string) => {
    try {
      setError(null);
      const res = await fetchFn(`/api/integrations/alert-rules/${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete alert rule');
      setRules(prev => prev.filter(r => r.id !== id));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, [fetchFn]);

  const toggleRule = useCallback(async (id: string, enabled: boolean) => {
    return updateRule(id, { enabled });
  }, [updateRule]);

  return { rules, isLoading, error, createRule, updateRule, deleteRule, toggleRule };
}
