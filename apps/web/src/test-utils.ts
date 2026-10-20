import { vi } from 'vitest';
import type { RunEventEnvelope } from '@automate/shared-contracts';
import type { ApiClient, QuarantineEntry, Run } from './lib/api.js';
import type { QaClient } from './lib/qa-client.js';
import {
  AnalyticsTrendSchema,
  ProjectHistorySchema,
  QaInsightsSchema,
  ReleaseReadinessCardSchema,
  RepoScanSchema,
  type AnalyticsTrend,
  type ProjectHistory,
  type QaInsights,
  type RegisteredProject,
  type ReleaseReadinessCard,
  type RepoScan,
  type RepoTool,
  type TrendWindow,
} from './lib/qa.js';

export const TEST_TIMESTAMP = '2026-09-25T00:00:00.000Z';

export function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    externalId: null,
    source: 'web',
    framework: 'playwright',
    adapterVersion: '1',
    testType: 'browser',
    projectId: 'project-1',
    environmentId: 'environment-1',
    releaseId: 'release-1',
    branch: 'main',
    commit: 'abc123',
    suite: null,
    selection: [],
    timeoutMs: 1_800_000,
    priority: 0,
    requiredCapabilities: ['playwright'],
    labels: [],
    configuration: {},
    policyId: null,
    idempotencyKey: 'test-idempotency-key',
    workspaceId: 'workspace-1',
    attempt: 1,
    retryOfRunId: null,
    tests: [],
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
      blocked: 0,
      unknown: 0,
      durationMs: null,
    },
    phase: 'queued',
    outcome: null,
    createdAt: TEST_TIMESTAMP,
    updatedAt: TEST_TIMESTAMP,
    startedAt: null,
    completedAt: null,
    finishedAt: null,
    runner: null,
    error: null,
    rawEvidenceRefs: [],
    artifacts: [],
    policyEvaluation: null,
    ...overrides,
  };
}

export function makePhaseEvent({
  runId = 'run-1',
  sequence = 1,
  phase = 'running',
  outcome = null,
}: {
  runId?: string;
  sequence?: number;
  phase?: Run['phase'];
  outcome?: Run['outcome'];
} = {}): RunEventEnvelope {
  return {
    version: '1',
    eventId: `${runId}-${sequence}`,
    sequence,
    occurredAt: TEST_TIMESTAMP,
    runId,
    type: 'run.phase_changed',
    payload: { phase, outcome },
  };
}

/**
 * A promise the test resolves or rejects by hand.
 *
 * Cancellation tests need a request that is still open at the moment the
 * assertion runs; a `mockResolvedValue` settles in a microtask, which is too
 * early to observe whether the signal was aborted.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

/**
 * The rejection an aborted `fetch` produces.
 *
 * A real `DOMException` named `AbortError`, not a plain `Error` with the name
 * bolted on: the client recognises cancellations by name, and a hand-rolled
 * stand-in would let a hook pass by duck-typing something the browser never
 * throws.
 */
export function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * A `fetch` double that rejects with {@link abortError} once its signal aborts,
 * and never settles otherwise — the behaviour a real request has.
 */
export function fetchAborting(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

/**
 * A fully-defaulted `ApiClient` double.
 *
 * Every method has a typed `mockResolvedValue` default. Previously six of them
 * were a bare `vi.fn()`, so a test that forgot an override got
 * `await api.getRun(id) === undefined` typed as `Run` — and then asserted on a
 * property of `undefined`, or crashed somewhere unrelated, with no indication
 * that the fixture was the problem. A default that is wrong is still a
 * deliberate choice in the test; a default that is absent is a trap.
 */
export function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const run: Run = makeRun();
  const base: ApiClient = {
    getRuns: vi.fn(async () => []),
    getRun: vi.fn(async () => run),
    createRun: vi.fn(async () => run),
    cancelRun: vi.fn(async () => run),
    retryRun: vi.fn(async () => run),
    getRunArtifacts: vi.fn(async () => []),
    getRunGate: vi.fn(async () => null),
    getReleaseReadiness: vi.fn(async () => null),
    getAnalyticsSummary: vi.fn(async () => ({
      totalRuns: 0,
      passRate: 0,
      avgDurationMs: null,
    })),
    getQuarantine: vi.fn(async () => []),
    // Annotated rather than inferred: without it `status` widens to `string` and the
    // mock stops satisfying `ApiClient`, so the compile error surfaces here rather
    // than as a `vi.fn()` that returns the wrong shape at runtime.
    addQuarantine: vi.fn(
      async (entry): Promise<QuarantineEntry> => ({
        id: 'quarantine-1',
        testTitle: entry.testTitle,
        testFile: entry.testFile,
        reason: entry.reason ?? null,
        quarantinedAt: TEST_TIMESTAMP,
        status: 'pending',
      }),
    ),
    subscribeToRunEvents: vi.fn(() => () => undefined),
  };
  return { ...base, ...overrides };
}

export const TEST_PROJECT: RegisteredProject = {
  id: 'project-1',
  workspaceId: 'ws-1',
  name: 'Automate',
  slug: 'automate',
  repoPath: '/repos/automate',
  detectorVersion: 1,
  createdAt: TEST_TIMESTAMP,
};

export function makeTool(overrides: Partial<RepoTool> = {}): RepoTool {
  return {
    id: 'script:.:test',
    name: 'test',
    label: 'pnpm run test',
    kind: 'unit',
    argv: ['pnpm', 'run', 'test'],
    workingDirectory: '.',
    source: 'package.json',
    evidence: 'vitest run',
    runnable: true,
    reason: null,
    ...overrides,
  };
}

/**
 * A repository scan, parsed rather than cast, so a fixture that drifted from the
 * contract fails here instead of making every assertion pass against a payload the
 * API could never send.
 */
export function makeScan(overrides: Partial<RepoScan> = {}): RepoScan {
  return RepoScanSchema.parse({
    scannedAt: TEST_TIMESTAMP,
    ecosystems: ['node'],
    manifests: 2,
    testFiles: 40,
    sourceFiles: 100,
    tools: [
      makeTool(),
      makeTool({
        id: 'script:.:lint',
        name: 'lint',
        label: 'pnpm run lint',
        kind: 'static-analysis',
        argv: ['pnpm', 'run', 'lint'],
        evidence: 'eslint .',
      }),
      makeTool({
        id: 'script:.:dev',
        name: 'dev',
        label: 'pnpm run dev',
        kind: 'dev',
        argv: ['pnpm', 'run', 'dev'],
        evidence: 'vite',
        runnable: false,
        reason: 'A long-running server or watcher; it never exits, so it cannot be a run.',
      }),
      makeTool({
        id: 'script:apps/web:test:e2e',
        name: 'test:e2e',
        label: 'pnpm run test:e2e',
        kind: 'e2e',
        argv: ['pnpm', 'run', 'test:e2e'],
        workingDirectory: 'apps/web',
        source: 'apps/web/package.json',
        evidence: 'playwright test',
      }),
    ],
    reports: [
      {
        path: 'coverage/coverage-summary.json',
        kind: 'coverage',
        format: 'istanbul-summary',
        headline: '91.5% of lines covered',
        metrics: { lines: 91.5 },
        status: 'good',
      },
      {
        path: 'test-results/junit.xml',
        kind: 'tests',
        format: 'junit-xml',
        headline: '10 tests, 2 failing, 0 skipped',
        metrics: { tests: 10, failed: 2, passed: 8, skipped: 0 },
        status: 'bad',
      },
      {
        path: 'gitleaks.json',
        kind: 'security',
        format: 'gitleaks-json',
        headline: '1 possible secrets',
        metrics: { findings: 1 },
        status: 'bad',
      },
    ],
    detected: [
      { id: 'vitest', name: 'Vitest', capability: 'unit', evidence: 'vitest in package.json' },
    ],
    capabilities: [
      { capability: 'unit', covered: true, providers: ['Vitest', 'pnpm run test'], weight: 3 },
      { capability: 'mutation', covered: false, providers: [], weight: 1 },
      { capability: 'secrets', covered: false, providers: [], weight: 2 },
    ],
    maturity: 50,
    toolbox: [
      {
        id: 'vitest',
        name: 'Vitest',
        capability: 'unit',
        description: 'Fast unit tests.',
        ecosystems: ['node'],
        status: 'in-use',
        priority: 'high',
        reason: 'Found: vitest in package.json',
        setup: 'pnpm add -D vitest',
        docsUrl: 'https://vitest.dev/guide/',
        pricing: 'free',
      },
      {
        id: 'stryker',
        name: 'Stryker',
        capability: 'mutation',
        description: 'Mutation testing.',
        ecosystems: ['node'],
        status: 'recommended',
        priority: 'low',
        reason: 'Nothing in this repository covers mutation.',
        setup: 'npm init stryker@latest',
        docsUrl: 'https://stryker-mutator.io/docs/',
        pricing: 'free',
      },
      {
        id: 'gitleaks',
        name: 'Gitleaks',
        capability: 'secrets',
        description: 'Secret scanning.',
        ecosystems: ['any'],
        status: 'recommended',
        priority: 'high',
        reason: 'Nothing in this repository covers secrets.',
        setup: 'gitleaks detect',
        docsUrl: 'https://github.com/gitleaks/gitleaks',
        pricing: 'free',
      },
      {
        id: 'jest',
        name: 'Jest',
        capability: 'unit',
        description: 'Another unit runner.',
        ecosystems: ['node'],
        status: 'available',
        priority: 'high',
        reason: 'unit is already covered by another tool.',
        setup: 'npm i -D jest',
        docsUrl: 'https://jestjs.io/',
        pricing: 'free',
      },
    ],
    ...overrides,
  });
}

function trendWindow(overrides: Partial<TrendWindow> = {}): TrendWindow {
  return {
    from: '2026-09-11T00:00:00.000Z',
    to: '2026-09-25T00:00:00.000Z',
    runs: 10,
    passRate: 80,
    failedRuns: 2,
    avgDurationMs: 4_000,
    tests: 100,
    testsFailed: 5,
    flakyTests: 3,
    ...overrides,
  };
}

export function makeTrend(
  overrides: {
    days?: number;
    current?: Partial<TrendWindow>;
    previous?: Partial<TrendWindow>;
  } = {},
): AnalyticsTrend {
  const days = overrides.days ?? 3;
  return AnalyticsTrendSchema.parse({
    days,
    buckets: Array.from({ length: days }, (_, index) => ({
      date: `2026-09-${String(20 + index).padStart(2, '0')}`,
      runs: index + 1,
      passed: index,
      failed: 1,
      flaky: 0,
      other: 0,
      passRate: index === 1 ? null : 50,
      avgDurationMs: 1_000,
      tests: 10,
      testsFailed: 1,
    })),
    current: trendWindow({
      passRate: 90,
      runs: 12,
      failedRuns: 1,
      avgDurationMs: 3_000,
      flakyTests: 1,
      ...overrides.current,
    }),
    previous: trendWindow(overrides.previous),
    truncated: false,
  });
}

/** A fully-defaulted `QaClient` double, for the same reason `makeApi` is one. */
export function makeQa(overrides: Partial<QaClient> = {}): QaClient {
  const never = async (): Promise<never> => {
    throw new Error('not stubbed');
  };
  return {
    listProjects: vi.fn(async () => [TEST_PROJECT]),
    getProject: vi.fn(never),
    getScore: vi.fn(never),
    getGaps: vi.fn(async () => ({ gaps: [], cappedBy: 'unit' })),
    getHollow: vi.fn(never),
    getFlaky: vi.fn(never),
    getStructure: vi.fn(never),
    askCopilot: vi.fn(never),
    startRun: vi.fn(async () => ({ runId: 'run-new' })),
    getScan: vi.fn(async () => makeScan()),
    getTrend: vi.fn(async () => makeTrend()),
    getInsights: vi.fn(async () => makeInsights()),
    getHistory: vi.fn(async () => makeHistory()),
    getReadiness: vi.fn(async () => makeReadiness()),
    ...overrides,
  };
}

/** Seven days of insights over a small but complete history: every panel has something. */
export function makeInsights(overrides: Partial<QaInsights> = {}): QaInsights {
  const dates = Array.from({ length: 7 }, (_, index) => `2026-09-${String(20 + index)}`);
  return QaInsightsSchema.parse({
    days: 7,
    from: '2026-09-20T00:00:00.000Z',
    to: '2026-09-27T00:00:00.000Z',
    dates,
    runs: 12,
    flakyLeaderboard: [
      {
        key: 'e2e/login.spec.ts › logs in',
        title: 'logs in',
        file: 'e2e/login.spec.ts',
        runs: 6,
        flaky: 1,
        flips: 2,
        score: 0.5,
        lastSeen: '2026-09-26T10:00:00.000Z',
      },
      {
        key: 'e2e/cart.spec.ts › adds to cart',
        title: 'adds to cart',
        file: 'e2e/cart.spec.ts',
        runs: 8,
        flaky: 0,
        flips: 1,
        score: 0.125,
        lastSeen: '2026-09-25T10:00:00.000Z',
      },
    ],
    slowestTests: [
      {
        key: 'e2e/report.spec.ts › exports a report',
        title: 'exports a report',
        file: 'e2e/report.spec.ts',
        samples: 5,
        p50Ms: 4_200,
        p95Ms: 9_800,
        previousP50Ms: 3_000,
        changePct: 40,
        daily: [3_900, null, 4_100, 4_200, 4_400, null, 4_600],
      },
      {
        key: 'unit/a.test.ts › parses',
        title: 'parses',
        file: null,
        samples: 1,
        p50Ms: 120,
        p95Ms: 120,
        previousP50Ms: null,
        changePct: null,
        daily: [null, null, null, null, null, null, 120],
      },
    ],
    failureHeatmap: [
      {
        suite: 'e2e',
        cells: dates.map((_, index) => ({ runs: 2, failed: index % 3 === 0 ? 2 : index % 2 })),
        failed: 6,
      },
      { suite: 'unit', cells: dates.map(() => ({ runs: 1, failed: 0 })), failed: 0 },
    ],
    mttr: {
      overall: {
        recoveries: 3,
        medianMs: 5_400_000,
        p90Ms: 9_000_000,
        openSince: '2026-09-26T08:00:00.000Z',
      },
      suites: [
        {
          suite: 'e2e',
          recoveries: 0,
          medianMs: null,
          p90Ms: null,
          openSince: '2026-09-26T08:00:00.000Z',
        },
        { suite: 'unit', recoveries: 3, medianMs: 5_400_000, p90Ms: 9_000_000, openSince: null },
      ],
    },
    passRateByBranch: [
      { branch: 'main', runs: 9, passed: 8, failed: 1, passRate: 88.9 },
      { branch: 'feature/cart', runs: 3, passed: 1, failed: 2, passRate: 33.3 },
    ],
    digest: [
      { kind: 'new-flaky', tone: 'bad', text: '1 new flaky test' },
      { kind: 'pass-rate', tone: 'good', text: 'Pass rate +4.0 pts' },
    ],
    truncated: false,
    ...overrides,
  });
}

export function makeHistory(overrides: Partial<ProjectHistory> = {}): ProjectHistory {
  return ProjectHistorySchema.parse({
    projectId: TEST_PROJECT.id,
    days: 30,
    points: [
      {
        at: '2026-09-20T10:00:00.000Z',
        coverage: 88.1,
        healthScore: 61,
        maturity: 70,
        flakyTests: 3,
      },
      {
        at: '2026-09-23T10:00:00.000Z',
        coverage: 89.4,
        healthScore: 64,
        maturity: 72,
        flakyTests: 2,
      },
      {
        at: '2026-09-26T10:00:00.000Z',
        coverage: 90.3,
        healthScore: 66.5,
        maturity: 75,
        flakyTests: 1,
      },
    ],
    collectingSince: '2026-09-20T10:00:00.000Z',
    ...overrides,
  });
}

export function makeReadiness(overrides: Partial<ReleaseReadinessCard> = {}): ReleaseReadinessCard {
  return ReleaseReadinessCardSchema.parse({
    projectId: TEST_PROJECT.id,
    verdict: 'caution',
    reasons: [
      {
        code: 'flaky',
        level: 'caution',
        message: '2% of tests were flaky; the gate allows 0%',
        evidence: 'flaky results',
      },
      {
        code: 'gate',
        level: 'go',
        message: 'The latest quality gate passed',
        evidence: 'run run-1',
      },
    ],
    evaluatedAt: '2026-09-26T10:00:00.000Z',
    ...overrides,
  });
}
