import { vi } from 'vitest';
import {
  AgentRuntimeReportSchema,
  AiCodePullRequestListSchema,
  AiCodeReportSchema,
  DeliveryReportSchema,
  DeliverySourceSchema,
  DiffCoverageStatusSchema,
  EvalDatasetListSchema,
  EvalRunDetailSchema,
  HEALTH_DIMENSIONS,
  HealthFindingSchema,
  HealthFindingsPageSchema,
  McpServerListSchema,
  PortfolioAiCodeSchema,
  PortfolioDeliverySchema,
  ProjectEvalsSchema,
  ProjectHealthSchema,
  SbomComponentsPageSchema,
  ScorecardMetricSchema,
  ScorecardSchema,
  SupplyChainPolicyRecordSchema,
  type AgentRuntimeReport,
  type AiCodePullRequestList,
  type AiCodeReport,
  type DeliveryReport,
  type DeliverySource,
  type DiffCoverageStatus,
  type DimensionScore,
  type EvalRunDetail,
  type HealthFinding,
  type HealthFindingsPage,
  type HealthGrade,
  type McpServerList,
  type PortfolioAiCode,
  type PortfolioDelivery,
  type ProjectEvals,
  type ProjectHealth,
  type RunEventEnvelope,
  type SbomComponentsPage,
  type Scorecard,
  type ScorecardMetric,
  type SupplyChainPolicyRecord,
} from '@automate/shared-contracts';
import type { EvalDatasetList } from './lib/agents-client.js';
import type { HealthClient } from './lib/health-client.js';
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
    addQuarantine: vi.fn(async (entry): Promise<QuarantineEntry> => ({
      id: 'quarantine-1',
      testTitle: entry.testTitle,
      testFile: entry.testFile,
      reason: entry.reason ?? null,
      quarantinedAt: TEST_TIMESTAMP,
      status: 'pending',
    })),
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

// ─── Scorecards and the pages built on them ──────────────────────────────────
//
// Every fixture below is parsed by the server's own contract, for the reason `makeScan` is:
// a fixture that drifted would let every assertion pass against a payload the API could
// never send.

export const PROJECT_UUID = '11111111-1111-4111-8111-111111111111';
const SYNC_UUID = '22222222-2222-4222-8222-222222222222';
const EVALUATED_AT = '2026-10-23T12:00:00.000Z';

export function makeMetric(overrides: Partial<ScorecardMetric> = {}): ScorecardMetric {
  return ScorecardMetricSchema.parse({
    key: 'lead-time',
    label: 'Change lead time',
    value: 20,
    unit: 'hours',
    direction: 'lower-better',
    target: 24,
    trend: -4,
    sampleSize: 12,
    band: 'high',
    status: 'good',
    summary: 'Median 20 h from commit to production',
    ...overrides,
  });
}

export function makeScorecard(overrides: Partial<Scorecard> = {}): Scorecard {
  return ScorecardSchema.parse({
    id: 'delivery',
    title: 'Delivery',
    dimension: 'delivery',
    evaluatedAt: EVALUATED_AT,
    windowDays: 30,
    status: 'pass',
    score: 82,
    cappedBy: 'lead-time',
    metrics: [makeMetric()],
    reasons: [],
    ...overrides,
  });
}

const DORA_METRIC = {
  value: 3.5,
  sampleSize: 12,
  band: 'high',
  status: 'measured',
  previous: 3,
  previousSampleSize: 10,
} as const;

const DURATION = {
  medianHours: 2,
  p75Hours: 5,
  minHours: 0.5,
  maxHours: 30,
  sampleSize: 9,
} as const;

export function makeDeliveryReport(overrides: Partial<DeliveryReport> = {}): DeliveryReport {
  return DeliveryReportSchema.parse({
    projectId: PROJECT_UUID,
    windowDays: 30,
    evaluatedAt: EVALUATED_AT,
    productionEnvironments: ['production'],
    dora: makeScorecard({ id: 'delivery', title: 'DORA' }),
    flow: makeScorecard({
      id: 'flow',
      title: 'Flow',
      status: 'fail',
      score: 40,
      cappedBy: 'review-latency',
      metrics: [
        makeMetric({
          key: 'review-latency',
          label: 'Review latency',
          value: 30,
          status: 'bad',
          band: null,
          trend: 6,
          summary: 'Median 30 h to first review',
        }),
      ],
      reasons: ['Review latency 30 h is over the 24 h limit'],
    }),
    doraResult: {
      windowDays: 30,
      minSample: 5,
      metrics: {
        deploymentFrequency: { ...DORA_METRIC, band: 'elite' },
        changeLeadTime: DORA_METRIC,
        changeFailureRate: { ...DORA_METRIC, value: 0.1, band: 'medium' },
        recoveryTime: {
          ...DORA_METRIC,
          value: null,
          band: null,
          status: 'insufficient',
          sampleSize: 1,
        },
        reworkRate: { ...DORA_METRIC, value: 0.05, band: null },
      },
    },
    flowResult: {
      windowDays: 30,
      staleAfterDays: 7,
      merged: 14,
      cycleTime: {
        coding: DURATION,
        pickup: { ...DURATION, medianHours: 6, p75Hours: 12 },
        review: { ...DURATION, medianHours: null, p75Hours: null, sampleSize: 0 },
        deploy: { ...DURATION, medianHours: 1, p75Hours: 1.5 },
      },
      reviewLatency: DURATION,
      firstReviewWithinDay: { count: 8, total: 14 },
      sizes: { XS: 2, S: 5, M: 4, L: 2, XL: 1 },
      workInProgress: 3,
      stale: [{ number: 41, daysIdle: 12 }],
      mergedWithoutReview: {
        count: 1,
        merged: 14,
        rate: { estimate: 0.07, low: 0.01, high: 0.3 },
      },
    },
    stalePullRequests: [{ number: 41, title: 'Refactor the importer', daysIdle: 12 }],
    counts: { deployments: 18, pullRequests: 14, incidents: 1 },
    sync: {
      configured: true,
      enabled: true,
      lastSyncedAt: '2026-10-23T11:00:00.000Z',
      lastStatus: 'ok',
      lastError: null,
      rateLimitedUntil: null,
      latest: {
        id: SYNC_UUID,
        status: 'done',
        requestedBy: 'schedule',
        errorCode: null,
        createdAt: '2026-10-23T10:59:00.000Z',
        finishedAt: '2026-10-23T11:00:00.000Z',
      },
    },
    ...overrides,
  });
}

export function makeDeliverySource(overrides: Partial<DeliverySource> = {}): DeliverySource {
  return DeliverySourceSchema.parse({
    projectId: PROJECT_UUID,
    provider: 'github',
    configured: true,
    enabled: true,
    cadence: 'daily',
    productionEnvironments: ['production'],
    markers: {
      rollbackLabels: ['rollback'],
      hotfixLabels: ['hotfix'],
      rollbackBranchPrefixes: ['revert-'],
      hotfixBranchPrefixes: ['hotfix/'],
    },
    deployWorkflows: ['Deploy'],
    repository: { owner: 'acme', repo: 'service' },
    lastSyncedAt: '2026-10-23T11:00:00.000Z',
    lastStatus: 'ok',
    lastError: null,
    rateLimitedUntil: null,
    nextSyncAt: '2026-10-24T11:00:00.000Z',
    streams: {},
    ...overrides,
  });
}

export function makePortfolioDelivery(
  overrides: Partial<PortfolioDelivery> = {},
): PortfolioDelivery {
  return PortfolioDeliverySchema.parse({
    windowDays: 30,
    evaluatedAt: EVALUATED_AT,
    projects: [
      {
        projectId: PROJECT_UUID,
        name: 'Service',
        slug: 'service',
        dora: {
          status: 'pass',
          score: 82,
          cappedBy: 'lead-time',
          tiers: {
            deploymentFrequency: 'elite',
            changeLeadTime: 'high',
            changeFailureRate: null,
            recoveryTime: 'low',
          },
        },
        flow: { status: 'fail', score: 40 },
      },
    ],
    ...overrides,
  });
}

const RATE = {
  successes: 1,
  trials: 10,
  rate: 0.1,
  interval: { estimate: 0.1, low: 0.02, high: 0.4 },
} as const;
const NO_RATE = { successes: 0, trials: 0, rate: null, interval: null } as const;

function outcomeGroup(n: number, measured: boolean) {
  const rate = measured ? RATE : NO_RATE;
  return {
    n,
    revert: rate,
    changeFailure: rate,
    followUpFix14: rate,
    followUpFix30: rate,
    reviewDepth: { value: measured ? 2.5 : null, sampleSize: n },
    rubberStamp: rate,
    diffCoverage: { value: measured ? 81 : null, sampleSize: n },
    newHighFindings: { value: measured ? 0 : null, sampleSize: n },
    vsHuman: measured
      ? {
          revert: 'higher',
          changeFailure: 'same',
          followUpFix14: 'lower',
          followUpFix30: 'insufficient',
          rubberStamp: 'same',
        }
      : null,
  };
}

export function makeAiCodeReport(overrides: Partial<AiCodeReport> = {}): AiCodeReport {
  return AiCodeReportSchema.parse({
    projectId: PROJECT_UUID,
    windowDays: 90,
    evaluatedAt: EVALUATED_AT,
    signatureVersion: '2026-10',
    staleAttribution: 0,
    scorecard: makeScorecard({
      id: 'ai-code',
      title: 'AI-written code',
      dimension: 'ai-governance',
      metrics: [
        makeMetric({
          key: 'ai-share',
          label: 'Share of change written with AI',
          value: 35,
          unit: 'percent',
          direction: 'higher-better',
          target: null,
          trend: 5,
          band: null,
          summary: '35% of merged change',
        }),
      ],
      cappedBy: 'ai-share',
    }),
    comparison: {
      evaluatedAt: EVALUATED_AT,
      windowDays: 90,
      minSample: 5,
      total: 30,
      excluded: 1,
      groups: {
        'agent-authored': outcomeGroup(10, true),
        'ai-assisted': outcomeGroup(2, false),
        human: outcomeGroup(15, true),
        unknown: outcomeGroup(3, false),
      },
      agents: [{ ...outcomeGroup(8, true), agent: 'claude-code' }],
    },
    share: [
      {
        weekStart: '2026-10-12',
        agentAuthored: 2,
        aiAssisted: 1,
        human: 4,
        unknown: 1,
        total: 8,
      },
      { weekStart: '2026-10-19', agentAuthored: 0, aiAssisted: 0, human: 0, unknown: 0, total: 0 },
    ],
    ...overrides,
  });
}

export function makeAiPullRequests(
  overrides: Partial<AiCodePullRequestList> = {},
): AiCodePullRequestList {
  return AiCodePullRequestListSchema.parse({
    items: [
      {
        number: 12,
        title: 'Add the importer',
        state: 'merged',
        attribution: 'agent-authored',
        agent: 'claude-code',
        confidence: 0.95,
        signals: [{ kind: 'trailer', detail: 'Co-authored-by: Claude' }],
        attributionVersion: '2026-10',
        openedAt: '2026-10-20T10:00:00.000Z',
        mergedAt: '2026-10-21T10:00:00.000Z',
      },
      {
        number: 13,
        title: 'Fix a typo',
        state: 'open',
        attribution: 'human',
        agent: null,
        confidence: 0.6,
        signals: [],
        attributionVersion: null,
        openedAt: '2026-10-22T10:00:00.000Z',
        mergedAt: null,
      },
    ],
    total: 2,
    offset: 0,
    limit: 25,
    ...overrides,
  });
}

const EVAL_TOTALS = {
  cases: 2,
  attempts: 6,
  passed: 4,
  failed: 2,
  errors: 0,
  tokensInput: 1200,
  tokensOutput: 300,
  costUsd: 0.012,
  meanLatencyMs: 850,
} as const;

function evalRun(id: string, branch: string) {
  return {
    id,
    projectId: 'project-1',
    branch,
    commitSha: 'abcdef1',
    suite: 'answers',
    format: 'promptfoo-json',
    source: 'ci',
    tool: { name: 'promptfoo', version: '0.90.0' },
    model: 'gpt-x',
    provider: 'openai',
    configHash: 'cfg1',
    totals: EVAL_TOTALS,
    truncated: false,
    receivedAt: EVALUATED_AT,
  } as const;
}

export function makeProjectEvals(overrides: Partial<ProjectEvals> = {}): ProjectEvals {
  return ProjectEvalsSchema.parse({
    projectId: 'project-1',
    branch: 'feature/x',
    defaultBranch: 'main',
    evaluatedAt: EVALUATED_AT,
    suites: [
      {
        suite: 'answers',
        latest: evalRun('eval-2', 'feature/x'),
        baseline: evalRun('eval-1', 'main'),
        comparison: {
          verdict: 'fail',
          overall: {
            baseline: { estimate: 0.9, low: 0.8, high: 0.95 },
            candidate: { estimate: 0.66, low: 0.5, high: 0.8 },
            change: 'lower',
          },
          regressions: [
            {
              caseId: 'refund-policy',
              baselinePassRate: 1,
              candidatePassRate: 0.33,
              significant: true,
            },
            { caseId: 'greeting', baselinePassRate: 1, candidatePassRate: 0.9, significant: false },
          ],
          improvements: [],
          newCases: [],
          removedCases: [],
          flaky: ['shipping-times'],
          metricChanges: [],
          reasons: ['refund-policy regressed from 100% to 33%'],
        },
        scorecard: makeScorecard({
          id: 'agent-quality',
          title: 'Eval: answers',
          dimension: 'agent-quality',
          status: 'fail',
          score: 66,
          cappedBy: 'pass-rate',
          metrics: [
            makeMetric({
              key: 'pass-rate',
              label: 'Eval pass rate',
              value: 66,
              unit: 'percent',
              direction: 'higher-better',
              target: 90,
              trend: null,
              band: null,
              status: 'bad',
              summary: '4 of 6 attempts passed',
            }),
          ],
          reasons: ['refund-policy regressed from 100% to 33%'],
        }),
      },
    ],
    runs: [evalRun('eval-2', 'feature/x')],
    ...overrides,
  });
}

export function makeEvalRunDetail(overrides: Partial<EvalRunDetail> = {}): EvalRunDetail {
  return EvalRunDetailSchema.parse({
    ...evalRun('eval-2', 'feature/x'),
    cases: [
      {
        caseId: 'refund-policy',
        label: 'Refund policy',
        promptHash: 'sha256:abc',
        prompt: null,
        attempts: [
          {
            epoch: 0,
            passed: false,
            error: null,
            scores: [{ metric: 'contains', score: 0, threshold: 1, passed: false }],
            latencyMs: 900,
            tokensInput: 200,
            tokensOutput: 50,
            costUsd: 0.002,
          },
        ],
      },
    ],
    ...overrides,
  });
}

function runtimeStats(runs: number) {
  return {
    runs,
    inputTokens: 10_000,
    outputTokens: 2_000,
    cost: { knownUsd: 1.25, unknownSpans: 0, pricedSpans: runs },
    costPerRunUsd: runs === 0 ? null : 1.25 / runs,
    tokensPerRun: runs === 0 ? null : 12_000 / runs,
    latency: { p50Ms: 1_200, p95Ms: 4_800 },
    errors: { failed: 1, rate: { estimate: 0.1, low: 0.02, high: 0.4 } },
    toolCalls: {
      total: 40,
      failed: 2,
      rate: { estimate: 0.05, low: 0.01, high: 0.16 },
      topFailingTool: { name: 'search', failures: 2 },
    },
    meanTrajectoryLength: 6.5,
    loops: 1,
  };
}

function runtimeRow(key: string, runs: number) {
  return { key, current: runtimeStats(runs), previous: null, change: null };
}

export function makeRuntimeReport(overrides: Partial<AgentRuntimeReport> = {}): AgentRuntimeReport {
  return AgentRuntimeReportSchema.parse({
    projectId: 'project-1',
    days: 7,
    evaluatedAt: EVALUATED_AT,
    truncated: false,
    runtime: {
      window: { from: '2026-10-16T00:00:00.000Z', to: EVALUATED_AT, days: 7 },
      previous: false,
      overall: runtimeRow('overall', 10),
      agents: [runtimeRow('support-bot', 10)],
      models: [runtimeRow('gpt-x', 10)],
      loops: [
        {
          traceId: 'trace-1',
          runSpanId: null,
          agent: 'support-bot',
          toolName: 'search',
          toolArgsHash: 'h1',
          count: 4,
          spanIds: ['s1', 's2', 's3', 's4'],
        },
      ],
      outsideWindow: 0,
    },
    scorecard: makeScorecard({
      id: 'agent-quality',
      title: 'Agent runtime',
      dimension: 'agent-quality',
      status: 'pass',
      score: 90,
      cappedBy: 'p95-latency',
      metrics: [
        makeMetric({
          key: 'p95-latency',
          label: 'p95 agent run latency',
          value: 4_800,
          unit: 'ms',
          target: 10_000,
          trend: null,
          band: null,
          summary: 'p95 4.8 s over 10 runs',
        }),
      ],
    }),
    ...overrides,
  });
}

export function makeMcpServers(overrides: Partial<McpServerList> = {}): McpServerList {
  return McpServerListSchema.parse({
    projectId: 'project-1',
    branch: 'main',
    servers: [
      {
        name: 'github',
        configPath: '.vscode/mcp.json',
        transport: 'stdio',
        command: 'npx',
        package: '@modelcontextprotocol/server-github',
        version: '1.2.0',
        pinned: true,
        url: null,
        envKeys: ['GITHUB_TOKEN'],
        commitSha: 'abcdef1',
        scannedAt: EVALUATED_AT,
      },
      {
        name: 'docs',
        configPath: '.cursor/mcp.json',
        transport: 'http',
        command: null,
        package: null,
        version: null,
        pinned: false,
        url: 'https://mcp.example.test',
        envKeys: [],
        commitSha: null,
        scannedAt: EVALUATED_AT,
      },
    ],
    ...overrides,
  });
}

export function makeDatasets(overrides: Partial<EvalDatasetList> = {}): EvalDatasetList {
  return EvalDatasetListSchema.parse({
    projectId: 'project-1',
    datasets: [
      {
        id: 'ds-1',
        projectId: 'project-1',
        name: 'support answers',
        model: 'gpt-x',
        repeats: 3,
        judge: null,
        cases: [
          {
            id: 'c1',
            input: 'How do refunds work?',
            checks: [{ type: 'contains', value: 'refund' }],
          },
        ],
        updatedAt: EVALUATED_AT,
      },
    ],
    ...overrides,
  });
}

export function makeComponentsPage(
  overrides: Partial<SbomComponentsPage> = {},
): SbomComponentsPage {
  return SbomComponentsPageSchema.parse({
    branch: 'main',
    components: [
      {
        purl: 'pkg:npm/react@19.0.0',
        name: 'react',
        version: '19.0.0',
        type: 'library',
        licences: ['MIT'],
        licenceExpression: null,
        supplier: 'Meta',
        branch: 'main',
        reportId: 'r1',
      },
      {
        purl: null,
        name: 'vendored-lib',
        version: null,
        type: 'file',
        licences: [],
        licenceExpression: null,
        supplier: null,
        branch: 'main',
        reportId: 'r1',
      },
    ],
    total: 2,
    offset: 0,
    limit: 25,
    ...overrides,
  });
}

export function makePolicyRecord(
  overrides: Partial<SupplyChainPolicyRecord> = {},
): SupplyChainPolicyRecord {
  return SupplyChainPolicyRecordSchema.parse({
    projectId: 'project-1',
    policy: {
      licences: { allow: ['MIT', 'Apache-2.0'], deny: ['GPL-3.0-only'], failOnUnknown: true },
      provenance: {
        allowedBuilders: ['https://github.com/actions/runner'],
        trustedKeysPem: ['-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----'],
        trustedRootsPem: [],
      },
    },
    updatedAt: EVALUATED_AT,
    updatedBy: 'admin',
    ...overrides,
  });
}

export function makeDiffCoverage(overrides: Partial<DiffCoverageStatus> = {}): DiffCoverageStatus {
  return DiffCoverageStatusSchema.parse({
    projectId: 'project-1',
    commit: 'abcdef1',
    branch: 'main',
    state: 'computed',
    result: {
      covered: 8,
      executable: 10,
      ratio: 0.8,
      uncovered: [{ path: 'src/a.ts', lines: [4, 9] }],
      unmeasuredFiles: ['src/b.md'],
      computedAt: EVALUATED_AT,
    },
    ...overrides,
  });
}

/**
 * A health client double for the scorecard pages: their gate reads `whoami`, and everything
 * else refuses loudly unless a test overrides it.
 */
export function makeHealthDouble(
  role: 'viewer' | 'operator' | 'admin' = 'operator',
  overrides: Partial<HealthClient> = {},
): HealthClient {
  const never = async (): Promise<never> => {
    throw new Error('not stubbed');
  };
  return {
    getPortfolio: vi.fn(never),
    getHeatmap: vi.fn(never),
    getTestEffectiveness: vi.fn(never),
    getHealth: vi.fn(never),
    getFindings: vi.fn(never),
    getHistory: vi.fn(never),
    triage: vi.fn(never),
    startScan: vi.fn(never),
    whoami: vi.fn(async () => ({ actor: 'someone', role, mode: 'enforced' as const })),
    signIn: vi.fn(never),
    signOut: vi.fn(never),
    listTokens: vi.fn(never),
    createToken: vi.fn(never),
    revokeToken: vi.fn(never),
    issuePairingCode: vi.fn(never),
    pair: vi.fn(never),
    getSettings: vi.fn(never),
    setSchedule: vi.fn(never),
    setAlerts: vi.fn(never),
    ...overrides,
  };
}

/** A request that never settles, for asserting a loading state. */
export function pending<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/** A client error the way `parse` raises one: a status and the server's own sentence. */
export function serverRefusal(detail: string, status = 500): Error & { detail: string } {
  return Object.assign(new Error(`API answered ${String(status)}`), { status, detail });
}

/** A canonical run result as `GET /api/v1/reporting/runs/:id` answers it, contract version 2. */
export function makeCanonicalRunResult() {
  return {
    contractVersion: '2',
    identity: { runId: 'run-1', workspaceId: 'workspace-1' },
    status: 'passed',
    startedAt: '2026-09-25T00:00:00.000Z',
    attempts: [
      {
        index: 1,
        testId: 'test-1',
        specPath: 'tests/example.spec.ts',
        title: 'Example',
        status: 'passed',
        rawStatus: 'passed',
        startedAt: '2026-09-25T00:00:00.000Z',
        evidence: [],
        flakiness: 'unknown',
      },
    ],
    evidence: [],
    provenance: {
      producer: 'playwright',
      producerVersion: '1',
      adapterVersion: '1',
      sourceDigest: 'a'.repeat(64),
      sourceUri: 'artifact://run/report.json',
    },
    retention: { class: 'standard' },
    proof: { state: 'verified', digest: 'a'.repeat(64), verifier: 'test' },
    completeness: { state: 'complete', missingShards: [], duplicateShards: [] },
    raw: {},
  };
}

/** One dimension of a grade, unmeasured unless told otherwise. */
export function makeDimension(
  overrides: Partial<DimensionScore> & Pick<DimensionScore, 'dimension'>,
): DimensionScore {
  return {
    measured: false,
    score: null,
    letter: null,
    weight: 10,
    tools: [],
    openFindings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    summary: [],
    ...overrides,
  };
}

/**
 * `GET /projects/:id/health` for a repository graded C: Security measured, Supply chain
 * measured from a provenance attestation, two fix-next items.
 */
export function makeProjectHealth(
  overrides: { grade?: Partial<HealthGrade>; reports?: ProjectHealth['reports'] } = {},
): ProjectHealth {
  const dimensions = HEALTH_DIMENSIONS.map((name) => {
    if (name === 'security') {
      return makeDimension({
        dimension: name,
        measured: true,
        score: 70,
        letter: 'C',
        summary: ['2 high open'],
      });
    }
    if (name === 'supply-chain') {
      return makeDimension({
        dimension: name,
        measured: true,
        score: 80,
        letter: 'B',
        summary: ['SLSA build level 2: signed by a trusted key'],
      });
    }
    return makeDimension({ dimension: name, weight: name === 'delivery' ? 0 : 10 });
  });
  return ProjectHealthSchema.parse({
    projectId: TEST_PROJECT.id,
    name: TEST_PROJECT.name,
    branch: 'main',
    evaluatedAt: EVALUATED_AT,
    grade: {
      score: 74,
      letter: 'C',
      incomplete: false,
      incompleteReason: null,
      cappedBy: 'security',
      cappingValue: 70,
      limiter: 'Limited by Security — 2 high open',
      dimensions,
      gates: [
        { id: 'open-secret', tripped: false, enabled: true, statement: 'No open secret' },
        {
          id: 'fixable-critical-vulnerability',
          tripped: false,
          enabled: true,
          statement: 'No fixable critical',
        },
        { id: 'failing-tests', tripped: false, enabled: true, statement: 'No failing tests' },
      ],
      fixNext: [
        {
          key: 'rule:security:semgrep:sqli',
          dimension: 'security',
          title: 'Fix 2 SQL injection findings',
          findings: 2,
          gain: 6.5,
          helpUri: 'https://semgrep.dev/r/sqli',
        },
      ],
      ...overrides.grade,
    },
    reports: overrides.reports ?? [
      {
        id: 'report-slsa',
        format: 'slsa-provenance',
        source: 'ci',
        toolKey: 'slsa',
        tools: [{ name: 'slsa-github-generator', version: '2.0.0' }],
        commitSha: 'abcdef1234567',
        findingCount: 0,
        receivedAt: EVALUATED_AT,
      },
    ],
  });
}

export function makeFinding(overrides: Partial<HealthFinding> = {}): HealthFinding {
  return HealthFindingSchema.parse({
    id: 'finding-1',
    fingerprint: 'fp-1',
    tool: 'automate-licence',
    ruleId: 'licence-denied:GPL-3.0-only',
    kind: 'issue',
    severity: 'high',
    dimension: 'dependencies',
    path: null,
    line: null,
    message: 'left-pad 1.0.0 is GPL-3.0-only, which the policy denies',
    helpUri: null,
    fixAvailable: null,
    branch: 'main',
    state: 'open',
    triageReason: null,
    triageExpiresAt: null,
    triagedBy: null,
    owner: null,
    firstSeenAt: EVALUATED_AT,
    lastSeenAt: EVALUATED_AT,
    ...overrides,
  });
}

export function makeFindingsPage(findings: HealthFinding[]): HealthFindingsPage {
  return HealthFindingsPageSchema.parse({
    findings,
    total: findings.length,
    offset: 0,
    limit: 100,
  });
}

export function makePortfolioAiCode(overrides: Partial<PortfolioAiCode> = {}): PortfolioAiCode {
  return PortfolioAiCodeSchema.parse({
    windowDays: 90,
    evaluatedAt: EVALUATED_AT,
    projects: [
      {
        projectId: PROJECT_UUID,
        name: 'Service',
        slug: 'service',
        changes: 20,
        aiShare: 35,
        scorecard: { status: 'pass', score: 80 },
      },
    ],
    ...overrides,
  });
}
