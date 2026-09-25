import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

const API = '/api';

export const RepairAttemptStatusSchema = z.enum([
  'payload_built',
  'comment_posted',
  'comment_failed',
  'rerun_requested',
  'escalated',
]);

export const RepairAttemptSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  runId: z.string().nullable(),
  attemptNumber: z.number(),
  status: RepairAttemptStatusSchema,
  commentUrl: z.string().nullable(),
  commentId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  // payload is only returned in detail endpoint
  payload: z.string().nullable().optional(),
});

export type RepairAttempt = z.infer<typeof RepairAttemptSchema>;

export function useRepairAttempts(sessionId: string) {
  return useQuery({
    queryKey: ['agent-sessions', sessionId, 'repair-attempts'],
    queryFn: async () => {
      const res = await fetch(`${API}/agent-sessions/${sessionId}/repair-attempts`);
      if (!res.ok) throw new Error('Failed to fetch repair attempts');
      const data = await res.json();
      return z.array(RepairAttemptSchema).parse(data);
    },
    enabled: !!sessionId,
  });
}

export function useRepairAttemptDetail(sessionId: string, attemptId: string | null) {
  return useQuery({
    queryKey: ['agent-sessions', sessionId, 'repair-attempts', attemptId],
    queryFn: async () => {
      if (!attemptId) return null;
      const res = await fetch(`${API}/agent-sessions/${sessionId}/repair-attempts/${attemptId}`);
      if (!res.ok) throw new Error('Failed to fetch repair attempt details');
      const data = await res.json();
      return RepairAttemptSchema.parse(data);
    },
    enabled: !!sessionId && !!attemptId,
  });
}
