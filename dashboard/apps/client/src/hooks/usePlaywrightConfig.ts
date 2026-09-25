import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface PlaywrightConfig {
  path: string;
  content: string;
}

export function usePlaywrightConfig(configPath?: string) {
  const qc = useQueryClient();
  const url = configPath ? `/api/config?path=${encodeURIComponent(configPath)}` : '/api/config';

  const query = useQuery<PlaywrightConfig>({
    queryKey: ['playwright-config', configPath],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load playwright config');
      return res.json();
    },
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (content: string) => {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error ?? 'Save failed');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['playwright-config'] });
    },
    onError: () => {
      // error toast handled by toast.promise below
    },
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    error: query.error,
    save: (content: string) =>
      toast.promise(mutation.mutateAsync(content), {
        loading: 'Saving config…',
        success: 'Config saved',
        error: 'Failed to save config',
      }),
    isSaving: mutation.isPending,
  };
}
