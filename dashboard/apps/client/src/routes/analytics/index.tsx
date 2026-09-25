import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import type { AnalyticsPreset } from '@/lib/analytics-presets';

const analyticsSearchSchema = z.object({
  days: z.number().optional().catch(undefined),
  preset: z.string().optional().catch(undefined),
});

export type AnalyticsSearchParams = z.infer<typeof analyticsSearchSchema> & { preset?: AnalyticsPreset };

export const Route = createFileRoute('/analytics/')({
  validateSearch: analyticsSearchSchema,
});
