import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultApiClient,
  getArtifactUrl,
  isAbortError,
  resetRunEventStream,
  resetSessionExpiry,
  ResponseContractError,
  setSessionExpiredResponder,
  subscribeToSessionExpired,
  type RunEvent,
  type RunEventSubscription,
} from './api.js';
import { abortError, makePhaseEvent, makeRun, TEST_TIMESTAMP } from '../test-utils.js';
import type { CreateRunRequest } from '@automate/shared-contracts';

class FakeEventSource {
  static instance: FakeEventSource | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>();
  closed = false;

  constructor(
    readonly url: string,
    readonly options?: EventSourceInit,
  ) {
    FakeEventSource.instance = this;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const handlers = this.listeners.get(type) ?? new Set<(event: MessageEvent<string>) => void>();
    handlers.add(listener as (event: MessageEvent<string>) => void);
    this.listeners.set(type, handlers);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as (event: MessageEvent<string>) => void);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.();
  }

  dispatch(type: string, data: unknown): void {
    this.listeners
      .get(type)
      ?.forEach((listener) => listener({ data: JSON.stringify(data) } as MessageEvent<string>));
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.instance = null;
  // The run-event stream is a shared, module-level connection. Without dropping
  // it between cases, a subscriber from an earlier case receives the next case's
  // events and an unclosed source stops a newly stubbed `EventSource` from ever
  // being constructed.
  resetRunEventStream();
  resetSessionExpiry();
  setSessionExpiredResponder(null);
});

describe('ApiClient', () => {
  it('fetches and validates canonical runs with session cookies', async () => {
    const run = makeRun();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([run]), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(defaultApiClient.getRuns()).resolves.toEqual([run]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs', { credentials: 'include' });
  });

  it('fetches an encoded run detail', async () => {
    const run = makeRun({ id: 'run/1' });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(defaultApiClient.getRun('run/1')).resolves.toEqual(run);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs/run%2F1', { credentials: 'include' });
  });

  it('creates a run with shared-schema request parsing and idempotency header', async () => {
    const run = makeRun();
    const request: CreateRunRequest = {
      externalId: null,
      source: 'web',
      projectId: 'project-1',
      environmentId: 'environment-1',
      releaseId: 'release-1',
      branch: 'main',
      commit: 'abc123',
      testType: 'browser',
      framework: 'playwright',
      adapterVersion: '1',
      suite: 'smoke',
      selection: { testIds: [], paths: ['tests/example.spec.ts'], tags: [] },
      timeoutMs: 1_800_000,
      idempotencyKey: 'launch-1',
      retryOfRunId: undefined,
      priority: 0,
      requiredCapabilities: ['playwright'],
      labels: [],
      configuration: {},
      policyId: undefined,
      availableAt: undefined,
      metadata: {},
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(run), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(defaultApiClient.createRun(request)).resolves.toEqual(run);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Idempotency-Key': 'launch-1' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      projectId: 'project-1',
      releaseId: 'release-1',
    });
  });

  it('cancels and retries runs with canonical endpoints', async () => {
    const run = makeRun();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(run), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(run), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    await defaultApiClient.cancelRun('run-1');
    await defaultApiClient.retryRun('run-1', 'retry-1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/runs/run-1/cancel');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/runs/run-1/retry');
    expect((fetchMock.mock.calls[1]?.[1] as RequestInit).headers).toMatchObject({
      'Idempotency-Key': 'retry-1',
    });
  });

  it('returns null for unavailable optional gate and readiness evidence', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Missing' } }), {
        status: 404,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(defaultApiClient.getRunGate('missing')).resolves.toBeNull();
    await expect(defaultApiClient.getReleaseReadiness('missing')).resolves.toBeNull();
  });

  it('exposes non-404 API failures as ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { code: 'DB_DOWN', message: 'Database unavailable' } }),
            { status: 503 },
          ),
        ),
    );
    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'Database unavailable',
    });
  });

  it('loads canonical artifact, gate, and readiness evidence', async () => {
    const artifact = {
      id: 'artifact-1',
      runId: 'run-1',
      jobId: null,
      testId: null,
      kind: 'log',
      name: 'runner.log',
      contentType: 'text/plain',
      storageKey: 'private/runner.log',
      checksum: 'a'.repeat(64),
      sizeBytes: 10,
      createdAt: TEST_TIMESTAMP,
      expiresAt: null,
      legalHold: false,
      metadata: {},
    };
    const gate = {
      id: 'gate-1',
      runId: 'run-1',
      releaseId: 'release-1',
      policyId: 'policy-1',
      policyVersion: '1',
      policyHash: 'b'.repeat(64),
      status: 'passed',
      decision: 'ready',
      reasons: [],
      evidenceRefs: ['run-1'],
      domainStatuses: {
        browser: 'passed',
        api: 'not_configured',
        mobile: 'not_configured',
        performance: 'not_configured',
        security: 'not_configured',
        accessibility: 'not_configured',
        other: 'not_configured',
      },
      evaluatedAt: TEST_TIMESTAMP,
    };
    const readiness = {
      releaseId: 'release-1',
      decision: 'ready',
      browser: 'passed',
      domains: gate.domainStatuses,
      latestRunId: 'run-1',
      gate,
      evaluatedAt: TEST_TIMESTAMP,
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify([artifact]), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(gate), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify(readiness), { status: 200 })),
    );
    await expect(defaultApiClient.getRunArtifacts('run-1')).resolves.toEqual([artifact]);
    await expect(defaultApiClient.getRunGate('run-1')).resolves.toEqual(gate);
    await expect(defaultApiClient.getReleaseReadiness('release-1')).resolves.toEqual(readiness);
  });

  it('keeps dashboard quarantine and nullable duration compatibility', async () => {
    const entry = {
      id: 'quarantine-1',
      testTitle: 'flaky test',
      testFile: 'e2e/flaky.spec.ts',
      reason: null,
      quarantinedAt: TEST_TIMESTAMP,
      status: 'pending',
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entry), { status: 201 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ totalRuns: 0, passRate: 0, avgDurationMs: null }), {
          status: 200,
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(defaultApiClient.getQuarantine()).resolves.toEqual([]);
    await expect(
      defaultApiClient.addQuarantine({ testTitle: 'flaky test', testFile: 'e2e/flaky.spec.ts' }),
    ).resolves.toEqual(entry);
    await expect(defaultApiClient.getAnalyticsSummary()).resolves.toEqual({
      totalRuns: 0,
      passRate: 0,
      avgDurationMs: null,
    });
  });

  it('exposes string, message, and status API errors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'string error' }), { status: 400 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'message error' }), { status: 400 }),
      )
      .mockResolvedValueOnce(new Response('', { status: 500, statusText: 'Server Error' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ message: 'string error' });
    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ message: 'message error' });
    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ message: 'Server Error' });
  });

  it('builds authenticated artifact paths without exposing storage keys', () => {
    expect(getArtifactUrl('artifact/1')).toBe('/api/v1/artifacts/artifact%2F1');
  });

  it('validates canonical SSE events and refetches after reconnect', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    const onReconnect = vi.fn();
    const onRefetch = vi.fn();
    const onConnectionChange = vi.fn();
    const unsubscribe = defaultApiClient.subscribeToRunEvents({
      onEvent,
      onReconnect,
      onRefetch,
      onConnectionChange,
    });
    const subscription: RunEventSubscription = {
      onEvent,
      onReconnect,
      onRefetch,
      onConnectionChange,
    };
    const source = FakeEventSource.instance;
    expect(source?.url).toBe('/api/v1/events');
    expect(source?.options?.withCredentials).toBe(true);

    source?.open();
    source?.onerror?.();
    expect(onConnectionChange).toHaveBeenLastCalledWith(false);
    source?.dispatch('run.phase_changed', makePhaseEvent({ phase: 'running' }));
    source?.dispatch('message', makePhaseEvent({ sequence: 0, phase: 'queued' }));
    expect(onEvent).toHaveBeenCalledOnce();
    expect(onConnectionChange).toHaveBeenCalledWith(true);

    source?.open();
    expect(onReconnect).toHaveBeenCalledOnce();
    source?.dispatch('run.phase_changed', { invalid: true });
    const messageListener = source?.listeners.get('message')?.values().next().value;
    messageListener?.({ data: '{' } as MessageEvent<string>);
    expect(onEvent).toHaveBeenCalledOnce();
    const refetchListener = source?.listeners.get('refetch')?.values().next().value;
    refetchListener?.({} as MessageEvent<string>);
    expect(onRefetch).toHaveBeenCalledOnce();
    unsubscribe();
    expect(source?.closed).toBe(true);
    expect(subscription.onEvent).toBe(onEvent);
  });

  it('adapts legacy run updates through the canonical client', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    const unsubscribe = defaultApiClient.subscribeToRunEvents({ onEvent });
    const source = FakeEventSource.instance;
    source?.dispatch('message', { type: 'run:updated', runId: 'legacy-run', status: 'running' });
    source?.dispatch('run:updated', {
      type: 'run:updated',
      runId: 'durable-run',
      status: 'running',
    });
    source?.dispatch('message', { type: 'run:updated', status: 'running' });
    source?.dispatch('message', { type: 'run:updated', runId: 'legacy-run', status: 'passed' });
    expect(onEvent).toHaveBeenCalledTimes(3);
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      runId: 'legacy-run',
      type: 'run.phase_changed',
    });
    expect(onEvent.mock.calls[1]?.[0]).toMatchObject({
      runId: 'durable-run',
      type: 'run.phase_changed',
    });
    unsubscribe();
  });

  it('returns an inert SSE subscription when EventSource is unavailable', () => {
    vi.stubGlobal('EventSource', undefined);
    const unsubscribe = defaultApiClient.subscribeToRunEvents({ onEvent: vi.fn() });
    expect(() => unsubscribe()).not.toThrow();
  });

  it('projects a legacy run status onto the phase and outcome it means', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    defaultApiClient.subscribeToRunEvents({ onEvent });
    const source = FakeEventSource.instance;

    const project = (status: string) => {
      source?.dispatch('run:updated', {
        type: 'run:updated',
        runId: `run-for-${status}`,
        status,
        timestamp: '2026-09-25T00:00:00.000Z',
      });
      return onEvent.mock.calls.at(-1)?.[0] as RunEvent | undefined;
    };

    // A reporter announcing a terminal status must not move the run to `running`.
    // The previous projection did exactly that, so the dashboard said RUNNING for
    // a run the producer had already finished.
    expect(project('passed')).toMatchObject({
      type: 'run.phase_changed',
      payload: { phase: 'complete', outcome: 'passed' },
    });
    expect(project('failed')).toMatchObject({ payload: { phase: 'complete', outcome: 'failed' } });
    expect(project('cancelled')).toMatchObject({
      payload: { phase: 'cancelled', outcome: 'cancelled' },
    });
    expect(project('timed_out')).toMatchObject({
      payload: { phase: 'timed_out', outcome: 'timed_out' },
    });
    expect(project('error')).toMatchObject({
      payload: { phase: 'infra_failed', outcome: 'infra_failed' },
    });
    expect(project('interrupted')).toMatchObject({
      payload: { phase: 'blocked', outcome: 'infra_failed' },
    });
    expect(project('queued')).toMatchObject({ payload: { phase: 'queued', outcome: null } });
    // `skipped` is not an outcome in the canonical vocabulary, so it lands on
    // `unknown` rather than inventing a value the schema does not have.
    expect(project('skipped')).toMatchObject({
      payload: { phase: 'complete', outcome: 'unknown' },
    });
    // An unknown status is left in flight rather than guessed at a terminal phase.
    expect(project('teleported')).toMatchObject({ payload: { phase: 'running', outcome: null } });
  });

  it('gives each run its own sequence so one run cannot suppress another', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    defaultApiClient.subscribeToRunEvents({ onEvent });
    const source = FakeEventSource.instance;

    for (let index = 0; index < 3; index += 1) {
      source?.dispatch('run:updated', { type: 'run:updated', runId: 'run-a', status: 'running' });
      source?.dispatch('run:updated', { type: 'run:updated', runId: 'run-b', status: 'running' });
    }

    expect(onEvent).toHaveBeenCalledTimes(6);
    const forA = onEvent.mock.calls
      .map((call) => call[0] as RunEvent)
      .filter((event) => event.runId === 'run-a')
      .map((event) => event.sequence);
    expect(forA, 'a per-run sequence must not be deduped away').toEqual([1, 2, 3]);
  });

  it('accepts the re-labelled frame /api/v1/events actually emits for a reporter update', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    defaultApiClient.subscribeToRunEvents({ onEvent });
    const source = FakeEventSource.instance;

    // Captured from a live `/api/v1/events` against the dev stack. The frame is
    // named `run.phase_changed` and its `version` is a *number*, but its payload
    // is the reporter's own `run:updated` body with no `phase` and no `outcome` —
    // so the envelope schema rejects it and the update used to be dropped with no
    // error anywhere. Every reporter update reached the dashboard by way of the
    // five-second poll, or not at all.
    source?.dispatch('run.phase_changed', {
      version: 1,
      type: 'run.phase_changed',
      eventId: '25c67a6b-5592-4e4e-9d72-0e2e6d2b62a1',
      sequence: 2,
      occurredAt: '2026-09-27T04:05:50.304Z',
      runId: 'ce78c794-9242-4b75-8b0b-5b8f7696ec03',
      payload: {
        type: 'run:updated',
        runId: 'ce78c794-9242-4b75-8b0b-5b8f7696ec03',
        status: 'passed',
        version: '1',
        timestamp: '2026-09-27T04:05:50.304Z',
      },
    });

    expect(onEvent).toHaveBeenCalledOnce();
    expect(onEvent.mock.calls[0]?.[0]).toMatchObject({
      runId: 'ce78c794-9242-4b75-8b0b-5b8f7696ec03',
      type: 'run.phase_changed',
      payload: { phase: 'complete', outcome: 'passed' },
    });
  });

  it('still drops a malformed frame rather than inventing a run update from it', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    defaultApiClient.subscribeToRunEvents({ onEvent });
    const source = FakeEventSource.instance;

    // No run id, no status, and a payload that is not an object: none of these
    // can be attributed to a run, so none may be rendered as one.
    source?.dispatch('message', { type: 'run:updated' });
    source?.dispatch('run.phase_changed', { type: 'run.phase_changed', payload: 'nonsense' });
    source?.dispatch('run.phase_changed', { type: 'run.phase_changed', payload: 42 });
    source?.dispatch('message', { type: 'totally.unknown', runId: 'run-x' });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('keeps legacy dashboard summary helpers available', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ totalRuns: 1, passRate: 100, avgDurationMs: 10 }), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(defaultApiClient.getAnalyticsSummary()).resolves.toEqual({
      totalRuns: 1,
      passRate: 100,
      avgDurationMs: 10,
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/dashboard/analytics/summary', {
      credentials: 'include',
    });
    expect(TEST_TIMESTAMP).toBe('2026-09-25T00:00:00.000Z');
  });
});

/**
 * A session that expires mid-visit. `useRuns` polls every five seconds, so an
 * expired session produces one 401 per poll for as long as the page stays open.
 * These are the tests that keep that from becoming a redirect loop.
 */
describe('session expiry', () => {
  it('reports a 401 once with the path the user was on', async () => {
    const responder = vi.fn();
    setSessionExpiredResponder(responder);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ status: 401 });

    expect(responder).toHaveBeenCalledOnce();
    expect(responder).toHaveBeenCalledWith('/');
  });

  it('does not retry, and does not redirect again, while every request keeps failing', async () => {
    const responder = vi.fn();
    setSessionExpiredResponder(responder);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    for (let poll = 0; poll < 4; poll += 1) {
      await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ status: 401 });
    }

    // One request per call — a 401 is an answer, not something to try again.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // And one redirect for the whole expiry, not one per poll.
    expect(responder).toHaveBeenCalledOnce();
  });

  it('treats several concurrent 401s as one expiry', async () => {
    const responder = vi.fn();
    setSessionExpiredResponder(responder);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    const results = await Promise.allSettled([
      defaultApiClient.getRuns(),
      defaultApiClient.getAnalyticsSummary(),
      defaultApiClient.getQuarantine(),
    ]);

    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(responder).toHaveBeenCalledOnce();
  });

  it('re-arms after a successful response so a later expiry is still reported', async () => {
    const responder = vi.fn();
    setSessionExpiredResponder(responder);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([makeRun()]), { status: 200 }))
      .mockResolvedValue(new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(defaultApiClient.getRuns()).resolves.toHaveLength(1);
    expect(responder).not.toHaveBeenCalled();

    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ status: 401 });
    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ status: 401 });

    expect(responder).toHaveBeenCalledOnce();
  });

  it('notifies subscribers before the responder, and stops after unsubscribe', async () => {
    const order: string[] = [];
    const unsubscribe = subscribeToSessionExpired((returnPath) =>
      order.push(`subscriber:${returnPath}`),
    );
    setSessionExpiredResponder(() => order.push('responder'));
    const fetchMock = vi.fn().mockImplementation(() => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(defaultApiClient.getRun('run-1')).rejects.toMatchObject({ status: 401 });
    expect(order).toEqual(['subscriber:/', 'responder']);

    // Still the same expiry, so the latch holds: a second 401 notifies nobody.
    await expect(defaultApiClient.getRun('run-1')).rejects.toMatchObject({ status: 401 });
    expect(order).toEqual(['subscriber:/', 'responder']);

    unsubscribe();
    fetchMock.mockImplementation(() => new Response('[]', { status: 200 }));
    await expect(defaultApiClient.getRuns()).resolves.toEqual([]);
    fetchMock.mockImplementation(() => new Response('{}', { status: 401 }));
    await expect(defaultApiClient.getRun('run-1')).rejects.toMatchObject({ status: 401 });
    expect(order).toEqual(['subscriber:/', 'responder', 'responder']);
  });

  it('sends an optional-evidence 401 to the session handler rather than reading it as absent', async () => {
    const responder = vi.fn();
    setSessionExpiredResponder(responder);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    // 404 is the only "absent" answer. Treating 401 the same way renders a
    // release as having no gate rather than as one the user cannot see.
    await expect(defaultApiClient.getRunGate('run-1')).rejects.toMatchObject({ status: 401 });
    await expect(defaultApiClient.getReleaseReadiness('release-1')).rejects.toMatchObject({
      status: 401,
    });
    expect(responder).toHaveBeenCalledOnce();
  });
});

describe('cancellation', () => {
  it('threads the caller signal into every request', async () => {
    const run = makeRun();
    // A fresh `Response` per call, and one shaped for the endpoint being called:
    // a body can only be read once, and `getRuns` is a list where `getRun` is not.
    const bodies: Record<string, unknown> = {
      '/api/v1/runs': [run],
      '/api/v1/runs/run-1': run,
      '/api/v1/runs/run-1/cancel': run,
      '/api/v1/runs/run-1/retry': run,
      '/api/v1/dashboard/quarantine': {
        id: 'quarantine-1',
        testTitle: 't',
        testFile: 'f',
        reason: null,
        quarantinedAt: TEST_TIMESTAMP,
        status: 'pending',
      },
    };
    const fetchMock = vi
      .fn()
      .mockImplementation(
        (url: string) => new Response(JSON.stringify(bodies[url]), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await defaultApiClient.getRuns({ signal: controller.signal });
    await defaultApiClient.getRun('run-1', { signal: controller.signal });
    await defaultApiClient.cancelRun('run-1', { signal: controller.signal });
    await defaultApiClient.retryRun('run-1', 'key-1', { signal: controller.signal });
    await defaultApiClient.addQuarantine(
      { testTitle: 't', testFile: 'f' },
      { signal: controller.signal },
    );

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/runs',
      '/api/v1/runs/run-1',
      '/api/v1/runs/run-1/cancel',
      '/api/v1/runs/run-1/retry',
      '/api/v1/dashboard/quarantine',
    ]);
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).signal).toBe(controller.signal);
    }
  });

  it('omits the signal entirely when the caller has none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await defaultApiClient.getRuns();
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ credentials: 'include' });
  });

  it('propagates an abort as an abort rather than as a contract or API failure', async () => {
    const controller = new AbortController();
    const failure = abortError();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((_resolve, reject) => {
            controller.signal.addEventListener('abort', () => reject(failure), { once: true });
          }),
      ),
    );

    const pending = defaultApiClient.getRuns({ signal: controller.signal });
    controller.abort();

    // Identity, not just the name: a wrapped rejection would be indistinguishable
    // from a real failure by anything that only checks `status`.
    await expect(pending).rejects.toBe(failure);
    await expect(pending).rejects.not.toBeInstanceOf(ResponseContractError);
  });

  it('rejects immediately for a signal that was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn().mockImplementation(() => Promise.reject(abortError()));
    vi.stubGlobal('fetch', fetchMock);

    await expect(defaultApiClient.getRun('run-1', { signal: controller.signal })).rejects.toSatisfy(
      isAbortError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('recognises aborts by name, not by realm', () => {
    expect(isAbortError(abortError())).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('Failed to fetch'))).toBe(false);
    expect(isAbortError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });

  it('surfaces a transport failure unchanged and does not retry it', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    await expect(defaultApiClient.getRuns()).rejects.toThrow('Failed to fetch');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

describe('response contract failures', () => {
  it('reports a 200 that is not JSON as a contract failure naming the path', async () => {
    // What a reverse proxy or a login redirect actually returns.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('<!doctype html><html><body>Sign in</body></html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        }),
      ),
    );

    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({
      name: 'ResponseContractError',
      path: '/api/v1/runs',
      status: 200,
      message: 'Response from /api/v1/runs was not JSON',
    });
  });

  it('reports a 200 whose shape disagrees with the schema, naming the field', async () => {
    // One field changed, so the issue list is about that field and nothing else.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          () =>
            new Response(JSON.stringify([{ ...makeRun(), phase: 'teleported' }]), { status: 200 }),
        ),
    );

    const failure = await defaultApiClient.getRuns().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ResponseContractError);
    expect((failure as ResponseContractError).path).toBe('/api/v1/runs');
    // The offending field is named so the failure is diagnosable...
    expect((failure as ResponseContractError).message).toContain('phase');
    // ...and the values the server sent are not echoed back into a message a
    // user can read.
    expect((failure as ResponseContractError).message).not.toContain('teleported');
  });

  it('reports a missing field the same way as an invalid one', async () => {
    const run = makeRun();
    const response = { ...run } as Record<string, unknown>;
    delete response['summary'];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 })),
    );

    await expect(defaultApiClient.getRun('run-1')).rejects.toMatchObject({
      name: 'ResponseContractError',
      path: '/api/v1/runs/run-1',
    });
  });

  it('keeps a 401 a session failure and not a contract failure', async () => {
    setSessionExpiredResponder(vi.fn());
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }),
        ),
    );
    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });

  it('accepts an empty but valid collection as data, not as a failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Response('[]', { status: 200 })),
    );
    await expect(defaultApiClient.getRuns()).resolves.toEqual([]);
    await expect(defaultApiClient.getRunArtifacts('run-1')).resolves.toEqual([]);
  });
});

/**
 * The default action on expiry: a real navigation to the login route, carrying
 * the path the user was on so the login page can send them back to it.
 */
describe('default session expiry responder', () => {
  function stubLocation(pathname: string, search = ''): { assign: ReturnType<typeof vi.fn> } {
    const assign = vi.fn();
    vi.stubGlobal('location', { pathname, search, assign });
    return { assign };
  }

  it('navigates to the login route with the current path encoded as the return', async () => {
    const { assign } = stubLocation('/dashboard/runs', '?status=failed');
    setSessionExpiredResponder(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ status: 401 });

    expect(assign).toHaveBeenCalledOnce();
    expect(assign).toHaveBeenCalledWith('/login?return=%2Fdashboard%2Fruns%3Fstatus%3Dfailed');
  });

  it('does not navigate again when the user is already signing in', async () => {
    const { assign } = stubLocation('/login', '?return=%2Fdashboard');
    setSessionExpiredResponder(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));

    await expect(defaultApiClient.getRuns()).rejects.toMatchObject({ status: 401 });

    // Reloading the login page would reproduce the same expired session and
    // assign the same URL again — the loop this latch exists to prevent.
    expect(assign).not.toHaveBeenCalled();
  });
});
