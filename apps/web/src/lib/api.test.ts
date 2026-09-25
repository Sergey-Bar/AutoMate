/// <reference types="vitest/globals" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultApiClient, type RunUpdatedEvent } from './api.js';

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void): void {
    const listeners = this.listeners.get(type) ?? new Set<(event: MessageEvent) => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('defaultApiClient', () => {
  const originalFetch = globalThis.fetch;
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    FakeEventSource.instances = [];
    globalThis.fetch = vi.fn();
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.EventSource = originalEventSource;
    vi.restoreAllMocks();
  });

  it('parses a valid runs response and rejects invalid run shapes', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse([
      { id: 'run-1', status: 'passed', startedAt: '2026-05-06T00:00:00.000Z', total: 1, passed: 1, failed: 0 },
    ]));

    await expect(defaultApiClient.getRuns()).resolves.toEqual([
      { id: 'run-1', status: 'passed', startedAt: '2026-05-06T00:00:00.000Z', total: 1, passed: 1, failed: 0 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/runs');

    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'run-2', status: 'failed' }]));

    await expect(defaultApiClient.getRuns()).rejects.toThrow();
  });

  it('maps run detail HTTP failures to useful errors', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { status: 404 }));
    await expect(defaultApiClient.getRun('missing')).rejects.toThrow('Run not found');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 503 }));
    await expect(defaultApiClient.getRun('run-1')).rejects.toThrow('Failed to fetch run');
  });

  it('parses analytics and quarantine list responses and rejects HTTP failures', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse({ totalRuns: 4, passRate: 75, avgDurationMs: null }));
    await expect(defaultApiClient.getAnalyticsSummary()).resolves.toEqual({
      totalRuns: 4,
      passRate: 75,
      avgDurationMs: null,
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'analytics down' }, { status: 500 }));
    await expect(defaultApiClient.getAnalyticsSummary()).rejects.toThrow('Failed to fetch analytics');

    fetchMock.mockResolvedValueOnce(jsonResponse([
      {
        id: 'q-1',
        testTitle: 'flaky test',
        testFile: 'tests/flaky.spec.ts',
        reason: null,
        quarantinedAt: '2026-05-06T00:00:00.000Z',
      },
    ]));
    await expect(defaultApiClient.getQuarantine()).resolves.toEqual([
      {
        id: 'q-1',
        testTitle: 'flaky test',
        testFile: 'tests/flaky.spec.ts',
        reason: null,
        quarantinedAt: '2026-05-06T00:00:00.000Z',
      },
    ]);

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'quarantine down' }, { status: 503 }));
    await expect(defaultApiClient.getQuarantine()).rejects.toThrow('Failed to fetch quarantine list');
  });

  it('sends quarantine creation payload with JSON headers and parses the response', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'q-1',
      testTitle: 'flaky test',
      testFile: 'tests/flaky.spec.ts',
      reason: 'unstable network',
      quarantinedAt: '2026-05-06T00:00:00.000Z',
    }));

    await expect(defaultApiClient.addQuarantine({
      testTitle: 'flaky test',
      testFile: 'tests/flaky.spec.ts',
      reason: 'unstable network',
    })).resolves.toMatchObject({ id: 'q-1', reason: 'unstable network' });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/dashboard/quarantine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        testTitle: 'flaky test',
        testFile: 'tests/flaky.spec.ts',
        reason: 'unstable network',
      }),
    });
  });

  it('rejects failed quarantine creation without parsing the body as a success', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'bad request' }, { status: 400 }));

    await expect(defaultApiClient.addQuarantine({
      testTitle: 'bad test',
      testFile: 'tests/bad.spec.ts',
    })).rejects.toThrow('Failed to add to quarantine');
  });

  it('covers conversation and message lifecycle API calls', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'c-1', title: 'Existing', createdAt: '2026-05-06T00:00:00.000Z' }]));
    await expect(defaultApiClient.getConversations()).resolves.toEqual([
      { id: 'c-1', title: 'Existing', createdAt: '2026-05-06T00:00:00.000Z' },
    ]);

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'c-2', title: 'New', createdAt: '2026-05-06T00:01:00.000Z' }));
    await expect(defaultApiClient.createConversation('New')).resolves.toEqual({
      id: 'c-2',
      title: 'New',
      createdAt: '2026-05-06T00:01:00.000Z',
    });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/orchestrator/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New' }),
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({
      id: 'm-1',
      conversationId: 'c-2',
      role: 'assistant',
      content: 'Generated test',
      createdAt: '2026-05-06T00:02:00.000Z',
    }));
    await expect(defaultApiClient.sendMessage('c-2', 'Create tests')).resolves.toMatchObject({
      id: 'm-1',
      conversationId: 'c-2',
      role: 'assistant',
    });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/orchestrator/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: 'c-2', message: 'Create tests' }),
    });

    fetchMock.mockResolvedValueOnce(jsonResponse([
      { id: 'm-2', conversationId: 'c-2', role: 'user', content: 'Hi', createdAt: '2026-05-06T00:03:00.000Z' },
    ]));
    await expect(defaultApiClient.getMessages('c-2')).resolves.toEqual([
      { id: 'm-2', conversationId: 'c-2', role: 'user', content: 'Hi', createdAt: '2026-05-06T00:03:00.000Z' },
    ]);

    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/orchestrator/conversations/c-2/messages');
  });

  it('maps conversation and message HTTP failures to explicit errors', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 500 }));
    await expect(defaultApiClient.getConversations()).rejects.toThrow('Failed to fetch conversations');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, { status: 400 }));
    await expect(defaultApiClient.createConversation('Bad')).rejects.toThrow('Failed to create conversation');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, { status: 400 }));
    await expect(defaultApiClient.sendMessage('c-1', 'Bad')).rejects.toThrow('Failed to send message');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 500 }));
    await expect(defaultApiClient.getMessages('c-1')).rejects.toThrow('Failed to fetch messages');
  });

  it('covers model configuration read and update success and failure paths', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'llama3.1', temperature: 0.2 }));
    await expect(defaultApiClient.getModelConfig()).resolves.toEqual({ model: 'llama3.1', temperature: 0.2 });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'missing' }, { status: 404 }));
    await expect(defaultApiClient.getModelConfig()).rejects.toThrow('Failed to fetch model config');

    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'gpt-4o', temperature: 0.7 }));
    await expect(defaultApiClient.updateModelConfig({ model: 'gpt-4o', temperature: 0.7 })).resolves.toEqual({
      model: 'gpt-4o',
      temperature: 0.7,
    });
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/orchestrator/model-config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', temperature: 0.7 }),
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, { status: 400 }));
    await expect(defaultApiClient.updateModelConfig({ model: 'bad', temperature: 2 })).rejects.toThrow('Failed to update model config');
  });

  it('subscribes to SSE run updates, ignores malformed payloads, and cleans up listeners', () => {
    const received: RunUpdatedEvent[] = [];

    const unsubscribe = defaultApiClient.onRunUpdated((event) => received.push(event));
    const source = FakeEventSource.instances[0];

    expect(source).toBeDefined();
    expect(source?.url).toBe('/api/v1/events');

    source?.emit('message', 'not-json');
    source?.emit('run:updated', JSON.stringify({ type: 'wrong:event', version: '1' }));
    source?.emit('message', JSON.stringify({
      type: 'run:updated',
      version: '1',
      runId: 'run-1',
      status: 'passed',
      timestamp: '2026-05-06T00:00:00.000Z',
    }));

    expect(received).toEqual([
      {
        type: 'run:updated',
        version: '1',
        runId: 'run-1',
        status: 'passed',
        timestamp: '2026-05-06T00:00:00.000Z',
      },
    ]);

    unsubscribe();
    source?.emit('message', JSON.stringify({
      type: 'run:updated',
      version: '1',
      runId: 'run-2',
      status: 'failed',
      timestamp: '2026-05-06T00:01:00.000Z',
    }));

    expect(received).toHaveLength(1);
    expect(source?.close).toHaveBeenCalledOnce();
  });

  it('returns a no-op SSE unsubscribe when EventSource is unavailable', () => {
    Object.defineProperty(globalThis, 'EventSource', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const callback = vi.fn();
    const unsubscribe = defaultApiClient.onRunUpdated(callback);

    expect(() => unsubscribe()).not.toThrow();
    expect(callback).not.toHaveBeenCalled();
    expect(FakeEventSource.instances).toEqual([]);
  });

  it('maps getRuns HTTP failure to error', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 500 }));
    await expect(defaultApiClient.getRuns()).rejects.toThrow('Failed to fetch runs');
  });

  it('covers getSuites success and failure', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse([
      { id: 's-1', name: 'Auth Suite', projectName: 'web', totalRuns: 5, lastRunAt: '2026-05-06T00:00:00.000Z', passRate: 80 },
    ]));
    await expect(defaultApiClient.getSuites()).resolves.toEqual([
      { id: 's-1', name: 'Auth Suite', projectName: 'web', totalRuns: 5, lastRunAt: '2026-05-06T00:00:00.000Z', passRate: 80 },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/dashboard/suites');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 500 }));
    await expect(defaultApiClient.getSuites()).rejects.toThrow('Failed to fetch suites');
  });

  it('covers getTests success and failure', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse([
      { id: 't-1', title: 'should login', file: 'login.spec.ts', status: 'passed', durationMs: 1200 },
    ]));
    await expect(defaultApiClient.getTests()).resolves.toEqual([
      { id: 't-1', title: 'should login', file: 'login.spec.ts', status: 'passed', durationMs: 1200 },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/dashboard/tests');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 503 }));
    await expect(defaultApiClient.getTests()).rejects.toThrow('Failed to fetch tests');
  });

  it('covers getConnectors success and failure', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse([
      {
        id: 'conn-1',
        name: 'GitHub',
        type: 'github',
        status: 'configured',
        createdAt: '2026-05-06T00:00:00.000Z',
        description: null,
      },
    ]));
    await expect(defaultApiClient.getConnectors()).resolves.toEqual([
      { name: 'GitHub', displayName: 'GitHub', type: 'github', status: 'active', lastSynced: null },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/connectors');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 500 }));
    await expect(defaultApiClient.getConnectors()).rejects.toThrow('Failed to fetch connectors');
  });

  it('covers getVaultSecrets success and failure', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse([
      { id: 'v-1', connectorId: 'github', key: 'GITHUB_TOKEN', createdAt: '2026-05-06T00:00:00.000Z' },
    ]));
    await expect(defaultApiClient.getVaultSecrets()).resolves.toEqual([
      { id: 'v-1', name: 'GITHUB_TOKEN', connector: 'github', updatedAt: '2026-05-06T00:00:00.000Z' },
    ]);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/vault/credentials');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'down' }, { status: 500 }));
    await expect(defaultApiClient.getVaultSecrets()).rejects.toThrow('Failed to fetch vault secrets');
  });

  it('covers deleteVaultSecret success and failure', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(defaultApiClient.deleteVaultSecret('v-1')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/vault/credentials/v-1', { method: 'DELETE' });

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, { status: 404 }));
    await expect(defaultApiClient.deleteVaultSecret('missing')).rejects.toThrow('Failed to delete vault secret');
  });

  it('covers getA11yAudit success and failure', async () => {
    const fetchMock = vi.mocked(globalThis.fetch);

    fetchMock.mockResolvedValueOnce(jsonResponse({
      violations: [
        {
          id: 'axe-1',
          ruleId: 'color-contrast',
          description: 'Elements must have sufficient color contrast',
          severity: 'serious',
          element: '<button>Submit</button>',
          fix: 'Increase contrast ratio to at least 4.5:1',
          page: '/login',
        },
      ],
      pagesScanned: 3,
      scannedAt: '2026-05-06T00:00:00.000Z',
    }));
    const result = await defaultApiClient.getA11yAudit();
    expect(result.pagesScanned).toBe(3);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.ruleId).toBe('color-contrast');
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/a11y/audit');

    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'audit failed' }, { status: 500 }));
    await expect(defaultApiClient.getA11yAudit()).rejects.toThrow('Failed to fetch a11y audit');
  });
});
