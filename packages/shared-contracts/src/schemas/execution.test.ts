import { describe, expect, it } from 'vitest';
import {
  ArtifactDescriptorSchema,
  AttemptResultSchema,
  CanonicalTestResultSchema,
  CanonicalTestStatusSchema,
  CreateRunRequestSchema,
  GateEvaluationSchema,
  GateStatusSchema,
  IntegrationMaturitySchema,
  JobClaimSchema,
  JobCompletionSchema,
  JobEventBatchSchema,
  NormalizedRunSchema,
  QualityPolicySchema,
  ReleaseReadinessSchema,
  RunEventEnvelopeSchema,
  RunOutcomeSchema,
  RunPhaseSchema,
  RunnerHeartbeatSchema,
  RunnerManifestSchema,
  RunnerRegistrationSchema,
  TestSelectionSchema,
} from './index.js';

const timestamp = '2026-09-25T00:00:00.000Z';
const digest = 'a'.repeat(64);

const artifact = {
  id: 'artifact-1',
  runId: 'run-1',
  jobId: 'job-1',
  testId: 'test-1',
  attempt: 1,
  kind: 'trace',
  name: 'trace.zip',
  contentType: 'application/zip',
  storageKey: 'runs/run-1/trace.zip',
  checksum: digest,
  sizeBytes: 42,
  createdAt: timestamp,
  expiresAt: null,
  legalHold: false,
  metadata: { sharded: false },
};

const summary = {
  total: 1,
  passed: 1,
  failed: 0,
  flaky: 0,
  skipped: 0,
  blocked: 0,
  unknown: 0,
  durationMs: 25,
};

const gate = {
  id: 'gate-1',
  runId: 'run-1',
  releaseId: 'release-1',
  policyId: 'policy-1',
  policyVersion: '1',
  policyHash: digest,
  status: 'passed',
  decision: 'ready',
  reasons: [],
  evidenceRefs: ['artifact-1'],
  domainStatuses: {
    browser: 'passed',
    api: 'not_configured',
    mobile: 'not_configured',
    performance: 'not_configured',
    security: 'not_configured',
    accessibility: 'not_configured',
    other: 'not_configured',
  },
  evaluatedAt: timestamp,
} as const;

const attempt = {
  attempt: 1,
  status: 'passed',
  startedAt: timestamp,
  finishedAt: timestamp,
  durationMs: 25,
  error: null,
  artifactIds: ['artifact-1'],
  rawStatus: 'passed',
  metadata: {},
};

const testResult = {
  id: 'test-result-1',
  testId: 'test-1',
  title: 'loads the dashboard',
  suite: 'dashboard',
  file: 'tests/dashboard.spec.ts',
  status: 'passed',
  startedAt: timestamp,
  finishedAt: timestamp,
  durationMs: 25,
  error: null,
  attempts: [attempt],
  artifactIds: ['artifact-1'],
  metadata: {},
};

const normalizedRun = {
  id: 'run-1',
  externalId: 'reporter-run-1',
  source: 'playwright',
  framework: 'playwright',
  adapterVersion: '1.0.0',
  testType: 'browser',
  projectId: 'project-1',
  environmentId: 'environment-1',
  releaseId: 'release-1',
  branch: 'main',
  commit: 'abc123',
  suite: 'dashboard',
  selection: ['tests/dashboard.spec.ts'],
  timeoutMs: 60_000,
  priority: 0,
  requiredCapabilities: ['playwright'],
  labels: ['browser'],
  configuration: { browser: 'chromium' },
  policyId: 'policy-1',
  idempotencyKey: 'request-1',
  workspaceId: 'workspace-1',
  attempt: 1,
  retryOfRunId: null,
  tests: [testResult],
  summary,
  phase: 'complete',
  outcome: 'passed',
  createdAt: timestamp,
  updatedAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  finishedAt: timestamp,
  runner: {
    id: 'runner-1',
    name: 'runner',
    version: '1.0.0',
    os: 'linux',
    arch: 'x64',
    health: 'healthy',
    lastHeartbeatAt: timestamp,
    capabilities: ['playwright'],
  },
  error: null,
  rawEvidenceRefs: ['report-1'],
  artifacts: [artifact],
  policyEvaluation: gate,
  status: 'passed',
};

const runStartedEvent = {
  version: '1',
  eventId: 'event-1',
  sequence: 1,
  occurredAt: timestamp,
  runId: 'run-1',
  type: 'run.started',
  payload: {
    externalId: 'reporter-run-1',
    phase: 'running',
    outcome: null,
    startedAt: timestamp,
    branch: 'main',
    commit: 'abc123',
    total: 1,
  },
} as const;

const manifest = {
  id: 'runner-1',
  name: 'playwright-runner',
  version: '1.0.0',
  os: 'linux',
  arch: 'x64',
  capabilities: ['playwright', 'chromium'],
  labels: ['browser'],
  slots: 2,
  protocolVersion: '1',
} as const;

describe('canonical execution dimensions', () => {
  it('separates phase, outcome, test, and gate vocabularies', () => {
    expect(RunPhaseSchema.parse('infra_failed')).toBe('infra_failed');
    expect(RunPhaseSchema.safeParse('failed').success).toBe(false);
    expect(RunOutcomeSchema.parse(null)).toBeNull();
    expect(RunOutcomeSchema.parse('infra_failed')).toBe('infra_failed');
    expect(RunOutcomeSchema.safeParse('running').success).toBe(false);
    expect(CanonicalTestStatusSchema.options).toContain('timed_out');
    expect(CanonicalTestStatusSchema.safeParse('timedOut').success).toBe(false);
    expect(GateStatusSchema.parse('not_evaluated')).toBe('not_evaluated');
    expect(GateStatusSchema.safeParse('not_configured').success).toBe(false);
  });

  it('accepts create requests with array or structured selection', () => {
    const base = {
      projectId: 'project-1',
      environmentId: 'environment-1',
      releaseId: 'release-1',
      branch: 'main',
      commit: 'abc123',
      idempotencyKey: 'request-1',
    };
    expect(CreateRunRequestSchema.parse(base).selection).toEqual([]);
    expect(CreateRunRequestSchema.parse({ ...base, selection: ['test-1'] }).selection).toEqual([
      'test-1',
    ]);
    const structured = CreateRunRequestSchema.parse({
      ...base,
      selection: { testIds: ['test-1'], paths: ['tests/dashboard.spec.ts'], tags: ['smoke'] },
    });
    expect(structured.selection).toMatchObject({ testIds: ['test-1'] });
    expect(TestSelectionSchema.parse({}).testIds).toEqual([]);
    expect(CreateRunRequestSchema.safeParse({ ...base, timeoutMs: 0 }).success).toBe(false);
  });

  it('parses normalized tests, attempts, artifacts, and infrastructure outcomes', () => {
    expect(AttemptResultSchema.parse(attempt).status).toBe('passed');
    expect(CanonicalTestResultSchema.parse(testResult).attempts).toHaveLength(1);
    expect(ArtifactDescriptorSchema.parse(artifact).checksum).toHaveLength(64);
    const parsed = NormalizedRunSchema.parse({
      ...normalizedRun,
      phase: 'infra_failed',
      outcome: 'infra_failed',
    });
    expect(parsed.phase).not.toBe('complete');
    expect(parsed.outcome).not.toBe('failed');
    expect(NormalizedRunSchema.safeParse({ ...normalizedRun, createdAt: 'invalid' }).success).toBe(
      false,
    );
    expect(
      ArtifactDescriptorSchema.safeParse({ ...artifact, checksum: 'not-a-digest' }).success,
    ).toBe(false);
  });

  it('validates typed, sequenced, versioned run event envelopes', () => {
    expect(RunEventEnvelopeSchema.parse(runStartedEvent).sequence).toBe(1);
    expect(RunEventEnvelopeSchema.safeParse({ ...runStartedEvent, version: '2' }).success).toBe(
      false,
    );
    expect(RunEventEnvelopeSchema.safeParse({ ...runStartedEvent, sequence: 0 }).success).toBe(
      false,
    );
    expect(
      RunEventEnvelopeSchema.safeParse({ ...runStartedEvent, type: 'run.exploded' }).success,
    ).toBe(false);
  });

  it('parses runner registration, heartbeat, claims, batches, and completion', () => {
    expect(RunnerManifestSchema.parse(manifest).arch).toBe('x64');
    expect(
      RunnerRegistrationSchema.parse({
        runnerId: 'runner-1',
        manifest,
        token: 'short-lived-token',
        expiresAt: timestamp,
      }).token,
    ).toBe('short-lived-token');
    expect(
      RunnerHeartbeatSchema.parse({
        runnerId: 'runner-1',
        health: 'healthy',
        lastHeartbeatAt: timestamp,
        activeJobIds: ['job-1'],
      }).activeJobIds,
    ).toEqual(['job-1']);
    const claim = {
      jobId: 'job-1',
      runId: 'run-1',
      attempt: 1,
      leaseId: 'lease-1',
      fencingToken: 1,
      timeoutMs: 60_000,
      spec: { projectId: 'project-1' },
      availableAt: timestamp,
      leaseExpiresAt: timestamp,
    };
    expect(JobClaimSchema.parse(claim).runnerId).toBeUndefined();
    expect(
      JobEventBatchSchema.parse({
        jobId: 'job-1',
        runId: 'run-1',
        leaseId: 'lease-1',
        fencingToken: 1,
        events: [runStartedEvent],
      }).events,
    ).toHaveLength(1);
    expect(
      JobCompletionSchema.parse({
        jobId: 'job-1',
        runId: 'run-1',
        leaseId: 'lease-1',
        fencingToken: 1,
        attempt: 1,
        phase: 'infra_failed',
        outcome: 'infra_failed',
        error: { code: 'runner_start_failed', message: 'Chromium failed to start' },
        finishedAt: timestamp,
      }).phase,
    ).toBe('infra_failed');
  });

  it('parses quality policies, gates, readiness, and integration maturity', () => {
    const policy = QualityPolicySchema.parse({
      id: 'policy-1',
      workspaceId: 'workspace-1',
      name: 'Universal QA default',
      version: '1',
      hash: digest,
      requiredDomains: ['browser'],
      browserPassRateThreshold: 100,
      maxFlakyRate: 0,
      maxDurationMs: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    expect(policy.rules).toEqual([]);
    expect(GateEvaluationSchema.parse(gate).decision).toBe('ready');
    const readiness = ReleaseReadinessSchema.parse({
      releaseId: 'release-1',
      decision: 'ready',
      browser: 'passed',
      domains: gate.domainStatuses,
      latestRunId: 'run-1',
      gate,
      evaluatedAt: timestamp,
    });
    expect(readiness.domains.api).toBe('not_configured');
    expect(
      IntegrationMaturitySchema.parse({
        id: 'playwright',
        name: 'Playwright Test',
        domain: 'browser',
        level: 'L5',
        capabilities: ['browser'],
        adapterVersion: '1.0.0',
        evidenceStatus: 'verified',
        evidence: ['gate-1'],
        testStatus: 'passed',
        updatedAt: timestamp,
      }).level,
    ).toBe('L5');
  });
});
