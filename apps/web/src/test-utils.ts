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

export function makeApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn(),
    createRun: vi.fn(),
    cancelRun: vi.fn(),
    retryRun: vi.fn(),
    getRunArtifacts: vi.fn().mockResolvedValue([]),
    getRunGate: vi.fn().mockResolvedValue(null),
    getReleaseReadiness: vi.fn().mockResolvedValue(null),
    getAnalyticsSummary: vi.fn(),
    getQuarantine: vi.fn(),
    addQuarantine: vi.fn(),
    subscribeToRunEvents: vi.fn(() => () => undefined),
    ...overrides,
  };
}
