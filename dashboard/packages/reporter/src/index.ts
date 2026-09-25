/**
 * index.ts — Automate Playwright Reporter
 *
 * Connects to the dashboard server on ws://localhost:4001/reporter and
 * streams every lifecycle event as typed JSON. Configure in playwright.config.ts:
 *
 *   reporter: [['@automate/reporter', { port: 4001 }]],
 */
import type {
  Reporter,
  TestCase,
  TestResult,
  TestStep,
  Suite,
  FullConfig,
  FullResult,
} from '@playwright/test/reporter';
import { WebSocket } from 'ws';

interface WsReporterOptions {
  port?: number;
  host?: string;
  runId?: string;
}

type EventType =
  | 'run:start'
  | 'test:begin'
  | 'test:end'
  | 'step:begin'
  | 'step:end'
  | 'stdout'
  | 'stderr'
  | 'run:end';

interface WsEvent {
  type: EventType;
  runId: string;
  payload: unknown;
}

export function extractPRMetadata() {
  const ghPrNumber = process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)/)?.[1];
  const prNumber = parseInt(process.env.PR_NUMBER ?? process.env.CI_MERGE_REQUEST_IID ?? ghPrNumber ?? '', 10) || undefined;
  const prBranch = process.env.GITHUB_HEAD_REF ?? process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME ?? undefined;
  const baseBranch = process.env.GITHUB_BASE_REF ?? process.env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ?? undefined;
  const commitAuthor = process.env.GITHUB_ACTOR ?? process.env.GITLAB_USER_NAME ?? undefined;
  return { prNumber, prBranch, baseBranch, commitAuthor };
}

export default class WsReporter implements Reporter {
  private ws: WebSocket | null = null;
  private runId: string;
  private queue: WsEvent[] = [];
  private connected = false;
  private ended = false;
  private retryCount = 0;

  constructor(private options: WsReporterOptions = {}) {
    this.runId = options.runId ?? process.env.DASHBOARD_RUN_ID ?? crypto.randomUUID();
  }

  // ──────────────────────────────────────────────
  // Connection helpers
  // ──────────────────────────────────────────────
  private connect() {
    const envUrl = process.env.AUTOMATE_DASHBOARD_URL;
    let url: string;

    if (envUrl) {
      // Parse AUTOMATE_DASHBOARD_URL — accept http://, https://, ws://, wss://
      const parsed = new URL(envUrl);
      const wsProtocol = parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? 'wss' : 'ws';
      const host = parsed.hostname;
      const port = parsed.port || (wsProtocol === 'wss' ? '443' : '80');
      url = `${wsProtocol}://${host}:${port}/reporter`;
    } else {
      const port = this.options.port ?? 4001;
      const host = this.options.host ?? 'localhost';
      url = `ws://${host}:${port}/reporter`;
    }

    const reporterSecret = process.env.REPORTER_SECRET;
    if (reporterSecret) {
      const sep = url.includes('?') ? '&' : '?';
      url = `${url}${sep}token=${encodeURIComponent(reporterSecret)}`;
    }

    // Always advertise protocol version so the server can validate compatibility
    const pvSep = url.includes('?') ? '&' : '?';
    url = `${url}${pvSep}protocolVersion=1`;

    this.ws = new WebSocket(url);

    this.ws.once('open', () => {
      this.connected = true;
      this.retryCount = 0;
      // flush queued events
      for (const event of this.queue) this.send(event);
      this.queue = [];
    });

    this.ws.on('error', (err: Error) => {
      console.warn(`[ws-reporter] WebSocket error: ${err.message}`);
    });

    this.ws.on('close', () => {
      this.connected = false;
      if (!this.ended && this.retryCount < 3) {
        this.retryCount++;
        console.warn(`[ws-reporter] Connection lost, reconnecting (attempt ${this.retryCount}/3)...`);
        setTimeout(() => this.connect(), 1000 * this.retryCount);
      }
    });
  }

  private send(event: WsEvent) {
    if (!this.ws || !this.connected || this.ws.readyState !== WebSocket.OPEN) {
      this.queue.push(event);
      return;
    }
    this.ws.send(JSON.stringify(event));
  }

  private emit(type: EventType, payload: unknown) {
    this.send({ type, runId: this.runId, payload });
  }

  // ──────────────────────────────────────────────
  // Playwright Reporter API
  // ──────────────────────────────────────────────
  onBegin(config: FullConfig, suite: Suite) {
    this.connect();
    const prMeta = extractPRMetadata();
    this.emit('run:start', {
      total: suite.allTests().length,
      projects: config.projects.map((p: { name: string }) => p.name),
      config: {
        workers: config.workers,
        retries: config.projects[0]?.retries ?? 0,
        timeout: config.projects[0]?.timeout ?? 30000,
        testDir: config.projects[0]?.testDir ?? '.',
      },
      pr: prMeta,
      branch: process.env.GITHUB_HEAD_REF ?? process.env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME,
      commitSha: process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA,
    });
  }

  onTestBegin(test: TestCase, result: TestResult) {
    this.emit('test:begin', {
      testId: test.id,
      title: test.title,
      titlePath: test.titlePath(),
      file: test.location.file,
      line: test.location.line,
      column: test.location.column,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
      retry: result.retry,
      tags: test.tags,
      annotations: test.annotations,
    });
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    this.emit('step:begin', {
      testId: test.id,
      stepId: step.titlePath().join(' > '),
      title: step.title,
      category: step.category,
      location: step.location,
      startTime: step.startTime.toISOString(),
    });
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    this.emit('step:end', {
      testId: test.id,
      stepId: step.titlePath().join(' > '),
      durationMs: step.duration,
      error: step.error
        ? { message: step.error.message, stack: step.error.stack }
        : undefined,
    });
  }

  onStdOut(chunk: string | Buffer, test?: TestCase) {
    this.emit('stdout', { testId: test?.id, chunk: chunk.toString() });
  }

  onStdErr(chunk: string | Buffer, test?: TestCase) {
    this.emit('stderr', { testId: test?.id, chunk: chunk.toString() });
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const isFailed = result.status === 'failed' || result.status === 'timedOut';

    this.emit('test:end', {
      testId: test.id,
      status: result.status,
      durationMs: result.duration,
      retry: result.retry,
      workerIndex: result.workerIndex,
      parallelIndex: result.parallelIndex,
      tags: test.tags,
      annotations: test.annotations,
      error: result.errors[0]
        ? { message: result.errors[0].message, stack: result.errors[0].stack }
        : undefined,
      attachments: result.attachments.map((a: { name: string; contentType: string; path?: string }) => ({
        name: a.name,
        contentType: a.contentType,
        path: a.path,
        autoCapture: isFailed && a.contentType.startsWith('image/') && a.name === 'screenshot',
      })),
      stdout: result.stdout,
      stderr: result.stderr,
      steps: serializeSteps(result.steps),
    });
  }

  async onEnd(result: FullResult) {
    this.ended = true;
    this.emit('run:end', {
      status: result.status,
      durationMs: result.duration,
    });

    // Give the socket a moment to flush
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
    this.ws?.close();
  }

  printsToStdio() {
    return false;
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
function serializeSteps(steps: TestStep[]): object[] {
  return steps.map((s) => ({
    title: s.title,
    category: s.category,
    durationMs: s.duration,
    error: s.error ? { message: s.error.message, stack: s.error.stack } : undefined,
    location: s.location,
    steps: serializeSteps(s.steps),
  }));
}

// Named exports for convenience
export { WsReporter };
