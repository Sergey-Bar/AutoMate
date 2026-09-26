import {
  ArtifactDescriptorSchema,
  NormalizedRunSchema,
  type NormalizedRun,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type {
  ArtifactDescriptor,
  ExecutionRun,
  ExecutionTestResult,
  GateEvaluation,
} from './types.js';

/**
 * Summarises a Zod failure for the log.
 *
 * The issue *paths* are safe and are what identifies the offending field; the
 * values are not, so they are never included.
 */
function describeIssues(error: unknown): string {
  const issues = (error as { issues?: Array<{ path: Array<PropertyKey>; message: string }> })
    ?.issues;
  if (!Array.isArray(issues)) return 'no issue list on the validation error';
  return issues
    .map((issue) => `${issue.path.map(String).join('.') || '<root>'}: ${issue.message}`)
    .join('; ');
}

/**
 * Validates a value against a canonical schema and, on failure, raises a
 * classified `DomainError` instead of letting a bare `ZodError` escape.
 *
 * These projections used to call `.parse()`, so a row that disagreed with the
 * canonical schema threw a `ZodError` with no code and no status. Through the
 * error boundary that became an indistinguishable 500: the same response a
 * genuine defect produces, so nobody could find the field that broke it.
 */
function parseOrClassify<T>(
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false; error: unknown };
  },
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new DomainError(
    ErrorCode.RUN_SERIALIZATION_FAILED,
    `${what} does not match the canonical contract`,
    {
      // Log-only: the paths name the field, which is what the log needs and the
      // response must not reveal about our schema.
      logDetail: describeIssues(result.error),
      cause: result.error,
    },
  );
}

function canonicalError(error: { code?: string; message: string } | null | undefined) {
  if (!error) return null;
  return { code: error.code ?? 'EXECUTION_ERROR', message: error.message };
}

function canonicalTest(test: ExecutionTestResult) {
  const error = canonicalError(test.error);
  return {
    id: test.id,
    testId: test.id,
    title: test.title || test.id,
    file: test.file ?? null,
    status: test.status,
    startedAt: null,
    finishedAt: null,
    durationMs: test.durationMs ?? null,
    error,
    attempts: [
      {
        attempt: test.attempt ?? 1,
        status: test.status,
        startedAt: null,
        finishedAt: null,
        durationMs: test.durationMs ?? null,
        error,
        artifactIds: [],
        metadata: test.metadata ?? {},
      },
    ],
    artifactIds: [],
    metadata: test.metadata ?? {},
  };
}

function canonicalArtifact(artifact: ArtifactDescriptor) {
  return parseOrClassify(ArtifactDescriptorSchema, artifact, 'an artifact descriptor');
}

function canonicalGate(gate: GateEvaluation | null) {
  if (!gate) return null;
  return {
    id: gate.id,
    runId: gate.runId,
    releaseId: gate.releaseId,
    policyId: gate.policyId,
    policyVersion: gate.policyVersion,
    policyHash: gate.policyHash,
    status: gate.status,
    decision: gate.decision,
    reasons: gate.reasons,
    evidenceRefs: gate.evidenceRefs,
    domainStatuses: {
      browser: gate.domainStatuses.browser ?? 'unknown',
      api: gate.domainStatuses.api ?? 'unknown',
      mobile: gate.domainStatuses.mobile ?? 'unknown',
      performance: gate.domainStatuses.performance ?? 'unknown',
      security: gate.domainStatuses.security ?? 'unknown',
      accessibility: gate.domainStatuses.accessibility ?? 'unknown',
      other: gate.domainStatuses.other ?? 'unknown',
    },
    evaluatedAt: gate.evaluatedAt,
  };
}

export function toCanonicalRun(run: ExecutionRun): NormalizedRun {
  return parseOrClassify(
    NormalizedRunSchema,
    {
      id: run.id,
      externalId: run.externalId,
      source: run.source,
      framework: run.framework,
      adapterVersion: run.adapterVersion,
      testType: run.testType,
      projectId: run.projectId,
      environmentId: run.environmentId,
      releaseId: run.releaseId,
      branch: run.branch,
      commit: run.commit,
      suite: run.suite,
      selection: run.selection,
      timeoutMs: run.timeoutMs,
      priority: run.priority,
      requiredCapabilities: run.requiredCapabilities,
      labels: run.labels,
      configuration: run.configuration,
      policyId: run.policyId,
      idempotencyKey: run.idempotencyKey,
      workspaceId: run.workspaceId,
      attempt: run.attempt,
      retryOfRunId: run.retryOfRunId,
      phase: run.phase,
      outcome: run.outcome,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      finishedAt: run.completedAt,
      runner: run.runner
        ? {
            id: run.runner.id,
            name: run.runner.name,
            version: run.runner.version,
            os: run.runner.os,
            arch: run.runner.arch,
            health: run.runner.health,
            lastHeartbeatAt: run.runner.lastHeartbeatAt,
            capabilities: [],
          }
        : null,
      tests: run.tests.map(canonicalTest),
      summary: run.summary,
      total: run.summary.total,
      error: canonicalError(run.error),
      rawEvidenceRefs: run.rawEvidenceRefs,
      artifacts: run.artifacts.map(canonicalArtifact),
      policyEvaluation: canonicalGate(run.policyEvaluation),
      status: run.status,
    },
    'a run',
  );
}

export function toCanonicalRuns(runs: ExecutionRun[]): NormalizedRun[] {
  return runs.map(toCanonicalRun);
}
