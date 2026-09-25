import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const auditSearchSchema = z.object({
  actor: z.string().optional().catch(undefined),
  action: z.string().optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  limit: z.number().optional().catch(undefined),
  offset: z.number().optional().catch(undefined),
});

export const Route = createFileRoute('/admin/audit')({
  validateSearch: auditSearchSchema,
});
