import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const runSearchSchema = z.object({
  testId: z.string().optional().catch(undefined),
  tab: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/runs/$runId')({
  validateSearch: runSearchSchema,
});
