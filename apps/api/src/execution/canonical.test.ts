import { describe, expect, it } from 'vitest';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { toCanonicalRun } from './canonical.js';

const base = {
  id: 'run-1',
  externalId: null,
  source: 'api',
  framework: null,
  adapterVersion: null,
  testType: 'browser',
  projectId: null,
  environmentId: null,
  releaseId: null,
  branch: null,
  commit: null,
  suite: null,
  selection: [],
  timeoutMs: 1000,
  priority: 0,
  requiredCapabilities: [],
  labels: [],
  configuration: {},
  policyId: null,
  idempotencyKey: 'key',
  workspaceId: 'workspace',
  attempt: 1,
  retryOfRunId: null,
  phase: 'complete' as const,
  outcome: 'passed' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
  startedAt: null,
  completedAt: '2026-01-01T00:00:01.000Z',
  runner: null,
  tests: [
    {
      id: 'test',
      title: 'Test',
      file: null,
      status: 'passed' as const,
      durationMs: 1,
      attempt: 1,
      error: null,
      metadata: {},
    },
  ],
  summary: {
    total: 1,
    passed: 1,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: 1,
  },
  error: null,
  rawEvidenceRefs: [],
  artifacts: [],
  policyEvaluation: null,
  status: 'passed',
};

describe('canonical execution projections', () => {
  it('adds canonical attempt and artifact defaults', () => {
    const result = toCanonicalRun(base as never);
    expect(result.tests[0]?.attempts).toHaveLength(1);
    expect(result.tests[0]?.artifactIds).toEqual([]);
    expect(result.finishedAt).toBe(base.completedAt);
  });

  it('projects runner, error, artifact, and gate fields', () => {
    const result = toCanonicalRun({
      ...base,
      runner: {
        id: 'runner',
        name: 'runner',
        version: '1',
        os: 'linux',
        arch: 'x64',
        health: 'healthy',
        lastHeartbeatAt: null,
        capabilities: ['playwright'],
      },
      tests: [{ ...base.tests[0], title: '', error: { code: 'FAILED', message: 'boom' } }],
      error: { message: 'run error' },
      artifacts: [
        {
          id: 'artifact',
          runId: 'run-1',
          jobId: 'job-1',
          testId: null,
          kind: 'report',
          name: 'report.json',
          contentType: 'application/json',
          sizeBytes: 2,
          checksum: 'a'.repeat(64),
          storageKey: 'runs/run-1/report.json',
          createdAt: '2026-01-01T00:00:01.000Z',
          expiresAt: null,
          legalHold: false,
          metadata: {},
        },
      ],
      policyEvaluation: {
        id: 'gate',
        runId: 'run-1',
        releaseId: null,
        policyId: 'policy',
        policyVersion: '1',
        policyHash: 'a'.repeat(64),
        status: 'passed',
        decision: 'ready',
        reasons: [],
        evidenceRefs: [],
        domainStatuses: { browser: 'passed' },
        evaluatedAt: '2026-01-01T00:00:01.000Z',
      },
    } as never);
    expect(result.runner?.id).toBe('runner');
    expect(result.tests[0]?.error?.code).toBe('FAILED');
    expect(result.error?.code).toBe('EXECUTION_ERROR');
    expect(result.artifacts).toHaveLength(1);
    expect(result.policyEvaluation?.status).toBe('passed');
  });

  it('raises a classified error, not a bare ZodError, for a row the contract rejects', () => {
    // `.parse()` threw a `ZodError` with no code and no status, which through the
    // boundary became an indistinguishable 500 — the same response a genuine
    // defect produces, so the offending field could not be found.
    let captured: unknown;
    try {
      toCanonicalRun({ ...base, phase: 'not-a-phase' } as never);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(DomainError);
    const error = captured as DomainError;
    expect(error.code).toBe(ErrorCode.RUN_SERIALIZATION_FAILED);
    expect(error.status).toBe(500);
    // The issue path identifies the field, and belongs in the log only.
    expect(error.logDetail).toContain('phase');
    expect(error.message).not.toContain('phase');
    expect(error.cause).toBeDefined();
  });

  it('reports an artifact descriptor the contract rejects the same way', () => {
    // An artifact with no `storageKey` is not addressable, so the canonical
    // descriptor schema refuses it — and the refusal has to be classified.
    const broken = {
      ...base,
      artifacts: [{ kind: 'log', name: 'a.log', contentType: 'text/plain', sizeBytes: 1 }],
    } as unknown as Parameters<typeof toCanonicalRun>[0];
    let captured: unknown;
    try {
      toCanonicalRun(broken);
    } catch (error) {
      captured = error;
    }
    expect(captured).toBeInstanceOf(DomainError);
    expect((captured as DomainError).code).toBe(ErrorCode.RUN_SERIALIZATION_FAILED);
  });
});
