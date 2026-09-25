/// <reference types="vitest" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

type SentEvent = {
  type: string;
  runId: string;
  payload: Record<string, unknown>;
};

type MockSocket = {
  url: string;
  readyState: number;
  once: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  openHandler?: () => void;
  errorHandler?: (error: Error) => void;
};

const wsState = vi.hoisted(() => {
  const sockets: MockSocket[] = [];

  const constructor = vi.fn(function mockWebSocket(url: string) {
    const socket: MockSocket = {
      url,
      readyState: 1,
      once: vi.fn(),
      on: vi.fn(),
      send: vi.fn(),
      close: vi.fn(),
      openHandler: undefined,
      errorHandler: undefined,
    };

    socket.once.mockImplementation((event: string, handler: () => void) => {
      if (event === 'open') {
        socket.openHandler = handler;
      }
      return socket;
    });

    socket.on.mockImplementation((event: string, handler: (error: Error) => void) => {
      if (event === 'error') {
        socket.errorHandler = handler;
      }
      return socket;
    });

    sockets.push(socket);
    return socket;
  });

  const reset = () => {
    sockets.length = 0;
    constructor.mockClear();
  };

  return {
    sockets,
    constructor,
    reset,
  };
});

vi.mock('ws', () => ({
  WebSocket: Object.assign(wsState.constructor, { OPEN: 1 }),
}));

const originalEnv = process.env;

async function loadReporterModule() {
  vi.resetModules();
  return import('./ws-reporter.js');
}

function parseSentEvent(socket: MockSocket, callIndex = 0): SentEvent {
  const serialized = socket.send.mock.calls[callIndex]?.[0];
  return JSON.parse(String(serialized)) as SentEvent;
}

function createMockConfig(): FullConfig {
  return {
    projects: [
      { name: 'chromium', retries: 2, timeout: 30_000, testDir: './tests' },
      { name: 'firefox', retries: 1, timeout: 60_000, testDir: './tests' },
    ],
    workers: 4,
  } as unknown as FullConfig;
}

function createMockSuite(total = 3): Suite {
  return {
    allTests: () => Array.from({ length: total }, (_, index) => ({ id: `${index + 1}` })),
  } as unknown as Suite;
}

function createMockTest(): TestCase {
  return {
    id: 'test-1',
    title: 'should work',
    titlePath: () => ['Root', 'Suite', 'should work'],
    location: { file: 'tests/sample.spec.ts', line: 10, column: 5 },
    tags: ['@smoke'],
    annotations: [{ type: 'slow', description: 'long setup' }],
  } as unknown as TestCase;
}

function createMockResult(): TestResult {
  return {
    status: 'passed',
    duration: 1234,
    retry: 0,
    workerIndex: 0,
    parallelIndex: 0,
    errors: [],
    attachments: [],
    stdout: ['ok'],
    stderr: [],
    steps: [],
  } as unknown as TestResult;
}

function createMockStep(overrides: Partial<TestStep> = {}): TestStep {
  return {
    title: 'click button',
    category: 'pw:api',
    location: { file: 'tests/sample.spec.ts', line: 15, column: 3 },
    startTime: new Date('2026-01-01T00:00:00Z'),
    duration: 100,
    error: undefined,
    titlePath: () => ['Root', 'Suite', 'should work', 'click button'],
    steps: [],
    ...overrides,
  } as unknown as TestStep;
}

describe('WsReporter comprehensive', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    wsState.reset();
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => 'test-run-id-12345'),
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('uses provided runId option over environment and crypto', async () => {
    process.env.DASHBOARD_RUN_ID = 'env-run-id';
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter({ runId: 'explicit-run-id' });

    reporter.onBegin(createMockConfig(), createMockSuite());
    wsState.sockets[0].openHandler?.();

    const event = parseSentEvent(wsState.sockets[0]);
    expect(event.runId).toBe('explicit-run-id');
  });

  it('uses DASHBOARD_RUN_ID when runId option is not provided', async () => {
    process.env.DASHBOARD_RUN_ID = 'env-run-id';
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();

    reporter.onBegin(createMockConfig(), createMockSuite());
    wsState.sockets[0].openHandler?.();

    const event = parseSentEvent(wsState.sockets[0]);
    expect(event.runId).toBe('env-run-id');
  });

  it('uses crypto.randomUUID when neither runId option nor env is set', async () => {
    delete process.env.DASHBOARD_RUN_ID;
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();

    reporter.onBegin(createMockConfig(), createMockSuite());
    wsState.sockets[0].openHandler?.();

    const event = parseSentEvent(wsState.sockets[0]);
    expect(event.runId).toBe('test-run-id-12345');
  });

  it('builds websocket URL from AUTOMATE_DASHBOARD_URL using wss for https', async () => {
    process.env.AUTOMATE_DASHBOARD_URL = 'https://mission.example.com';
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter({ port: 9999, host: 'ignored-host' });

    reporter.onBegin(createMockConfig(), createMockSuite());

    expect(wsState.constructor).toHaveBeenCalledWith('wss://mission.example.com:443/reporter?protocolVersion=1');
  });

  it('builds websocket URL from provided host and port when no automate env URL', async () => {
    delete process.env.AUTOMATE_DASHBOARD_URL;
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter({ host: '127.0.0.1', port: 4321 });

    reporter.onBegin(createMockConfig(), createMockSuite());

    expect(wsState.constructor).toHaveBeenCalledWith('ws://127.0.0.1:4321/reporter?protocolVersion=1');
  });

  it('defaults websocket URL to ws://localhost:4001/reporter', async () => {
    delete process.env.AUTOMATE_DASHBOARD_URL;
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();

    reporter.onBegin(createMockConfig(), createMockSuite());

    expect(wsState.constructor).toHaveBeenCalledWith('ws://localhost:4001/reporter?protocolVersion=1');
  });

  it('queues events before open and flushes in order on socket open', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter({ runId: 'queue-run' });

    reporter.onStdOut('early-chunk');
    reporter.onBegin(createMockConfig(), createMockSuite());

    const socket = wsState.sockets[0];
    expect(socket.send).toHaveBeenCalledTimes(0);

    socket.openHandler?.();

    expect(socket.send).toHaveBeenCalledTimes(2);
    const first = parseSentEvent(socket, 0);
    const second = parseSentEvent(socket, 1);
    expect(first.type).toBe('stdout');
    expect(first.payload).toEqual({ testId: undefined, chunk: 'early-chunk' });
    expect(second.type).toBe('run:start');
  });

  it('sends directly once connected', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();
    reporter.onBegin(createMockConfig(), createMockSuite());

    const socket = wsState.sockets[0];
    socket.openHandler?.();
    const sendsAfterBegin = socket.send.mock.calls.length;

    reporter.onStdErr('late-error');

    expect(socket.send.mock.calls.length).toBe(sendsAfterBegin + 1);
    const event = parseSentEvent(socket, sendsAfterBegin);
    expect(event.type).toBe('stderr');
    expect(event.payload).toEqual({ testId: undefined, chunk: 'late-error' });
  });

  it('onBegin emits run:start with project/config/pr/branch/commit fields', async () => {
    process.env.GITHUB_REF = 'refs/pull/42/merge';
    process.env.GITHUB_HEAD_REF = 'feature/stream-events';
    process.env.GITHUB_BASE_REF = 'main';
    process.env.GITHUB_ACTOR = 'octocat';
    process.env.GITHUB_SHA = 'abc123sha';

    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter({ runId: 'begin-run' });

    reporter.onBegin(createMockConfig(), createMockSuite(5));
    wsState.sockets[0].openHandler?.();

    const event = parseSentEvent(wsState.sockets[0]);
    expect(event.type).toBe('run:start');
    expect(event.payload).toEqual({
      total: 5,
      projects: ['chromium', 'firefox'],
      config: {
        workers: 4,
        retries: 2,
        timeout: 30_000,
        testDir: './tests',
      },
      pr: {
        prNumber: 42,
        prBranch: 'feature/stream-events',
        baseBranch: 'main',
        commitAuthor: 'octocat',
      },
      branch: 'feature/stream-events',
      commitSha: 'abc123sha',
    });
  });

  it('onTestBegin emits test:begin with detailed test and result metadata', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();
    const test = createMockTest();
    const result = createMockResult();

    reporter.onBegin(createMockConfig(), createMockSuite());
    const socket = wsState.sockets[0];
    socket.openHandler?.();

    reporter.onTestBegin(test, result);

    const event = parseSentEvent(socket, 1);
    expect(event.type).toBe('test:begin');
    expect(event.payload).toEqual({
      testId: 'test-1',
      title: 'should work',
      titlePath: ['Root', 'Suite', 'should work'],
      file: 'tests/sample.spec.ts',
      line: 10,
      column: 5,
      workerIndex: 0,
      parallelIndex: 0,
      retry: 0,
      tags: ['@smoke'],
      annotations: [{ type: 'slow', description: 'long setup' }],
    });
  });

  it('onStepBegin and onStepEnd emit expected payloads including step errors', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();
    const test = createMockTest();
    const result = createMockResult();
    const step = createMockStep();
    const erroredStep = createMockStep({
      title: 'expect text',
      duration: 250,
      error: new Error('locator not found'),
      titlePath: () => ['Root', 'Suite', 'should work', 'expect text'],
    });

    reporter.onBegin(createMockConfig(), createMockSuite());
    const socket = wsState.sockets[0];
    socket.openHandler?.();

    reporter.onStepBegin(test, result, step);
    reporter.onStepEnd(test, result, erroredStep);

    const beginEvent = parseSentEvent(socket, 1);
    const endEvent = parseSentEvent(socket, 2);

    expect(beginEvent.type).toBe('step:begin');
    expect(beginEvent.payload).toEqual({
      testId: 'test-1',
      stepId: 'Root > Suite > should work > click button',
      title: 'click button',
      category: 'pw:api',
      location: { file: 'tests/sample.spec.ts', line: 15, column: 3 },
      startTime: '2026-01-01T00:00:00.000Z',
    });

    expect(endEvent.type).toBe('step:end');
    expect(endEvent.payload).toEqual({
      testId: 'test-1',
      stepId: 'Root > Suite > should work > expect text',
      durationMs: 250,
      error: {
        message: 'locator not found',
        stack: expect.any(String),
      },
    });
  });

  it('onStdOut and onStdErr handle Buffer and string chunks with optional test ids', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();
    const test = createMockTest();

    reporter.onBegin(createMockConfig(), createMockSuite());
    const socket = wsState.sockets[0];
    socket.openHandler?.();

    reporter.onStdOut(Buffer.from('buffer-out'), test);
    reporter.onStdErr('plain-error');

    const stdoutEvent = parseSentEvent(socket, 1);
    const stderrEvent = parseSentEvent(socket, 2);

    expect(stdoutEvent.type).toBe('stdout');
    expect(stdoutEvent.payload).toEqual({ testId: 'test-1', chunk: 'buffer-out' });

    expect(stderrEvent.type).toBe('stderr');
    expect(stderrEvent.payload).toEqual({ testId: undefined, chunk: 'plain-error' });
  });

  it('onTestEnd emits full payload including error, attachments and recursive step serialization', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();
    const test = createMockTest();
    const childStep = createMockStep({
      title: 'inner assertion',
      category: 'expect',
      duration: 20,
      titlePath: () => ['Root', 'Suite', 'should work', 'click button', 'inner assertion'],
    });
    const parentStep = createMockStep({
      title: 'click button',
      duration: 110,
      error: new Error('step failed'),
      steps: [childStep],
    });
    const result = {
      ...createMockResult(),
      status: 'failed',
      duration: 2345,
      retry: 1,
      workerIndex: 2,
      parallelIndex: 1,
      errors: [new Error('test failed')],
      attachments: [
        { name: 'screenshot', contentType: 'image/png', path: '/tmp/shot.png' },
        { name: 'trace', contentType: 'application/zip', path: '/tmp/trace.zip' },
      ],
      stdout: ['stdout line'],
      stderr: ['stderr line'],
      steps: [parentStep],
    } as unknown as TestResult;

    reporter.onBegin(createMockConfig(), createMockSuite());
    const socket = wsState.sockets[0];
    socket.openHandler?.();

    reporter.onTestEnd(test, result);

    const event = parseSentEvent(socket, 1);
    expect(event.type).toBe('test:end');
    expect(event.payload).toEqual({
      testId: 'test-1',
      status: 'failed',
      durationMs: 2345,
      retry: 1,
      workerIndex: 2,
      parallelIndex: 1,
      tags: ['@smoke'],
      annotations: [{ type: 'slow', description: 'long setup' }],
      error: {
        message: 'test failed',
        stack: expect.any(String),
      },
      attachments: [
        {
          name: 'screenshot',
          contentType: 'image/png',
          path: '/tmp/shot.png',
          autoCapture: true,
        },
        {
          name: 'trace',
          contentType: 'application/zip',
          path: '/tmp/trace.zip',
          autoCapture: false,
        },
      ],
      stdout: ['stdout line'],
      stderr: ['stderr line'],
      steps: [
        {
          title: 'click button',
          category: 'pw:api',
          durationMs: 110,
          error: {
            message: 'step failed',
            stack: expect.any(String),
          },
          location: { file: 'tests/sample.spec.ts', line: 15, column: 3 },
          steps: [
            {
              title: 'inner assertion',
              category: 'expect',
              durationMs: 20,
              error: undefined,
              location: { file: 'tests/sample.spec.ts', line: 15, column: 3 },
              steps: [],
            },
          ],
        },
      ],
    });
  });

  it('onEnd emits run:end, waits 500ms, then closes socket', async () => {
    vi.useFakeTimers();
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();

    reporter.onBegin(createMockConfig(), createMockSuite());
    const socket = wsState.sockets[0];
    socket.openHandler?.();

    const endPromise = reporter.onEnd({ status: 'passed', duration: 9876 } as FullResult);

    const runEndEvent = parseSentEvent(socket, 1);
    expect(runEndEvent.type).toBe('run:end');
    expect(runEndEvent.payload).toEqual({ status: 'passed', durationMs: 9876 });
    expect(socket.close).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(499);
    expect(socket.close).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(1);
    await endPromise;
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it('printsToStdio returns false', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();

    expect(reporter.printsToStdio()).toBe(false);
  });

  it('warns when websocket emits error and does not throw', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();

    reporter.onBegin(createMockConfig(), createMockSuite());
    const socket = wsState.sockets[0];
    socket.errorHandler?.(new Error('boom'));

    expect(warnSpy).toHaveBeenCalledWith('[ws-reporter] WebSocket error: boom');
  });

  it('does not call ws.send when socket state is not OPEN', async () => {
    const { default: WsReporter } = await loadReporterModule();
    const reporter = new WsReporter();

    reporter.onBegin(createMockConfig(), createMockSuite());
    const socket = wsState.sockets[0];
    socket.openHandler?.();
    const sendsAfterOpen = socket.send.mock.calls.length;

    socket.readyState = 0;
    reporter.onStdOut('should-not-send');

    expect(socket.send.mock.calls.length).toBe(sendsAfterOpen);
  });

  // ── Protocol versioning ──────────────────────────────────────────────────
  describe('protocol versioning', () => {
    it('appends protocolVersion=1 to WebSocket URL when no token is set', async () => {
      delete process.env.AUTOMATE_DASHBOARD_URL;
      delete process.env.REPORTER_SECRET;
      const { default: WsReporter } = await loadReporterModule();
      const reporter = new WsReporter();

      reporter.onBegin(createMockConfig(), createMockSuite());

      const url = wsState.sockets[0]?.url ?? '';
      expect(new URL(url).searchParams.get('protocolVersion')).toBe('1');
    });

    it('appends protocolVersion=1 after token when REPORTER_SECRET is set', async () => {
      delete process.env.AUTOMATE_DASHBOARD_URL;
      process.env.REPORTER_SECRET = 'my-secret';
      const { default: WsReporter } = await loadReporterModule();
      const reporter = new WsReporter();

      reporter.onBegin(createMockConfig(), createMockSuite());

      const url = wsState.sockets[0]?.url ?? '';
      const parsed = new URL(url);
      expect(parsed.searchParams.get('token')).toBe('my-secret');
      expect(parsed.searchParams.get('protocolVersion')).toBe('1');
    });

    it('appends protocolVersion=1 when AUTOMATE_DASHBOARD_URL is set', async () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'http://my-dashboard.example.com:4001';
      delete process.env.REPORTER_SECRET;
      const { default: WsReporter } = await loadReporterModule();
      const reporter = new WsReporter();

      reporter.onBegin(createMockConfig(), createMockSuite());

      const url = wsState.sockets[0]?.url ?? '';
      expect(new URL(url).searchParams.get('protocolVersion')).toBe('1');
    });
  });
});
