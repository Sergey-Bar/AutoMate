import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const executiveSearchSchema = z.object({
  period: z.enum(['30d', '60d', '90d']).optional().catch(undefined),
});

export const Route = createFileRoute('/analytics/executive')({
  validateSearch: executiveSearchSchema,
});
