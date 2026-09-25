import { useQuery } from '@tanstack/react-query';

export interface AgentConflict {
  id: string;
  repository: string;
  sessionIds: string[];
  overlappingFiles: string[];
  severity: 'info' | 'warning' | 'critical';
  status: 'active' | 'resolved';
  firstDetectedAt: string;
  lastDetectedAt: string;
}

export function useAgentConflicts(repository?: string) {
  return useQuery<AgentConflict[]>({
    queryKey: ['agent-conflicts', repository],
    queryFn: async () => {
      const url = new URL('/api/agent-sessions/conflicts', window.location.origin);
      if (repository) {
        url.searchParams.set('repository', repository);
      }
      
      const res = await fetch(url.toString());
      if (!res.ok) {
        throw new Error('Failed to fetch agent conflicts');
      }
      
      const json = await res.json();
      return json.data ?? [];
    },
    refetchInterval: 15000, // Refresh every 15 seconds
  });
}
