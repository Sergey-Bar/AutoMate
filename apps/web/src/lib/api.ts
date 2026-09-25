import { z } from 'zod/v4';
import { RunUpdatedEventSchema } from '@automate/realtime';
import {
  CanonicalRealtimeEnvelopeSchema,
  CanonicalRunResultSchema,
  type CanonicalRealtimeEnvelope,
  type CanonicalRunResult,
} from '@automate/shared-contracts';

export { CanonicalRealtimeEnvelopeSchema, CanonicalRunResultSchema };
export type { CanonicalRealtimeEnvelope, CanonicalRunResult };

export const RunSchema = z.object({
  id: z.string(),
  projectName: z.string().optional(),
  status: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nullable().optional(),
  total: z.number().optional(),
  passed: z.number().optional(),
  failed: z.number().optional(),
});

export const AnalyticsSummarySchema = z.object({
  totalRuns: z.number(),
  passRate: z.number(),
  avgDurationMs: z.number().nullable(),
});

export const QuarantineEntrySchema = z.object({
  id: z.string(),
  testTitle: z.string(),
  testFile: z.string(),
  reason: z.string().nullable(),
  quarantinedAt: z.string(),
});

export type Run = z.infer<typeof RunSchema>;
export type RunUpdatedEvent = z.infer<typeof RunUpdatedEventSchema>;
export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;
export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>;

export interface ApiClient {
  getRuns(): Promise<Run[]>;
  getRun(id: string): Promise<Run>;
  getAnalyticsSummary(): Promise<AnalyticsSummary>;
  getQuarantine(): Promise<QuarantineEntry[]>;
  addQuarantine(entry: {
    testTitle: string;
    testFile: string;
    reason?: string;
  }): Promise<QuarantineEntry>;
  onRunUpdated(callback: (event: RunUpdatedEvent) => void): () => void;
}

export const defaultApiClient: ApiClient = {
  getRuns: async () => {
    const res = await fetch('/api/v1/runs');
    if (!res.ok) throw new Error('Failed to fetch runs');
    return z.array(RunSchema).parse(await res.json());
  },
  getRun: async (id) => {
    const res = await fetch(`/api/v1/dashboard/runs/${encodeURIComponent(id)}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Run not found');
      throw new Error('Failed to fetch run');
    }
    return RunSchema.parse(await res.json());
  },
  getAnalyticsSummary: async () => {
    const res = await fetch('/api/v1/dashboard/analytics/summary');
    if (!res.ok) throw new Error('Failed to fetch analytics');
    return AnalyticsSummarySchema.parse(await res.json());
  },
  getQuarantine: async () => {
    const res = await fetch('/api/v1/dashboard/quarantine');
    if (!res.ok) throw new Error('Failed to fetch quarantine list');
    return z.array(QuarantineEntrySchema).parse(await res.json());
  },
  addQuarantine: async (entry) => {
    const res = await fetch('/api/v1/dashboard/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    });
    if (!res.ok) throw new Error('Failed to add to quarantine');
    return QuarantineEntrySchema.parse(await res.json());
  },
  onRunUpdated: (callback) => {
    if (typeof EventSource === 'undefined') return () => {};
    const source = new EventSource('/api/v1/events');
    const handler = (event: MessageEvent) => {
      try {
        const raw: unknown = JSON.parse(event.data);
        const envelope = CanonicalRealtimeEnvelopeSchema.safeParse(raw);
        const candidate = envelope.success ? envelope.data.data : raw;
        const parsed = RunUpdatedEventSchema.safeParse(candidate);
        if (parsed.success) callback(parsed.data);
      } catch {
        return;
      }
    };
    source.addEventListener('run:updated', handler);
    source.addEventListener('message', handler);
    return () => {
      source.removeEventListener('run:updated', handler);
      source.removeEventListener('message', handler);
      source.close();
    };
  },
};
