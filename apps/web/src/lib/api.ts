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
  RUN_UPDATED_EVENT_TYPE,
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
  // Where the entry stands. `pending` is the fail-closed default: the test is
  // quarantined but nobody has decided yet, so it still counts in the pass rate.
  // `approved` is the decision that removes it. The API added this field with the
  // decision endpoint, and a client schema that omitted it would have called every
  // entry indistinguishable — which is how a quarantine list reads as "these are all
  // excluded" when none of them are.
  status: z.enum(['pending', 'approved', 'rejected']),
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

/**
 * A response that arrived with a success status but a body the client contract
 * cannot accept — a 200 that is not JSON, or JSON that is not the declared shape.
 *
 * A separate class from {@link ApiError} because the two failures need different
 * handling and were previously indistinguishable: `response.json()` throws a bare
 * `SyntaxError` and `schema.parse` throws a `ZodError` whose message is a dump of
 * every field that disagreed. Both arrived at a hook as "some Error", so a proxy
 * returning an HTML error page and a server that changed a field name rendered the
 * same opaque text.
 */
export class ResponseContractError extends Error {
  constructor(
    message: string,
    readonly path: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ResponseContractError';
  }
}

/**
 * Whether a rejection is a cancellation the caller asked for rather than a failure.
 *
 * An aborted `fetch` rejects with a `DOMException` named `AbortError`. A hook that
 * treats that as a failure renders "runs unavailable" for a request it deliberately
 * cancelled — on unmount, or when a newer poll superseded an older one — so every
 * cancellation needs a name that is checked before the error state.
 *
 * Duck-typed on `name` rather than `instanceof DOMException`: the rejection is
 * constructed by the fetch implementation, and Node, jsdom and the browser do not
 * agree on which realm provides that constructor.
 */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** Per-request cancellation, threaded from a hook's `AbortController`. */
export interface RequestOptions {
  signal?: AbortSignal;
}

function withSignal(init: RequestInit, signal: AbortSignal | undefined): RequestInit {
  return signal ? { ...init, signal } : init;
}

/**
 * The reporter's `run:updated` carries a `status`, not a phase and an outcome.
 *
 * The client used to read that event and emit `{ phase: 'running', outcome: null }`
 * regardless of the status it was told about, so a reporter announcing
 * `status: 'passed'` moved the run to *running* on screen. The row then said
 * RUNNING for up to a full poll interval, and the badge derived from the phase said
 * so. This maps the status onto the same phase/outcome pair the API's own
 * canonical projection uses, so a pushed event and a fetched run agree.
 *
 * `skipped` has no outcome in the canonical vocabulary — the schema allows
 * `unknown`, not `skipped` — so it is projected as an unknown result on a
 * completed run rather than invented into a new one.
 *
 * An unrecognised status is treated as `running` rather than guessed at: a
 * terminal phase the client has never heard of would be rendered as a finished
 * run with no outcome, which reads as "no result" on a run that does have one.
 */
function projectLegacyStatus(status: unknown): { phase: Run['phase']; outcome: Run['outcome'] } {
  switch (status) {
    case 'passed':
      return { phase: 'complete', outcome: 'passed' };
    case 'failed':
      return { phase: 'complete', outcome: 'failed' };
    case 'cancelled':
      return { phase: 'cancelled', outcome: 'cancelled' };
    case 'timed_out':
      return { phase: 'timed_out', outcome: 'timed_out' };
    case 'error':
      return { phase: 'infra_failed', outcome: 'infra_failed' };
    case 'interrupted':
      return { phase: 'blocked', outcome: 'infra_failed' };
    case 'skipped':
      return { phase: 'complete', outcome: 'unknown' };
    case 'queued':
      return { phase: 'queued', outcome: null };
    default:
      return { phase: 'running', outcome: null };
  }
}

// ---------------------------------------------------------------------------
// Session expiry
// ---------------------------------------------------------------------------

/** The path the user was on when the session was found to be gone. */
export type SessionExpiredListener = (returnPath: string) => void;

const sessionExpiredListeners = new Set<SessionExpiredListener>();

/**
 * Whether the current expiry has already been handled.
 *
 * `useRuns` polls every five seconds, so an expired session produces a 401 every
 * five seconds for as long as the page is open. Without this latch each one would
 * redirect, and a user who lands on a page that also polls would be bounced by the
 * fastest of several timers — a redirect loop rather than a single trip to the
 * login page. A successful response clears it, so a *later* expiry is still
 * reported once.
 */
let sessionExpiryHandled = false;

function defaultSessionExpiredResponder(returnPath: string): void {
  if (typeof window === 'undefined') return;
  // Already there: reloading would only reproduce the same state.
  if (window.location.pathname === '/login') return;
  // A full navigation rather than a client-side one. The auth status is module
  // state in `useAuth`, and a soft route change would leave the stale
  // "authenticated" value in place — the guard would consider the session live
  // and render the dashboard again on the way to the login page.
  window.location.assign(`/login?return=${encodeURIComponent(returnPath)}`);
}

let sessionExpiredResponder: SessionExpiredListener = defaultSessionExpiredResponder;

function currentReturnPath(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

function reportSessionExpired(): void {
  if (sessionExpiryHandled) return;
  sessionExpiryHandled = true;
  const returnPath = currentReturnPath();
  for (const listener of sessionExpiredListeners) listener(returnPath);
  sessionExpiredResponder(returnPath);
}

/**
 * Observe session expiry. The listeners run before the responder, so a host that
 * wants to render its own state still gets to before the page navigates.
 */
export function subscribeToSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => {
    sessionExpiredListeners.delete(listener);
  };
}

/**
 * Replace the action taken on session expiry. Pass `null` to restore the default
 * (navigate to the login route).
 */
export function setSessionExpiredResponder(responder: SessionExpiredListener | null): void {
  sessionExpiredResponder = responder ?? defaultSessionExpiredResponder;
}

/**
 * Forget a handled expiry and every subscriber. The latch lives at module scope
 * because it is a property of the session, not of any one component, so a test —
 * or a host that re-authenticates in place — has to be able to clear it.
 */
export function resetSessionExpiry(): void {
  sessionExpiryHandled = false;
  sessionExpiredListeners.clear();
}

export interface RunEventSubscription {
  onEvent: (event: RunEvent) => void;
  onRefetch?: () => void;
  onReconnect?: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

export interface ApiClient {
  getRuns(options?: RequestOptions): Promise<Run[]>;
  getRun(id: string, options?: RequestOptions): Promise<Run>;
  createRun(request: CreateRunRequest, options?: RequestOptions): Promise<Run>;
  cancelRun(id: string, options?: RequestOptions): Promise<Run>;
  retryRun(id: string, idempotencyKey?: string, options?: RequestOptions): Promise<Run>;
  getRunArtifacts(id: string, options?: RequestOptions): Promise<ArtifactDescriptor[]>;
  getRunGate(id: string, options?: RequestOptions): Promise<GateEvaluation | null>;
  getReleaseReadiness(
    releaseId: string,
    options?: RequestOptions,
  ): Promise<ReleaseReadiness | null>;
  getAnalyticsSummary(options?: RequestOptions): Promise<AnalyticsSummary>;
  getQuarantine(options?: RequestOptions): Promise<QuarantineEntry[]>;
  addQuarantine(
    entry: { testTitle: string; testFile: string; reason?: string },
    options?: RequestOptions,
  ): Promise<QuarantineEntry>;
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

/**
 * The field paths a response disagreed with, never the values.
 *
 * The paths identify what broke and are safe to log and to show; the values are
 * whatever the server sent and do not belong in an error a user reads.
 */
function describeSchemaIssues(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>;
}): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

async function request(response: Response): Promise<Response> {
  if (response.status === 401) reportSessionExpired();
  if (!response.ok) throw await responseError(response);
  // The session works again, so a later expiry must be reported too. A 404 is a
  // success here as far as authentication is concerned, so this is above the
  // `!response.ok` branch's 404 special cases in `optionalGetJson`.
  sessionExpiryHandled = false;
  return response;
}

async function parse<T>(response: Response, schema: z.ZodType<T>, path: string): Promise<T> {
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new ResponseContractError(`Response from ${path} was not JSON`, path, response.status);
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw new ResponseContractError(
    `Response from ${path} did not match the expected shape: ${describeSchemaIssues(parsed.error)}`,
    path,
    response.status,
  );
}

async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestOptions,
): Promise<T> {
  return parse(
    await request(await fetch(path, withSignal({ credentials: 'include' }, options?.signal))),
    schema,
    path,
  );
}

function optionalGetJson<T>(
  path: string,
  schema: z.ZodType<T>,
  options?: RequestOptions,
): Promise<T | null> {
  return getJson(path, schema, options).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
}

function artifactPath(artifactId: string): string {
  return `/api/v1/artifacts/${encodeURIComponent(artifactId)}`;
}

interface LegacyRunUpdate {
  runId: string;
  status: unknown;
  timestamp: unknown;
}

/**
 * The reporter's `run:updated` body, wherever it appears in a frame.
 *
 * `/api/v1/events` re-labels that bus event as a `run.phase_changed` frame but
 * leaves the *reporter* body as its payload:
 *
 *     event: run.phase_changed
 *     data: {"type":"run.phase_changed","payload":{"type":"run:updated",
 *            "runId":"...","status":"passed","version":"1","timestamp":"..."}}
 *
 * `RunPhaseChangedEventPayloadSchema` requires `phase` and `outcome`, so the
 * envelope fails validation and the client discarded the frame — silently, in a
 * `catch`-free `return`. Every reporter update was therefore dropped and the
 * dashboard only ever learned about a finished run on its next five-second poll.
 * The outer `version` is a number on this frame and a string on a canonical one,
 * so the envelope cannot be salvaged by relaxing a schema either.
 *
 * Both framings are accepted here: the reporter body at the top level, and the
 * reporter body as the payload of a re-labelled phase-changed envelope. When the
 * route stops re-labelling, the first branch simply stops matching.
 */
function readLegacyRunUpdate(raw: unknown): LegacyRunUpdate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidates = [raw, (raw as { payload?: unknown }).payload];
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const body = candidate as { type?: unknown; runId?: unknown };
    if (body.type !== RUN_UPDATED_EVENT_TYPE) continue;
    if (typeof body.runId !== 'string') continue;
    const source = candidate as { status?: unknown; timestamp?: unknown };
    return { runId: body.runId, status: source.status, timestamp: source.timestamp };
  }
  return null;
}

export const defaultApiClient: ApiClient = {
  getRuns: (options) => getJson('/api/v1/runs', z.array(NormalizedRunSchema), options),
  getRun: (id, options) =>
    getJson(`/api/v1/runs/${encodeURIComponent(id)}`, NormalizedRunSchema, options),
  createRun: async (requestBody, options) => {
    const input = CreateRunRequestSchema.parse(requestBody);
    return parse(
      await request(
        await fetch(
          '/api/v1/runs',
          withSignal(
            {
              method: 'POST',
              credentials: 'include',
              headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'Idempotency-Key': input.idempotencyKey,
              },
              body: JSON.stringify(input),
            },
            options?.signal,
          ),
        ),
      ),
      NormalizedRunSchema,
      '/api/v1/runs',
    );
  },
  cancelRun: async (id, options) => {
    const path = `/api/v1/runs/${encodeURIComponent(id)}/cancel`;
    return parse(
      await request(
        await fetch(
          path,
          withSignal(
            {
              method: 'POST',
              credentials: 'include',
              headers: { Accept: 'application/json' },
            },
            options?.signal,
          ),
        ),
      ),
      NormalizedRunSchema,
      path,
    );
  },
  retryRun: async (id, idempotencyKey, options) => {
    const key = idempotencyKey ?? crypto.randomUUID();
    const path = `/api/v1/runs/${encodeURIComponent(id)}/retry`;
    return parse(
      await request(
        await fetch(
          path,
          withSignal(
            {
              method: 'POST',
              credentials: 'include',
              headers: {
                Accept: 'application/json',
                'Idempotency-Key': key,
              },
            },
            options?.signal,
          ),
        ),
      ),
      NormalizedRunSchema,
      path,
    );
  },
  getRunArtifacts: (id, options) =>
    getJson(
      `/api/v1/runs/${encodeURIComponent(id)}/artifacts`,
      z.array(ArtifactDescriptorSchema),
      options,
    ),
  getRunGate: (id, options) =>
    optionalGetJson(`/api/v1/runs/${encodeURIComponent(id)}/gate`, GateEvaluationSchema, options),
  getReleaseReadiness: (releaseId, options) =>
    optionalGetJson(
      `/api/v1/releases/${encodeURIComponent(releaseId)}/readiness`,
      ReleaseReadinessSchema,
      options,
    ),
  getAnalyticsSummary: (options) =>
    getJson('/api/v1/dashboard/analytics/summary', AnalyticsSummarySchema, options),
  getQuarantine: (options) =>
    getJson('/api/v1/dashboard/quarantine', z.array(QuarantineEntrySchema), options),
  addQuarantine: async (entry, options) => {
    const path = '/api/v1/dashboard/quarantine';
    return parse(
      await request(
        await fetch(
          path,
          withSignal(
            {
              method: 'POST',
              credentials: 'include',
              headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
              body: JSON.stringify(entry),
            },
            options?.signal,
          ),
        ),
      ),
      QuarantineEntrySchema,
      path,
    );
  },
  subscribeToRunEvents: ({ onEvent, onRefetch, onReconnect, onConnectionChange }) => {
    if (typeof EventSource === 'undefined') return () => undefined;
    const source = new EventSource('/api/v1/events', { withCredentials: true });
    const lastSequence = new Map<string, number>();
    let opened = false;

    const handleMessage = (message: MessageEvent<string>) => {
      try {
        const raw: unknown = JSON.parse(message.data);
        const legacy = readLegacyRunUpdate(raw);
        if (legacy !== null) {
          const sequence = (lastSequence.get(legacy.runId) ?? 0) + 1;
          lastSequence.set(legacy.runId, sequence);
          onEvent({
            version: '1',
            eventId: `${legacy.runId}:${typeof legacy.timestamp === 'string' ? legacy.timestamp : sequence}`,
            type: 'run.phase_changed',
            sequence,
            occurredAt:
              typeof legacy.timestamp === 'string' ? legacy.timestamp : new Date().toISOString(),
            runId: legacy.runId,
            payload: projectLegacyStatus(legacy.status),
          });
          return;
        }
        const parsed = RunEventEnvelopeSchema.safeParse(raw);
        if (!parsed.success) return;
        const event: RunEvent = parsed.data;
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
    source.addEventListener(RUN_UPDATED_EVENT_TYPE, handleMessage as EventListener);
    source.addEventListener('message', handleMessage as EventListener);
    const handleRefetch = () => onRefetch?.();
    source.addEventListener('refetch', handleRefetch);

    return () => {
      for (const type of RunEventTypeSchema.options) {
        source.removeEventListener(type, handleMessage as EventListener);
      }
      source.removeEventListener(RUN_UPDATED_EVENT_TYPE, handleMessage as EventListener);
      source.removeEventListener('message', handleMessage as EventListener);
      source.removeEventListener('refetch', handleRefetch);
      source.close();
    };
  },
};

export function getArtifactUrl(artifactId: string): string {
  return artifactPath(artifactId);
}
