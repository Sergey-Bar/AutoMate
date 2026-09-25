import { useState, useEffect, useCallback } from 'react';

export interface GitHubConfig {
  repoUrl: string;
  token: string;
  events: {
    push: boolean;
    pull_request: boolean;
    schedule: boolean;
  };
}

export interface GitHubConnectionStatus {
  connected: boolean;
  checkedAt: string | null;
}

const DEFAULT_CONFIG: GitHubConfig = {
  repoUrl: '',
  token: '',
  events: {
    push: false,
    pull_request: true,
    schedule: false,
  },
};

export interface UseGitHubIntegrationOptions {
  fetchFn?: typeof fetch;
}

export function useGitHubIntegration(options: UseGitHubIntegrationOptions = {}) {
  const fetchFn = options.fetchFn ?? fetch;

  const [config, setConfig] = useState<GitHubConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<GitHubConnectionStatus>({ connected: false, checkedAt: null });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetchFn('/api/integrations/github');
        if (!res.ok) {
          if (res.status === 404) {
            if (mounted) setIsLoading(false);
            return;
          }
          throw new Error('Failed to load GitHub integration config');
        }
        const data = (await res.json()) as GitHubConfig & { status?: GitHubConnectionStatus };
        if (mounted) {
          setConfig({
            repoUrl: data.repoUrl ?? '',
            token: data.token ?? '',
            events: {
              push: data.events?.push ?? false,
              pull_request: data.events?.pull_request ?? true,
              schedule: data.events?.schedule ?? false,
            },
          });
          if (data.status) setStatus(data.status);
        }
      } catch (err) {
        if (mounted) setError((err as Error).message);
      } finally {
        if (mounted) setIsLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [fetchFn]);

  const saveConfig = useCallback(async (cfg: GitHubConfig) => {
    try {
      setIsSaving(true);
      setError(null);
      setSaveSuccess(false);
      const res = await fetchFn('/api/integrations/github', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error('Failed to save GitHub integration config');
      const data = (await res.json()) as GitHubConfig;
      setConfig(data);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  }, [fetchFn]);

  const testConnection = useCallback(async (cfg: GitHubConfig) => {
    try {
      setIsTesting(true);
      setError(null);
      const res = await fetchFn('/api/integrations/github/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: cfg.repoUrl, token: cfg.token }),
      });
      if (!res.ok) throw new Error('Connection test failed');
      const data = (await res.json()) as { connected: boolean };
      setStatus({ connected: data.connected, checkedAt: new Date().toISOString() });
    } catch (err) {
      setError((err as Error).message);
      setStatus({ connected: false, checkedAt: new Date().toISOString() });
    } finally {
      setIsTesting(false);
    }
  }, [fetchFn]);

  return {
    config,
    setConfig,
    status,
    isLoading,
    isSaving,
    isTesting,
    error,
    saveSuccess,
    saveConfig,
    testConnection,
  };
}
