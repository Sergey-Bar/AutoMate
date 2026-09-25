import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultApiClient, getArtifactUrl, type RunEventSubscription } from './api.js';
import { makePhaseEvent, makeRun, TEST_TIMESTAMP } from '../test-utils.js';
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
    const subscription: RunEventSubscription = { onEvent, onReconnect, onRefetch, onConnectionChange };
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
    source?.dispatch('run:updated', { type: 'run:updated', runId: 'durable-run', status: 'running' });
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

  it('keeps legacy dashboard summary helpers available', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
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
