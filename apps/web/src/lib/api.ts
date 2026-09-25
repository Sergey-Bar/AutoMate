import { z } from 'zod/v4';
import {
  ArtifactDescriptorSchema,
  CreateRunRequestSchema,
  GateEvaluationSchema,
  NormalizedRunSchema,
  ReleaseReadinessSchema,
  RunEventEnvelopeSchema,
  RunEventTypeSchema,
  type ArtifactDescriptor,
  type CreateRunRequest,
  type GateEvaluation,
  type NormalizedRun,
  type ReleaseReadiness,
  type RunEventEnvelope,
} from '@automate/shared-contracts';

export const RunSchema = NormalizedRunSchema;
export const RunEventSchema = RunEventEnvelopeSchema;
export type Run = NormalizedRun;
export type RunEvent = RunEventEnvelope;
export type { ArtifactDescriptor, CreateRunRequest, GateEvaluation, ReleaseReadiness };

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

export type AnalyticsSummary = z.infer<typeof AnalyticsSummarySchema>;
export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RunEventSubscription {
  onEvent: (event: RunEvent) => void;
  onReconnect?: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface ApiClient {
  getRuns(): Promise<Run[]>;
  getRun(id: string): Promise<Run>;
  createRun(request: CreateRunRequest): Promise<Run>;
  cancelRun(id: string): Promise<Run>;
  retryRun(id: string, idempotencyKey?: string): Promise<Run>;
  getRunArtifacts(id: string): Promise<ArtifactDescriptor[]>;
  getRunGate(id: string): Promise<GateEvaluation | null>;
  getReleaseReadiness(releaseId: string): Promise<ReleaseReadiness | null>;
  getAnalyticsSummary(): Promise<AnalyticsSummary>;
  getQuarantine(): Promise<QuarantineEntry[]>;
  addQuarantine(entry: {
    testTitle: string;
    testFile: string;
    reason?: string;
  }): Promise<QuarantineEntry>;
  subscribeToRunEvents(subscription: RunEventSubscription): () => void;
}

async function responseError(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  const nestedError =
    typeof body?.error === 'object' && body.error !== null
      ? (body.error as { message?: unknown }).message
      : undefined;
  const detail =
    typeof body?.error === 'string'
      ? body.error
      : typeof nestedError === 'string'
        ? nestedError
        : typeof body?.message === 'string'
          ? body.message
          : response.statusText;
  return new ApiError(detail || `Request failed with status ${response.status}`, response.status);
}

async function request(response: Response): Promise<Response> {
  if (!response.ok) throw await responseError(response);
  return response;
}

async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await response.json();
  return schema.parse(raw);
}

async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return parse(await request(await fetch(path, { credentials: 'include' })), schema);
}

function optionalGetJson<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
  return getJson(path, schema).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
}

function artifactPath(artifactId: string): string {
  return `/api/v1/artifacts/${encodeURIComponent(artifactId)}`;
}

export const defaultApiClient: ApiClient = {
  getRuns: () => getJson('/api/v1/runs', z.array(NormalizedRunSchema)),
  getRun: (id) => getJson(`/api/v1/runs/${encodeURIComponent(id)}`, NormalizedRunSchema),
  createRun: async (requestBody) => {
    const input = CreateRunRequestSchema.parse(requestBody);
    return parse(
      await request(
        await fetch('/api/v1/runs', {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Idempotency-Key': input.idempotencyKey,
          },
          body: JSON.stringify(input),
        }),
      ),
      NormalizedRunSchema,
    );
  },
  cancelRun: async (id) =>
    parse(
      await request(
        await fetch(`/api/v1/runs/${encodeURIComponent(id)}/cancel`, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json' },
        }),
      ),
      NormalizedRunSchema,
    ),
  retryRun: async (id, idempotencyKey) => {
    const key = idempotencyKey ?? crypto.randomUUID();
    return parse(
      await request(
        await fetch(`/api/v1/runs/${encodeURIComponent(id)}/retry`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            Accept: 'application/json',
            'Idempotency-Key': key,
          },
        }),
      ),
      NormalizedRunSchema,
    );
  },
  getRunArtifacts: (id) =>
    getJson(`/api/v1/runs/${encodeURIComponent(id)}/artifacts`, z.array(ArtifactDescriptorSchema)),
  getRunGate: (id) =>
    optionalGetJson(`/api/v1/runs/${encodeURIComponent(id)}/gate`, GateEvaluationSchema),
  getReleaseReadiness: (releaseId) =>
    optionalGetJson(
      `/api/v1/releases/${encodeURIComponent(releaseId)}/readiness`,
      ReleaseReadinessSchema,
    ),
  getAnalyticsSummary: () => getJson('/api/v1/dashboard/analytics/summary', AnalyticsSummarySchema),
  getQuarantine: () => getJson('/api/v1/dashboard/quarantine', z.array(QuarantineEntrySchema)),
  addQuarantine: async (entry) =>
    parse(
      await request(
        await fetch('/api/v1/dashboard/quarantine', {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        }),
      ),
      QuarantineEntrySchema,
    ),
  subscribeToRunEvents: ({ onEvent, onReconnect, onConnectionChange }) => {
    if (typeof EventSource === 'undefined') return () => undefined;
    const source = new EventSource('/api/v1/events', { withCredentials: true });
    const lastSequence = new Map<string, number>();
    let opened = false;

    const handleMessage = (message: MessageEvent<string>) => {
      try {
        const raw: unknown = JSON.parse(message.data);
        const parsed = RunEventEnvelopeSchema.safeParse(raw);
        let event: RunEvent;
        if (parsed.success) {
          event = parsed.data;
        } else if (
          raw &&
          typeof raw === 'object' &&
          (raw as { type?: unknown }).type === 'run:updated'
        ) {
          const legacy = raw as { runId?: unknown; status?: unknown; timestamp?: unknown };
          if (typeof legacy.runId !== 'string') return;
          const runId = legacy.runId;
          const sequence = (lastSequence.get(runId) ?? 0) + 1;
          lastSequence.set(runId, sequence);
          event = {
            version: '1',
            eventId: `${runId}:${typeof legacy.timestamp === 'string' ? legacy.timestamp : sequence}`,
            type: 'run.phase_changed',
            sequence,
            occurredAt:
              typeof legacy.timestamp === 'string' ? legacy.timestamp : new Date().toISOString(),
            runId,
            payload: { phase: 'running', outcome: null },
          };
          onEvent(event);
          return;
        } else {
          return;
        }
        const previous = lastSequence.get(event.runId) ?? 0;
        if (event.sequence <= previous) return;
        lastSequence.set(event.runId, event.sequence);
        onEvent(event);
      } catch {
        return;
      }
    };

    source.onopen = () => {
      onConnectionChange?.(true);
      if (opened) onReconnect?.();
      opened = true;
    };
    source.onerror = () => onConnectionChange?.(false);

    for (const type of RunEventTypeSchema.options) {
      source.addEventListener(type, handleMessage as EventListener);
    }
    source.addEventListener('message', handleMessage as EventListener);

    return () => {
      for (const type of RunEventTypeSchema.options) {
        source.removeEventListener(type, handleMessage as EventListener);
      }
      source.removeEventListener('message', handleMessage as EventListener);
      source.close();
    };
  },
};

export function getArtifactUrl(artifactId: string): string {
  return artifactPath(artifactId);
}
