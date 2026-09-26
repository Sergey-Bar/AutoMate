import { vi } from 'vitest';
import type { RunEventEnvelope } from '@automate/shared-contracts';
import type { ApiClient, Run } from './lib/api.js';

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
    addQuarantine: vi.fn(async (entry) => ({
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
