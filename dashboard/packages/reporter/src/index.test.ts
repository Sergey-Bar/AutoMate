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
// Hoist mocks so vi.mock factory can reference them
// ──────────────────────────────────────────────
const { mockSend, mockClose, mockOn, mockOnce, mockWsInstance, mockWsCalls, MockWebSocket } = vi.hoisted(() => {
  const mockSend = vi.fn();
  const mockClose = vi.fn();
  const mockOn = vi.fn();
  const mockOnce = vi.fn();
  const mockWsCalls: string[] = [];

  const mockWsInstance = {
    send: mockSend,
    close: mockClose,
    readyState: 1 as number, // WebSocket.OPEN
    on: mockOn,
    once: mockOnce,
  };

  // Must be a real constructor so `new WebSocket(url)` works
  function MockWebSocket(url: string) {
    mockWsCalls.push(url);
    return mockWsInstance;
  }
  MockWebSocket.OPEN = 1;

  return { mockSend, mockClose, mockOn, mockOnce, mockWsInstance, mockWsCalls, MockWebSocket };
});

vi.mock('ws', () => ({
  WebSocket: MockWebSocket,
}));

// ──────────────────────────────────────────────
// Import after mocking
// ──────────────────────────────────────────────
import { extractPRMetadata, WsReporter } from './index.js';

// ──────────────────────────────────────────────
// Helpers to simulate WS events
// ──────────────────────────────────────────────
function simulateWsEvent(event: string, ...args: unknown[]) {
  // Find the handler registered via mockOn or mockOnce
  const onCalls = mockOn.mock.calls.filter((c) => c[0] === event);
  const onceCalls = mockOnce.mock.calls.filter((c) => c[0] === event);
  const allCalls = [...onceCalls, ...onCalls];
  for (const call of allCalls) {
    (call[1] as (...a: unknown[]) => void)(...args);
  }
}

// ──────────────────────────────────────────────
// Shared mock shapes
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
    tags: ['@smoke'],
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
    startTime: new Date('2024-01-01T00:00:00Z'),
    titlePath: () => ['suite', 'click button'],
    location: { file: 'tests/my.test.ts', line: 20, column: 5 },
    error: undefined,
    steps: [],
    ...overrides,
  } as unknown as TestStep;
}

// ──────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────
describe('extractPRMetadata', () => {
  beforeEach(() => {
    // Clear all PR-related env vars
    delete process.env.GITHUB_REF;
    delete process.env.PR_NUMBER;
    delete process.env.CI_MERGE_REQUEST_IID;
    delete process.env.GITHUB_HEAD_REF;
    delete process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME;
    delete process.env.GITHUB_BASE_REF;
    delete process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME;
    delete process.env.GITHUB_ACTOR;
    delete process.env.GITLAB_USER_NAME;
  });

  it('returns all undefined when no env vars are set', () => {
    const result = extractPRMetadata();
    expect(result).toEqual({
      prNumber: undefined,
      prBranch: undefined,
      baseBranch: undefined,
      commitAuthor: undefined,
    });
  });

  it('extracts prNumber from PR_NUMBER env var', () => {
    process.env.PR_NUMBER = '42';
    const result = extractPRMetadata();
    expect(result.prNumber).toBe(42);
  });

  it('extracts prNumber from CI_MERGE_REQUEST_IID', () => {
    process.env.CI_MERGE_REQUEST_IID = '99';
    const result = extractPRMetadata();
    expect(result.prNumber).toBe(99);
  });

  it('extracts prNumber from GITHUB_REF pattern', () => {
    process.env.GITHUB_REF = 'refs/pull/123/merge';
    const result = extractPRMetadata();
    expect(result.prNumber).toBe(123);
  });

  it('PR_NUMBER takes precedence over CI_MERGE_REQUEST_IID and GITHUB_REF', () => {
    process.env.PR_NUMBER = '7';
    process.env.CI_MERGE_REQUEST_IID = '50';
    process.env.GITHUB_REF = 'refs/pull/200/merge';
    const result = extractPRMetadata();
    expect(result.prNumber).toBe(7);
  });

  it('CI_MERGE_REQUEST_IID takes precedence over GITHUB_REF when PR_NUMBER absent', () => {
    process.env.CI_MERGE_REQUEST_IID = '50';
    process.env.GITHUB_REF = 'refs/pull/200/merge';
    const result = extractPRMetadata();
    expect(result.prNumber).toBe(50);
  });

  it('does not parse PR number from non-PR GITHUB_REF', () => {
    process.env.GITHUB_REF = 'refs/heads/main';
    const result = extractPRMetadata();
    expect(result.prNumber).toBeUndefined();
  });

  it('extracts prBranch from GITHUB_HEAD_REF', () => {
    process.env.GITHUB_HEAD_REF = 'feature/my-feature';
    const result = extractPRMetadata();
    expect(result.prBranch).toBe('feature/my-feature');
  });

  it('extracts prBranch from CI_MERGE_REQUEST_SOURCE_BRANCH_NAME as fallback', () => {
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME = 'gitlab-branch';
    const result = extractPRMetadata();
    expect(result.prBranch).toBe('gitlab-branch');
  });

  it('GITHUB_HEAD_REF takes precedence over CI_MERGE_REQUEST_SOURCE_BRANCH_NAME', () => {
    process.env.GITHUB_HEAD_REF = 'github-branch';
    process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME = 'gitlab-branch';
    const result = extractPRMetadata();
    expect(result.prBranch).toBe('github-branch');
  });

  it('extracts baseBranch from GITHUB_BASE_REF', () => {
    process.env.GITHUB_BASE_REF = 'main';
    const result = extractPRMetadata();
    expect(result.baseBranch).toBe('main');
  });

  it('extracts baseBranch from CI_MERGE_REQUEST_TARGET_BRANCH_NAME as fallback', () => {
    process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME = 'develop';
    const result = extractPRMetadata();
    expect(result.baseBranch).toBe('develop');
  });

  it('extracts commitAuthor from GITHUB_ACTOR', () => {
    process.env.GITHUB_ACTOR = 'octocat';
    const result = extractPRMetadata();
    expect(result.commitAuthor).toBe('octocat');
  });

  it('extracts commitAuthor from GITLAB_USER_NAME as fallback', () => {
    process.env.GITLAB_USER_NAME = 'gitlabuser';
    const result = extractPRMetadata();
    expect(result.commitAuthor).toBe('gitlabuser');
  });

  it('GITHUB_ACTOR takes precedence over GITLAB_USER_NAME', () => {
    process.env.GITHUB_ACTOR = 'gh-user';
    process.env.GITLAB_USER_NAME = 'gl-user';
    const result = extractPRMetadata();
    expect(result.commitAuthor).toBe('gh-user');
  });
});

// ──────────────────────────────────────────────
// WsReporter
// ──────────────────────────────────────────────
describe('WsReporter', () => {
  let reporter: WsReporter;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWsInstance.readyState = 1;
    mockWsCalls.length = 0;
    // Clear relevant env vars
    delete process.env.AUTOMATE_DASHBOARD_URL;
    delete process.env.DASHBOARD_RUN_ID;
    delete process.env.GITHUB_REF;
    delete process.env.PR_NUMBER;
    delete process.env.GITHUB_HEAD_REF;
    delete process.env.GITHUB_SHA;
    delete process.env.CI_COMMIT_SHA;
  });

  afterEach(() => {
    delete process.env.AUTOMATE_DASHBOARD_URL;
    delete process.env.DASHBOARD_RUN_ID;
  });

  // ────────────────────────────────
  // Constructor & runId
  // ────────────────────────────────
  describe('constructor', () => {
    it('uses provided runId option', () => {
      reporter = new WsReporter({ runId: 'my-run-id' });
      // Access via triggering an event
      simulateWsEvent('open');
      // Can only verify via send shape - we'll test that onBegin uses it
    });

    it('uses DASHBOARD_RUN_ID from env when no runId option', () => {
      process.env.DASHBOARD_RUN_ID = 'env-run-id';
      reporter = new WsReporter({});
      // The runId is used in emit → send, verified when we check send calls
    });

    it('creates a reporter with default options', () => {
      reporter = new WsReporter();
      expect(reporter).toBeInstanceOf(WsReporter);
    });
  });

  // ────────────────────────────────
  // connect() URL construction
  // ────────────────────────────────
  describe('connect() URL construction', () => {
    it('builds ws://host:port/reporter from options', () => {
      reporter = new WsReporter({ port: 4001, host: 'myhost' });
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('ws://myhost:4001/reporter?protocolVersion=1');
    });

    it('uses default host=localhost and port=4001', () => {
      reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('ws://localhost:4001/reporter?protocolVersion=1');
    });

    it('uses AUTOMATE_DASHBOARD_URL env var (http://)', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'http://dashboard.example.com:9000';
      reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('ws://dashboard.example.com:9000/reporter?protocolVersion=1');
    });

    it('uses AUTOMATE_DASHBOARD_URL env var (https://)', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'https://secure.example.com';
      reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('wss://secure.example.com:443/reporter?protocolVersion=1');
    });

    it('uses AUTOMATE_DASHBOARD_URL env var (ws://)', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'ws://ws-host:5000';
      reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('ws://ws-host:5000/reporter?protocolVersion=1');
    });

    it('uses AUTOMATE_DASHBOARD_URL env var (wss://)', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'wss://secure-ws.example.com:8443';
      reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('wss://secure-ws.example.com:8443/reporter?protocolVersion=1');
    });

    it('AUTOMATE_DASHBOARD_URL overrides options port/host', () => {
      process.env.AUTOMATE_DASHBOARD_URL = 'http://remote-host:7777';
      reporter = new WsReporter({ port: 1234, host: 'ignored-host' });
      reporter.onBegin(makeConfig(), makeSuite());
      expect(mockWsCalls).toContain('ws://remote-host:7777/reporter?protocolVersion=1');
    });
  });

  // ────────────────────────────────
  // send() behavior
  // ────────────────────────────────
  describe('send() behavior', () => {
    it('queues events when not connected (readyState !== OPEN)', () => {
      mockWsInstance.readyState = 3; // CLOSED
      reporter = new WsReporter({ runId: 'r1' });
      reporter.onBegin(makeConfig(), makeSuite());
      // Before open: ws is created but not connected yet — events queued
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('calls ws.send with JSON-serialized event when connected', () => {
      reporter = new WsReporter({ runId: 'r1' });
      reporter.onBegin(makeConfig(), makeSuite());

      // Simulate ws 'open' → connected = true, queue flushed
      simulateWsEvent('open');

      // Now send another event
      reporter.onStdOut('hello');
      expect(mockSend).toHaveBeenCalled();
      const lastCall = mockSend.mock.calls[mockSend.mock.calls.length - 1]![0] as string;
      const parsed = JSON.parse(lastCall) as { type: string; runId: string; payload: { chunk: string } };
      expect(parsed.type).toBe('stdout');
      expect(parsed.runId).toBe('r1');
      expect(parsed.payload.chunk).toBe('hello');
    });

    it('flushes queued events on open', () => {
      mockWsInstance.readyState = 3; // Not open initially
      reporter = new WsReporter({ runId: 'r2' });
      reporter.onBegin(makeConfig(), makeSuite());

      // Events were queued since not open
      expect(mockSend).not.toHaveBeenCalled();

      // Simulate open → should flush
      mockWsInstance.readyState = 1;
      simulateWsEvent('open');

      // run:start event was queued and now flushed
      expect(mockSend).toHaveBeenCalled();
    });

    it('serializes events as JSON strings', () => {
      reporter = new WsReporter({ runId: 'json-test' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      reporter.onStdErr('error output', makeTestCase());
      const calls = mockSend.mock.calls;
      const lastCallArg = calls[calls.length - 1]![0] as string;
      expect(() => JSON.parse(lastCallArg)).not.toThrow();
    });
  });

  // ────────────────────────────────
  // onBegin
  // ────────────────────────────────
  describe('onBegin', () => {
    it('calls connect() and emits run:start', () => {
      reporter = new WsReporter({ runId: 'begin-run' });
      reporter.onBegin(makeConfig(), makeSuite(5));
      simulateWsEvent('open');

      expect(mockWsCalls).toHaveLength(1);

      // Find the run:start event
      const runStartCall = mockSend.mock.calls.find((c) => {
        const parsed = JSON.parse(c[0] as string) as { type: string };
        return parsed.type === 'run:start';
      });
      expect(runStartCall).toBeDefined();

      const payload = JSON.parse(runStartCall![0] as string) as {
        type: string;
        runId: string;
        payload: {
          total: number;
          projects: string[];
          config: { workers: number; retries: number; timeout: number; testDir: string };
          pr: object;
          branch?: string;
          commitSha?: string;
        };
      };

      expect(payload.type).toBe('run:start');
      expect(payload.runId).toBe('begin-run');
      expect(payload.payload.total).toBe(5);
      expect(payload.payload.projects).toEqual(['chromium']);
      expect(payload.payload.config.workers).toBe(4);
      expect(payload.payload.config.retries).toBe(2);
      expect(payload.payload.config.timeout).toBe(30000);
      expect(payload.payload.config.testDir).toBe('tests/');
    });

    it('includes PR metadata in run:start', () => {
      process.env.PR_NUMBER = '55';
      process.env.GITHUB_HEAD_REF = 'feat/test';
      process.env.GITHUB_BASE_REF = 'main';
      process.env.GITHUB_ACTOR = 'dev-user';

      reporter = new WsReporter({ runId: 'pr-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      const runStartCall = mockSend.mock.calls.find((c) => {
        const p = JSON.parse(c[0] as string) as { type: string };
        return p.type === 'run:start';
      });

      const payload = JSON.parse(runStartCall![0] as string) as {
        payload: {
          pr: { prNumber: number; prBranch: string; baseBranch: string; commitAuthor: string };
          branch: string;
        };
      };

      expect(payload.payload.pr.prNumber).toBe(55);
      expect(payload.payload.pr.prBranch).toBe('feat/test');
      expect(payload.payload.pr.baseBranch).toBe('main');
      expect(payload.payload.pr.commitAuthor).toBe('dev-user');
      expect(payload.payload.branch).toBe('feat/test');

      delete process.env.PR_NUMBER;
      delete process.env.GITHUB_HEAD_REF;
      delete process.env.GITHUB_BASE_REF;
      delete process.env.GITHUB_ACTOR;
    });

    it('includes commitSha from GITHUB_SHA', () => {
      process.env.GITHUB_SHA = 'abc123';
      reporter = new WsReporter({ runId: 'sha-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      const runStartCall = mockSend.mock.calls.find((c) => {
        const p = JSON.parse(c[0] as string) as { type: string };
        return p.type === 'run:start';
      });

      const payload = JSON.parse(runStartCall![0] as string) as { payload: { commitSha: string } };
      expect(payload.payload.commitSha).toBe('abc123');
      delete process.env.GITHUB_SHA;
    });

    it('includes commitSha from CI_COMMIT_SHA as fallback', () => {
      process.env.CI_COMMIT_SHA = 'gitlab-sha-456';
      reporter = new WsReporter({ runId: 'gl-sha-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      const runStartCall = mockSend.mock.calls.find((c) => {
        const p = JSON.parse(c[0] as string) as { type: string };
        return p.type === 'run:start';
      });

      const payload = JSON.parse(runStartCall![0] as string) as { payload: { commitSha: string } };
      expect(payload.payload.commitSha).toBe('gitlab-sha-456');
      delete process.env.CI_COMMIT_SHA;
    });

    it('uses config defaults when projects array is empty', () => {
      reporter = new WsReporter({ runId: 'empty-proj' });
      const config: FullConfig = {
        workers: 2,
        projects: [],
      } as unknown as FullConfig;
      reporter.onBegin(config, makeSuite());
      simulateWsEvent('open');

      const runStartCall = mockSend.mock.calls.find((c) => {
        const p = JSON.parse(c[0] as string) as { type: string };
        return p.type === 'run:start';
      });

      const payload = JSON.parse(runStartCall![0] as string) as {
        payload: { projects: string[]; config: { retries: number; timeout: number; testDir: string } };
      };
      expect(payload.payload.projects).toEqual([]);
      expect(payload.payload.config.retries).toBe(0);
      expect(payload.payload.config.timeout).toBe(30000);
      expect(payload.payload.config.testDir).toBe('.');
    });
  });

  // ────────────────────────────────
  // onTestBegin
  // ────────────────────────────────
  describe('onTestBegin', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'tb-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();
    });

    it('emits test:begin event with correct shape', () => {
      const test = makeTestCase({ id: 'test-1', title: 'my test', tags: ['@smoke', '@regression'] });
      const result = makeTestResult({ retry: 1, workerIndex: 2, parallelIndex: 0 });

      reporter.onTestBegin(test, result);

      expect(mockSend).toHaveBeenCalledOnce();
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        runId: string;
        payload: {
          testId: string;
          title: string;
          titlePath: string[];
          file: string;
          line: number;
          column: number;
          workerIndex: number;
          parallelIndex: number;
          retry: number;
          tags: string[];
          annotations: unknown[];
        };
      };

      expect(event.type).toBe('test:begin');
      expect(event.runId).toBe('tb-run');
      expect(event.payload.testId).toBe('test-1');
      expect(event.payload.title).toBe('my test');
      expect(event.payload.titlePath).toEqual(['suite', 'my test']);
      expect(event.payload.file).toBe('tests/my.test.ts');
      expect(event.payload.line).toBe(10);
      expect(event.payload.column).toBe(1);
      expect(event.payload.workerIndex).toBe(2);
      expect(event.payload.parallelIndex).toBe(0);
      expect(event.payload.retry).toBe(1);
      expect(event.payload.tags).toEqual(['@smoke', '@regression']);
      expect(event.payload.annotations).toEqual([]);
    });
  });

  // ────────────────────────────────
  // onTestEnd
  // ────────────────────────────────
  describe('onTestEnd', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'te-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();
    });

    it('emits test:end with passed status', () => {
      const test = makeTestCase({ id: 'test-pass' });
      const result = makeTestResult({ status: 'passed', duration: 250 });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: { status: string; durationMs: number; error?: object; attachments: unknown[] };
      };
      expect(event.type).toBe('test:end');
      expect(event.payload.status).toBe('passed');
      expect(event.payload.durationMs).toBe(250);
      expect(event.payload.error).toBeUndefined();
      expect(event.payload.attachments).toEqual([]);
    });

    it('emits test:end with error info on failure', () => {
      const test = makeTestCase({ id: 'test-fail' });
      const result = makeTestResult({
        status: 'failed',
        errors: [{ message: 'Expected X got Y', stack: 'at test.ts:5' }],
      });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { status: string; error: { message: string; stack: string } };
      };
      expect(event.payload.status).toBe('failed');
      expect(event.payload.error).toEqual({ message: 'Expected X got Y', stack: 'at test.ts:5' });
    });

    it('marks screenshot attachment as autoCapture when test failed', () => {
      const test = makeTestCase({ id: 'test-fail-screen' });
      const result = makeTestResult({
        status: 'failed',
        attachments: [
          { name: 'screenshot', contentType: 'image/png', path: '/tmp/screen.png' },
        ],
      });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { attachments: { name: string; contentType: string; autoCapture: boolean }[] };
      };
      expect(event.payload.attachments[0]!.autoCapture).toBe(true);
    });

    it('does not mark screenshot as autoCapture when test passed', () => {
      const test = makeTestCase({ id: 'test-pass-screen' });
      const result = makeTestResult({
        status: 'passed',
        attachments: [
          { name: 'screenshot', contentType: 'image/png', path: '/tmp/screen.png' },
        ],
      });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { attachments: { name: string; autoCapture: boolean }[] };
      };
      expect(event.payload.attachments[0]!.autoCapture).toBe(false);
    });

    it('marks screenshot as autoCapture when timedOut', () => {
      const test = makeTestCase({ id: 'test-timeout' });
      const result = makeTestResult({
        status: 'timedOut',
        attachments: [
          { name: 'screenshot', contentType: 'image/png', path: '/tmp/screen.png' },
        ],
      });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { attachments: { autoCapture: boolean }[] };
      };
      expect(event.payload.attachments[0]!.autoCapture).toBe(true);
    });

    it('includes serialized steps in test:end', () => {
      const step = makeStep({ title: 'click button', duration: 50 });
      const nestedStep = makeStep({ title: 'find element', duration: 10, steps: [] });
      (step as unknown as { steps: TestStep[] }).steps = [nestedStep];

      const test = makeTestCase({ id: 'test-steps' });
      const result = makeTestResult({ steps: [step] });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: {
          steps: { title: string; durationMs: number; steps: { title: string }[] }[];
        };
      };
      expect(event.payload.steps).toHaveLength(1);
      expect(event.payload.steps[0]!.title).toBe('click button');
      expect(event.payload.steps[0]!.durationMs).toBe(50);
      expect(event.payload.steps[0]!.steps).toHaveLength(1);
      expect(event.payload.steps[0]!.steps[0]!.title).toBe('find element');
    });

    it('includes step error in serialized steps', () => {
      const step = makeStep({
        title: 'failing step',
        error: { message: 'Step failed', stack: 'at step.ts:10' },
      });
      const test = makeTestCase({ id: 'test-step-err' });
      const result = makeTestResult({ steps: [step] });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { steps: { error: { message: string; stack: string } }[] };
      };
      expect(event.payload.steps[0]!.error).toEqual({ message: 'Step failed', stack: 'at step.ts:10' });
    });
  });

  // ────────────────────────────────
  // onEnd
  // ────────────────────────────────
  describe('onEnd', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'end-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();
    });

    it('emits run:end with status and durationMs', async () => {
      vi.useFakeTimers();

      const fullResult: FullResult = { status: 'passed', duration: 5000 } as FullResult;
      const endPromise = reporter.onEnd(fullResult);

      vi.runAllTimers();
      await endPromise;

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: { status: string; durationMs: number };
      };
      expect(event.type).toBe('run:end');
      expect(event.payload.status).toBe('passed');
      expect(event.payload.durationMs).toBe(5000);

      vi.useRealTimers();
    });

    it('closes the WebSocket after run:end', async () => {
      vi.useFakeTimers();

      const fullResult: FullResult = { status: 'failed', duration: 1000 } as FullResult;
      const endPromise = reporter.onEnd(fullResult);

      vi.runAllTimers();
      await endPromise;

      expect(mockClose).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  // ────────────────────────────────
  // onStepBegin / onStepEnd
  // ────────────────────────────────
  describe('onStepBegin', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'step-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();
    });

    it('emits step:begin with correct shape', () => {
      const test = makeTestCase({ id: 'test-step-begin' });
      const result = makeTestResult();
      const step = makeStep({ title: 'fill form', category: 'action' });

      reporter.onStepBegin(test, result, step);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: {
          testId: string;
          stepId: string;
          title: string;
          category: string;
          startTime: string;
        };
      };
      expect(event.type).toBe('step:begin');
      expect(event.payload.testId).toBe('test-step-begin');
      expect(event.payload.title).toBe('fill form');
      expect(event.payload.category).toBe('action');
      expect(event.payload.startTime).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('onStepEnd', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'stepend-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();
    });

    it('emits step:end with durationMs', () => {
      const test = makeTestCase({ id: 'test-step-end' });
      const result = makeTestResult();
      const step = makeStep({ title: 'submit', duration: 75 });

      reporter.onStepEnd(test, result, step);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: { testId: string; durationMs: number; error?: object };
      };
      expect(event.type).toBe('step:end');
      expect(event.payload.testId).toBe('test-step-end');
      expect(event.payload.durationMs).toBe(75);
      expect(event.payload.error).toBeUndefined();
    });

    it('emits step:end with error info when step failed', () => {
      const test = makeTestCase({ id: 'test-step-err2' });
      const result = makeTestResult();
      const step = makeStep({
        title: 'navigate',
        error: { message: 'Navigation failed', stack: 'nav.ts:5' },
      });

      reporter.onStepEnd(test, result, step);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { error: { message: string; stack: string } };
      };
      expect(event.payload.error).toEqual({ message: 'Navigation failed', stack: 'nav.ts:5' });
    });
  });

  // ────────────────────────────────
  // onStdOut / onStdErr
  // ────────────────────────────────
  describe('onStdOut', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'stdout-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();
    });

    it('emits stdout event with chunk string', () => {
      reporter.onStdOut('console log output');

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: { testId?: string; chunk: string };
      };
      expect(event.type).toBe('stdout');
      expect(event.payload.chunk).toBe('console log output');
      expect(event.payload.testId).toBeUndefined();
    });

    it('emits stdout with testId when test is provided', () => {
      const test = makeTestCase({ id: 'test-stdout' });
      reporter.onStdOut('output with test', test);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { testId: string; chunk: string };
      };
      expect(event.payload.testId).toBe('test-stdout');
      expect(event.payload.chunk).toBe('output with test');
    });

    it('handles Buffer input by converting to string', () => {
      const buf = Buffer.from('buffered output');
      reporter.onStdOut(buf);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { chunk: string };
      };
      expect(event.payload.chunk).toBe('buffered output');
    });
  });

  describe('onStdErr', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'stderr-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();
    });

    it('emits stderr event with chunk string', () => {
      reporter.onStdErr('error output');

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        type: string;
        payload: { chunk: string };
      };
      expect(event.type).toBe('stderr');
      expect(event.payload.chunk).toBe('error output');
    });
  });

  // ────────────────────────────────
  // printsToStdio
  // ────────────────────────────────
  describe('printsToStdio', () => {
    it('returns false', () => {
      reporter = new WsReporter();
      expect(reporter.printsToStdio()).toBe(false);
    });
  });

  // ────────────────────────────────
  // WebSocket error / close handlers
  // ────────────────────────────────
  describe('WebSocket error handling', () => {
    beforeEach(() => {
      reporter = new WsReporter({ runId: 'err-run' });
      reporter.onBegin(makeConfig(), makeSuite());
    });

    it('logs a warning on WebSocket error', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      simulateWsEvent('error', new Error('connection refused'));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[ws-reporter] WebSocket error: connection refused'),
      );
      warnSpy.mockRestore();
    });

    it('sets connected=false on close', () => {
      simulateWsEvent('open');
      // After close, reporter is no longer connected
      // Trigger close (not ended, retryCount < 3 → reconnect)
      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      simulateWsEvent('close');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ws-reporter] Connection lost'));
      vi.useRealTimers();
      warnSpy.mockRestore();
    });

    it('does not reconnect when ended=true', async () => {
      simulateWsEvent('open');
      vi.useFakeTimers();

      const endPromise = reporter.onEnd({ status: 'passed', duration: 100 } as FullResult);
      vi.runAllTimers();
      await endPromise;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.clearAllMocks();
      simulateWsEvent('close');
      expect(warnSpy).not.toHaveBeenCalledWith(expect.stringContaining('Connection lost'));

      vi.useRealTimers();
      warnSpy.mockRestore();
    });
  });

  // ────────────────────────────────
  // runId propagation
  // ────────────────────────────────
  describe('runId propagation', () => {
    it('uses options.runId in all emitted events', () => {
      reporter = new WsReporter({ runId: 'specific-run-id' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      // All queued+flushed events should have the correct runId
      for (const call of mockSend.mock.calls) {
        const event = JSON.parse(call[0] as string) as { runId: string };
        expect(event.runId).toBe('specific-run-id');
      }
    });

    it('uses DASHBOARD_RUN_ID env var as runId when no option provided', () => {
      process.env.DASHBOARD_RUN_ID = 'env-run-789';
      reporter = new WsReporter({});
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      for (const call of mockSend.mock.calls) {
        const event = JSON.parse(call[0] as string) as { runId: string };
        expect(event.runId).toBe('env-run-789');
      }
      delete process.env.DASHBOARD_RUN_ID;
    });
  });

  // ────────────────────────────────
  // Mutation-killing: exact event type string literals
  // ────────────────────────────────
  describe('event type string literals — kills StringLiteral mutations', () => {
    it('emits exactly "run:start" (not empty string or other value) — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'sl-run' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      const events = mockSend.mock.calls.map((c) => JSON.parse(c[0] as string) as { type: string });
      const types = events.map((e) => e.type);
      expect(types).toContain('run:start');
      expect(types).not.toContain('');
    });

    it('emits exactly "test:begin" for onTestBegin — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'sl-tb' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      reporter.onTestBegin(makeTestCase(), makeTestResult());
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as { type: string };
      expect(event.type).toBe('test:begin');
      expect(event.type).not.toBe('');
    });

    it('emits exactly "test:end" for onTestEnd — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'sl-te' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      reporter.onTestEnd(makeTestCase(), makeTestResult());
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as { type: string };
      expect(event.type).toBe('test:end');
      expect(event.type).not.toBe('');
    });

    it('emits exactly "step:begin" for onStepBegin — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'sl-sb' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      reporter.onStepBegin(makeTestCase(), makeTestResult(), makeStep());
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as { type: string };
      expect(event.type).toBe('step:begin');
    });

    it('emits exactly "step:end" for onStepEnd — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'sl-se' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      reporter.onStepEnd(makeTestCase(), makeTestResult(), makeStep());
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as { type: string };
      expect(event.type).toBe('step:end');
    });

    it('emits exactly "stdout" for onStdOut — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'sl-stdout' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      reporter.onStdOut('msg');
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as { type: string };
      expect(event.type).toBe('stdout');
    });

    it('emits exactly "stderr" for onStdErr — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'sl-stderr' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      reporter.onStdErr('err');
      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as { type: string };
      expect(event.type).toBe('stderr');
    });

    it('emits exactly "run:end" for onEnd — kills StringLiteral mutation', async () => {
      vi.useFakeTimers();
      reporter = new WsReporter({ runId: 'sl-end' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const endPromise = reporter.onEnd({ status: 'passed', duration: 100 } as import('@playwright/test/reporter').FullResult);
      vi.runAllTimers();
      await endPromise;

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as { type: string };
      expect(event.type).toBe('run:end');
      vi.useRealTimers();
    });
  });

  // ────────────────────────────────
  // Mutation-killing: autoCapture LogicalOperator &&
  // ────────────────────────────────
  describe('autoCapture LogicalOperator — kills && → || mutation', () => {
    it('does NOT set autoCapture for non-image attachment on failed test — kills LogicalOperator mutation', () => {
      reporter = new WsReporter({ runId: 'ac-nonimage' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const test = makeTestCase({ id: 'test-fail-pdf' });
      const result = makeTestResult({
        status: 'failed',
        // PDF, not image — should NOT be autoCapture
        attachments: [{ name: 'screenshot', contentType: 'application/pdf', path: '/tmp/file.pdf' }],
      });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { attachments: { autoCapture: boolean }[] };
      };
      // Failed but contentType is NOT image/ → autoCapture must be false
      expect(event.payload.attachments[0]!.autoCapture).toBe(false);
    });

    it('does NOT set autoCapture when name is not "screenshot" on failed test — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'ac-notscreenshot' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      const test = makeTestCase({ id: 'test-fail-video' });
      const result = makeTestResult({
        status: 'failed',
        // image type but name is "video" — should NOT be autoCapture
        attachments: [{ name: 'video', contentType: 'image/png', path: '/tmp/screen.png' }],
      });

      reporter.onTestEnd(test, result);

      const event = JSON.parse(mockSend.mock.calls[0]![0] as string) as {
        payload: { attachments: { name: string; autoCapture: boolean }[] };
      };
      // Failed and image/ but name is NOT "screenshot" → autoCapture must be false
      expect(event.payload.attachments[0]!.autoCapture).toBe(false);
    });

    it('only autoCapture=true when ALL three conditions are met: failed + image/ + screenshot name — kills && → || mutation', () => {
      reporter = new WsReporter({ runId: 'ac-all3' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');
      vi.clearAllMocks();

      // Passed + image/png + screenshot → NOT autoCapture
      const test1 = makeTestCase({ id: 'test-pass-img-scr' });
      const result1 = makeTestResult({
        status: 'passed',
        attachments: [{ name: 'screenshot', contentType: 'image/png', path: '/tmp/s.png' }],
      });
      reporter.onTestEnd(test1, result1);
      const ev1 = JSON.parse(mockSend.mock.calls[mockSend.mock.calls.length - 1]![0] as string) as {
        payload: { attachments: { autoCapture: boolean }[] };
      };
      expect(ev1.payload.attachments[0]!.autoCapture).toBe(false);

      // Failed + application/pdf + screenshot → NOT autoCapture
      const test2 = makeTestCase({ id: 'test-fail-pdf-scr' });
      const result2 = makeTestResult({
        status: 'failed',
        attachments: [{ name: 'screenshot', contentType: 'application/pdf', path: '/tmp/s.pdf' }],
      });
      reporter.onTestEnd(test2, result2);
      const ev2 = JSON.parse(mockSend.mock.calls[mockSend.mock.calls.length - 1]![0] as string) as {
        payload: { attachments: { autoCapture: boolean }[] };
      };
      expect(ev2.payload.attachments[0]!.autoCapture).toBe(false);

      // Failed + image/png + "trace" → NOT autoCapture
      const test3 = makeTestCase({ id: 'test-fail-img-trace' });
      const result3 = makeTestResult({
        status: 'failed',
        attachments: [{ name: 'trace', contentType: 'image/png', path: '/tmp/t.png' }],
      });
      reporter.onTestEnd(test3, result3);
      const ev3 = JSON.parse(mockSend.mock.calls[mockSend.mock.calls.length - 1]![0] as string) as {
        payload: { attachments: { autoCapture: boolean }[] };
      };
      expect(ev3.payload.attachments[0]!.autoCapture).toBe(false);
    });
  });

  // ────────────────────────────────
  // Mutation-killing: retryCount boundary
  // ────────────────────────────────
  describe('retry reconnect boundary — kills ConditionalExpression and NumberLiteral mutations', () => {
    it('logs reconnect warning message with attempt counter on close — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'retry-boundary' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // First close (retryCount becomes 1 → < 3 → reconnect)
      simulateWsEvent('close');
      // Must log the exact string format including "/3" — kills StringLiteral "3" mutation
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('attempt 1/3'));
      // The total retry limit must be explicitly "3" in the message
      expect(warnSpy.mock.calls[0]![0]).toContain('/3');

      vi.useRealTimers();
      warnSpy.mockRestore();
    });

    it('reconnect warning mentions "[ws-reporter] Connection lost" — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'retry-msg' });
      reporter.onBegin(makeConfig(), makeSuite());
      simulateWsEvent('open');

      vi.useFakeTimers();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      simulateWsEvent('close');
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[ws-reporter] Connection lost'));

      vi.useRealTimers();
      warnSpy.mockRestore();
    });
  });

  // ────────────────────────────────
  // Mutation-killing: WebSocket error message string literal
  // ────────────────────────────────
  describe('WebSocket error prefix string — kills StringLiteral mutation', () => {
    it('error warning includes exact prefix "[ws-reporter] WebSocket error:" — kills StringLiteral mutation', () => {
      reporter = new WsReporter({ runId: 'ws-prefix' });
      reporter.onBegin(makeConfig(), makeSuite());

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      simulateWsEvent('error', new Error('ECONNREFUSED'));
      // Must start with the exact prefix string
      const warnArg = warnSpy.mock.calls[0]![0] as string;
      expect(warnArg.startsWith('[ws-reporter] WebSocket error:')).toBe(true);
      warnSpy.mockRestore();
    });
  });
});
