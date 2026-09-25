import { describe, expect, it, vi, beforeEach } from 'vitest';
import { defaultApiClient } from './api.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const run = {
  id: 'run-1',
  status: 'passed',
  startedAt: '2026-09-25T00:00:00.000Z',
  total: 1,
  passed: 1,
  failed: 0,
};
const analytics = { totalRuns: 1, passRate: 1, avgDurationMs: 10 };
const quarantine = {
  id: 'q-1',
  testTitle: 'flaky',
  testFile: 'tests/example.spec.ts',
  reason: null,
  quarantinedAt: '2026-09-25T00:00:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn());
});

describe('web API client', () => {
  it('fetches and parses runs', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse([run]))
      .mockResolvedValueOnce(jsonResponse(run));
    await expect(defaultApiClient.getRuns()).resolves.toEqual([run]);
    await expect(defaultApiClient.getRun('run-1')).resolves.toEqual(run);
  });

  it('fetches analytics and quarantine data', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse(analytics))
      .mockResolvedValueOnce(jsonResponse([quarantine]))
      .mockResolvedValueOnce(jsonResponse(quarantine, 201));
    await expect(defaultApiClient.getAnalyticsSummary()).resolves.toEqual(analytics);
    await expect(defaultApiClient.getQuarantine()).resolves.toEqual([quarantine]);
    await expect(
      defaultApiClient.addQuarantine({ testTitle: 'flaky', testFile: 'tests/example.spec.ts' }),
    ).resolves.toEqual(quarantine);
  });

  it('unwraps canonical realtime envelopes and ignores invalid events', () => {
    const listeners = new Map<string, (event: MessageEvent) => void>();
    const close = vi.fn();
    class FakeEventSource {
      addEventListener(name: string, listener: (event: MessageEvent) => void) {
        listeners.set(name, listener);
      }
      removeEventListener(name: string) {
        listeners.delete(name);
      }
      close = close;
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const received: unknown[] = [];
    const stop = defaultApiClient.onRunUpdated((event) => received.push(event));
    listeners.get('message')?.({
      data: JSON.stringify({
        contractVersion: '2',
        cursor: '1',
        eventType: 'run.updated',
        occurredAt: '2026-09-25T00:00:00.000Z',
        data: {
          type: 'run:updated',
          version: '1',
          runId: 'run-1',
          status: 'passed',
          timestamp: '2026-09-25T00:00:00.000Z',
        },
      }),
    } as MessageEvent);
    listeners.get('message')?.({ data: 'not-json' } as MessageEvent);
    expect(received).toHaveLength(1);
    stop();
    expect(close).toHaveBeenCalled();
  });
});
