import { useQuery } from '@tanstack/react-query';
import { AgentSessionSchema } from '@/lib/types';
import { z } from 'zod';

const API = '/api';

export const AgentSessionListItemSchema = AgentSessionSchema.extend({
  fileCount: z.number(),
  linkedRunCount: z.number(),
});

export type AgentSessionListItem = z.infer<typeof AgentSessionListItemSchema>;

export function useAgentSessions(status?: string) {
  return useQuery({
    queryKey: ['agent-sessions', status],
    queryFn: async () => {
      const url = status ? `${API}/agent-sessions?status=${status}` : `${API}/agent-sessions`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch agent sessions');
      const data = await res.json();
      return z.array(AgentSessionListItemSchema).parse(data);
    },
    refetchInterval: 15_000,
  });
}
