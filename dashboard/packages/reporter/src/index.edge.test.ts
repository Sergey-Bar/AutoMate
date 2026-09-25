/**
 * index.edge.test.ts — Edge case and supplementary tests for WsReporter
 *
 * Companion to index.test.ts (T8). Does NOT duplicate any test that already
 * exists there. Focuses on:
 *  - Retry exhaustion (retryCount reaches 3 → no further setTimeout)
 *  - `ended = true` already tested in T8; here we test retryCount boundary (exactly 3)
 *  - onStdErr with Buffer input (T8 only tests string for stderr)
 *  - onStepBegin / onStepEnd full payload verification (stepId, location)
 *  - send() queuing when ws becomes not-open mid-run (disconnect while sending)
 *  - ws:// URL with no port → default port 80
 *  - Constructor runId verified via actual emitted payload
 *  - DASHBOARD_RUN_ID env runId verified via actual emitted payload
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  Suite,
  TestCase,
  TestResult,
  TestStep,
  FullConfig,
  FullResult,
} from '@playwright/test/reporter';

// ──────────────────────────────────────────────
// Hoist mocks (same pattern as T8)
// ──────────────────────────────────────────────
const { mockWsCalls, mockSend, mockClose, mockOn, mockOnce, mockWsInstance } =
  vi.hoisted(() => {
    const mockWsCalls: string[] = [];
    const mockSend = vi.fn();
    const mockClose = vi.fn();
    const mockOn = vi.fn();
    const mockOnce = vi.fn();

    const mockWsInstance = {
      send: mockSend,
      close: mockClose,
      readyState: 1 as number,
      on: mockOn,
      once: mockOnce,
    };

    return { mockWsCalls, mockSend, mockClose, mockOn, mockOnce, mockWsInstance };
  });

// simulateWsEvent mirrors T8's approach: scan mock.calls arrays (cleared each test)
function simulateWsEvent(event: string, ...args: unknown[]) {
  const onCalls = (mockOn.mock.calls as [string, (...a: unknown[]) => void][]).filter(
    (c) => c[0] === event,
  );
  const onceCalls = (mockOnce.mock.calls as [string, (...a: unknown[]) => void][]).filter(
    (c) => c[0] === event,
  );
  for (const call of [...onceCalls, ...onCalls]) {
    call[1](...args);
  }
}

// Must use a regular function (NOT arrow) so `new WebSocket(url)` works as a constructor.
// The OPEN static is set on the function to match WebSocket.OPEN used in send().
vi.mock('ws', () => {
  const mod = {
    WebSocket: function MockWebSocket(url: string) {
      mockWsCalls.push(url);
      return mockWsInstance;
    },
  };
  (mod.WebSocket as unknown as { OPEN: number }).OPEN = 1;
  return mod;
});

import { WsReporter } from './index.js';

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function makeConfig(overrides: Partial<FullConfig> = {}): FullConfig {
  return {
    workers: 4,
    projects: [
      {
        name: 'chromium',
        retries: 2,
        timeout: 30000,
        testDir: 'tests/',
      } as FullConfig['projects'][0],
    ],
    ...overrides,
  } as unknown as FullConfig;
}

function makeSuite(totalTests = 3): Suite {
  return {
    allTests: () =>
      Array.from({ length: totalTests }, (_, i) => ({ id: `test-${i}` })) as TestCase[],
  } as unknown as Suite;
}

function makeTestCase(overrides: Partial<TestCase> = {}): TestCase {
  return {
    id: 'test-abc',
    title: 'my test',
    titlePath: () => ['suite', 'my test'],
    location: { file: 'tests/my.test.ts', line: 10, column: 1 },
    tags: [],
    annotations: [],
    ...overrides,
  } as unknown as TestCase;
}

function makeTestResult(overrides: Partial<TestResult> = {}): TestResult {
  return {
    status: 'passed',
    duration: 123,
    retry: 0,
    workerIndex: 0,
    parallelIndex: 0,
    errors: [],
    attachments: [],
    stdout: [],
    stderr: [],
    steps: [],
    ...overrides,
  } as unknown as TestResult;
}

function makeStep(overrides: Partial<TestStep> = {}): TestStep {
  return {
    title: 'click button',
    category: 'action',
    duration: 50,
    startTime: new Date('2024-06-01T12:00:00Z'),
    titlePath: () => ['suite', 'my test', 'click button'],
    location: { file: 'tests/my.test.ts', line: 42, column: 7 },
    error: undefined,
    steps: [],
    ...overrides,
  } as unknown as TestStep;
}

// ──────────────────────────────────────────────
// Reset state before each test
// ──────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  mockWsInstance.readyState = 1;
  mockWsCalls.length = 0;
  delete process.env.AUTOMATE_DASHBOARD_URL;
  delete process.env.DASHBOARD_RUN_ID;
});

afterEach(() => {
  delete process.env.AUTOMATE_DASHBOARD_URL;
  delete process.env.DASHBOARD_RUN_ID;
});

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────

describe('WsReporter — edge cases', () => {
  // ──────────────────────────────────────────
  // Retry exhaustion
  // ──────────────────────────────────────────
  describe('retry exhaustion', () => {
    it('schedules exactly 3 reconnect attempts before stopping', () => {
      // Use fake timers so setTimeout is intercepted but NOT run (no cascading reconnects)
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

      const reporter = new WsReporter({ runId: 'retry-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open'); // connected, retryCount=0

      // Close 1 → retryCount becomes 1, setTimeout scheduled (delay=1000)
      simulateWsEvent('close');
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
      expect(setTimeoutSpy.mock.calls[0]![1]).toBe(1000);

      // Close 2 → retryCount becomes 2, setTimeout scheduled (delay=2000)
      simulateWsEvent('close');
      expect(setTimeoutSpy).toHaveBeenCalledTimes(2);
      expect(setTimeoutSpy.mock.calls[1]![1]).toBe(2000);

      // Close 3 → retryCount becomes 3, setTimeout scheduled (delay=3000)
      simulateWsEvent('close');
      expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
      expect(setTimeoutSpy.mock.calls[2]![1]).toBe(3000);

      // Close 4 → retryCount is already 3, condition `retryCount < 3` is FALSE
      // No new setTimeout should be scheduled
      simulateWsEvent('close');
      expect(setTimeoutSpy).toHaveBeenCalledTimes(3); // still only 3

      vi.useRealTimers();
      warnSpy.mockRestore();
    });

    it('logs reconnect warning with attempt number on close', () => {
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const reporter = new WsReporter({ runId: 'retry-warn-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      simulateWsEvent('close');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('attempt 1/3'),
      );

      vi.useRealTimers();
      warnSpy.mockRestore();
    });
  });

  // ──────────────────────────────────────────
  // ended=true prevents reconnect even at retryCount=0
  // ──────────────────────────────────────────
  describe('ended flag prevents reconnect', () => {
    it('does not schedule reconnect when ended=true, even if retryCount is 0', async () => {
      vi.useFakeTimers();

      const reporter = new WsReporter({ runId: 'ended-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      // End the run — sets ended=true; onEnd uses setTimeout(resolve, 500) internally
      const endPromise = reporter.onEnd({ status: 'passed', duration: 100 } as FullResult);
      vi.runAllTimers();
      await endPromise;

      // After ended=true, a close event should NOT log a reconnect warning
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      simulateWsEvent('close');
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Connection lost'));
      warnSpy.mockRestore();

      vi.useRealTimers();
    });
  });

  // ──────────────────────────────────────────
  // Disconnect while sending (queue behavior)
  // ──────────────────────────────────────────
  describe('disconnect while sending', () => {
    it('queues events when readyState becomes non-OPEN after connection established', () => {
      const reporter = new WsReporter({ runId: 'disconnect-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open'); // now connected

      vi.clearAllMocks();

      // Simulate disconnect: readyState changes to CLOSED (3)
      mockWsInstance.readyState = 3;

      // Sending events now should queue them (ws exists but readyState !== OPEN)
      reporter.onStdOut('queued-output');

      // mockSend should NOT have been called (event was queued)
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('queues events when ws is not connected (before open event)', () => {
      mockWsInstance.readyState = 3; // Not open
      const reporter = new WsReporter({ runId: 'pre-connect-run' });
      reporter.onBegin(makeConfig(), makeSuite());

      // No open event fired yet — all events should be in the queue
      reporter.onStdErr('queued error');
      expect(mockSend).not.toHaveBeenCalled();

      // Now simulate open — should flush the queue
      mockWsInstance.readyState = 1;
      simulateWsEvent('open');

      // Both run:start and the stderr event should now be sent
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // ──────────────────────────────────────────
  // URL parsing edge cases
  // ──────────────────────────────────────────
  describe('URL parsing edge cases', () => {
    it('uses default port 80 for ws:// URL with no explicit port', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'ws://my-host-no-port';
      const reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('ws://my-host-no-port:80/reporter?protocolVersion=1');
    });

    it('uses default port 443 for wss:// URL with no explicit port (re-confirm)', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'wss://secure-no-port.example.com';
      const reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('wss://secure-no-port.example.com:443/reporter?protocolVersion=1');
    });

    it('uses default port 80 for http:// URL with no explicit port', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'http://plain-host';
      const reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('ws://plain-host:80/reporter?protocolVersion=1');
    });
  });

  // ──────────────────────────────────────────
  // onStdErr with Buffer input
  // ──────────────────────────────────────────
  describe('onStdErr with Buffer input', () => {
    it('converts Buffer to string for stderr event', () => {
      const reporter = new WsReporter({ runId: 'buf-stderr-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const buf = Buffer.from('buffer stderr content');
      reporter.onStdErr(buf);

      expect(mockSend).toHaveBeenCalledOnce();
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: { chunk: string; testId?: string };
      };
      expect(event.type).toBe('stderr');
      expect(event.payload.chunk).toBe('buffer stderr content');
      expect(event.payload.testId).toBeUndefined();
    });

    it('converts Buffer to string for stderr event with associated test', () => {
      const reporter = new WsReporter({ runId: 'buf-stderr-test-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const buf = Buffer.from('buffer with test');
      const test = makeTestCase({ id: 'test-buf-err' });
      reporter.onStdErr(buf, test);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { chunk: string; testId: string };
      };
      expect(event.payload.chunk).toBe('buffer with test');
      expect(event.payload.testId).toBe('test-buf-err');
    });
  });

  // ──────────────────────────────────────────
  // onStepBegin — full payload verification
  // ──────────────────────────────────────────
  describe('onStepBegin — full payload', () => {
    it('emits stepId as titlePath joined by " > "', () => {
      const reporter = new WsReporter({ runId: 'stepbegin-edge-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const test = makeTestCase({ id: 'test-step-id' });
      const result = makeTestResult();
      const step = makeStep({
        titlePath: () => ['root suite', 'nested suite', 'step title'],
        title: 'step title',
        category: 'expect',
        startTime: new Date('2025-03-15T09:30:00Z'),
        location: { file: 'e2e/login.spec.ts', line: 55, column: 3 },
      });

      reporter.onStepBegin(test, result, step);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: {
          testId: string;
          stepId: string;
          title: string;
          category: string;
          location: { file: string; line: number; column: number };
          startTime: string;
        };
      };

      expect(event.type).toBe('step:begin');
      expect(event.payload.testId).toBe('test-step-id');
      expect(event.payload.stepId).toBe('root suite > nested suite > step title');
      expect(event.payload.title).toBe('step title');
      expect(event.payload.category).toBe('expect');
      expect(event.payload.location).toEqual({ file: 'e2e/login.spec.ts', line: 55, column: 3 });
      expect(event.payload.startTime).toBe('2025-03-15T09:30:00.000Z');
    });
  });

  // ──────────────────────────────────────────
  // onStepEnd — full payload verification
  // ──────────────────────────────────────────
  describe('onStepEnd — full payload', () => {
    it('emits stepId as titlePath joined by " > "', () => {
      const reporter = new WsReporter({ runId: 'stepend-edge-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const test = makeTestCase({ id: 'test-stepend-id' });
      const result = makeTestResult();
      const step = makeStep({
        titlePath: () => ['parent', 'child step'],
        title: 'child step',
        duration: 123,
        error: undefined,
      });

      reporter.onStepEnd(test, result, step);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: {
          testId: string;
          stepId: string;
          durationMs: number;
          error?: unknown;
        };
      };

      expect(event.type).toBe('step:end');
      expect(event.payload.testId).toBe('test-stepend-id');
      expect(event.payload.stepId).toBe('parent > child step');
      expect(event.payload.durationMs).toBe(123);
      expect(event.payload.error).toBeUndefined();
    });

    it('omits error field in step:end when step succeeded', () => {
      const reporter = new WsReporter({ runId: 'stepend-ok-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const test = makeTestCase({ id: 'test-ok-step' });
      const result = makeTestResult();
      const step = makeStep({ duration: 10, error: undefined });

      reporter.onStepEnd(test, result, step);

      const raw = JSON.parse(mockSend.mock.calls[0]![0] as string) as Record<string, unknown>;
      const payload = raw['payload'] as Record<string, unknown>;
      // error key should not be present when undefined
      expect('error' in payload).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // Constructor runId — verified via payload
  // ──────────────────────────────────────────
  describe('constructor runId verified in payload', () => {
    it('uses options.runId in emitted event runId field', () => {
      const reporter = new WsReporter({ runId: 'explicit-run-xyz' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      const call = mockSend.mock.calls[0]!;
      const event = JSON.parse(call[0] as string) as { runId: string };
      expect(event.runId).toBe('explicit-run-xyz');
    });

    it('uses DASHBOARD_RUN_ID env in emitted event runId field', () => {
      process.env.DASHBOARD_RUN_ID = 'env-run-id-abc';
      const reporter = new WsReporter({}); // no runId option
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      const call = mockSend.mock.calls[0]!;
      const event = JSON.parse(call[0] as string) as { runId: string };
      expect(event.runId).toBe('env-run-id-abc');
    });

    it('generates a UUID when neither option nor env is set', () => {
      delete process.env.DASHBOARD_RUN_ID;
      const reporter = new WsReporter({}); // no runId, no env
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      const call = mockSend.mock.calls[0]!;
      const event = JSON.parse(call[0] as string) as { runId: string };
      // UUID v4 pattern
      expect(event.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  // ──────────────────────────────────────────
  // onBegin with empty projects → defaults
  // ──────────────────────────────────────────
  describe('onBegin with undefined first project', () => {
    it('uses fallback defaults when projects array has no elements (double-check)', () => {
      const reporter = new WsReporter({ runId: 'no-proj-run' });
      const config: FullConfig = {
        workers: 1,
        projects: [],
      } as unknown as FullConfig;
      reporter.onBegin(config, makeSuite(0));
      simulateWsEvent('open');

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: {
          config: { retries: number; timeout: number; testDir: string };
          total: number;
        };
      };
      expect(event.payload.config.retries).toBe(0);
      expect(event.payload.config.timeout).toBe(30000);
      expect(event.payload.config.testDir).toBe('.');
      expect(event.payload.total).toBe(0);
    });
  });

  // ──────────────────────────────────────────
  // send() — no ws instance (null) queues event
  // ──────────────────────────────────────────
  describe('send() when ws is null', () => {
    it('queues event without crashing when ws is null (before connect)', () => {
      // Reporter is created but onBegin not called (ws never created)
      const reporter = new WsReporter({ runId: 'null-ws-run' });

      // Directly call onStdOut which calls emit→send
      // ws is null at this point, so the event should be queued
      expect(() => reporter.onStdOut('hello before connect')).not.toThrow();
      expect(mockSend).not.toHaveBeenCalled();
    });
  });
});
