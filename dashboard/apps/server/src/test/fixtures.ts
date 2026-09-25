/**
 * Factory functions for creating test data.
 *
 * Usage:
 *   const run = fixtures.run({ status: 'passed' });
 *   db.insert(schema.runs).values(run).run();
 */
import { randomUUID } from 'crypto';

// ─── Runs ────────────────────────────────────────────────────────────────
export interface RunOverrides {
  id?: string;
  startedAt?: string;
  finishedAt?: string | null;
  status?: 'running' | 'passed' | 'failed' | 'interrupted';
  total?: number;
  passed?: number;
  failed?: number;
  flaky?: number;
  skipped?: number;
  durationMs?: number | null;
  branch?: string | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  triggeredBy?: string;
  config?: string | null;
  rawArgs?: string | null;
  source?: 'live' | 'blob';
  gateStatus?: 'passed' | 'failed' | 'skipped' | null;
  workspaceId?: string | null;
  prNumber?: number | null;
  prBranch?: string | null;
  baseBranch?: string | null;
  commitAuthor?: string | null;
}

export function run(overrides: RunOverrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    finishedAt: overrides.finishedAt ?? null,
    status: overrides.status ?? 'running',
    total: overrides.total ?? 10,
    passed: overrides.passed ?? 0,
    failed: overrides.failed ?? 0,
    flaky: overrides.flaky ?? 0,
    skipped: overrides.skipped ?? 0,
    durationMs: overrides.durationMs ?? null,
    branch: overrides.branch ?? 'main',
    commitSha: overrides.commitSha ?? null,
    commitMessage: overrides.commitMessage ?? null,
    triggeredBy: overrides.triggeredBy ?? 'manual',
    config: overrides.config ?? null,
    rawArgs: overrides.rawArgs ?? null,
    source: overrides.source ?? 'live',
    gateStatus: overrides.gateStatus ?? null,
    workspaceId: overrides.workspaceId ?? null,
    prNumber: overrides.prNumber ?? null,
    prBranch: overrides.prBranch ?? null,
    baseBranch: overrides.baseBranch ?? null,
    commitAuthor: overrides.commitAuthor ?? null,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────
export interface TestOverrides {
  id?: string;
  runId?: string;
  suiteId?: string | null;
  title?: string;
  file?: string;
  line?: number | null;
  column?: number | null;
  stableId?: string | null;
  status?: 'passed' | 'failed' | 'flaky' | 'skipped' | 'timedOut' | 'running' | 'queued';
  durationMs?: number | null;
  tags?: string | null;
  annotations?: string | null;
  retryCount?: number;
  expectedStatus?: string | null;
  workerIndex?: number | null;
}

export function test(runId: string, overrides: TestOverrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    runId,
    suiteId: overrides.suiteId ?? null,
    title: overrides.title ?? 'Sample Test',
    file: overrides.file ?? 'tests/sample.spec.ts',
    line: overrides.line ?? 1,
    column: overrides.column ?? null,
    stableId: overrides.stableId ?? null,
    status: overrides.status ?? 'passed',
    durationMs: overrides.durationMs ?? 1500,
    tags: overrides.tags ?? null,
    annotations: overrides.annotations ?? null,
    retryCount: overrides.retryCount ?? 0,
    expectedStatus: overrides.expectedStatus ?? null,
    workerIndex: overrides.workerIndex ?? 0,
  };
}

// ─── Results ─────────────────────────────────────────────────────────────
export interface ResultOverrides {
  id?: string;
  testId?: string;
  runId?: string;
  retry?: number;
  status?: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  durationMs?: number | null;
  startedAt?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  workerIndex?: number | null;
  parallelIndex?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  steps?: string | null;
  attachments?: string | null;
  fingerprint?: string | null;
}

export function result(testId: string, runId: string, overrides: ResultOverrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    testId,
    runId,
    retry: overrides.retry ?? 0,
    status: overrides.status ?? 'passed',
    durationMs: overrides.durationMs ?? 1500,
    startedAt: overrides.startedAt ?? new Date().toISOString(),
    errorMessage: overrides.errorMessage ?? null,
    errorStack: overrides.errorStack ?? null,
    workerIndex: overrides.workerIndex ?? 0,
    parallelIndex: overrides.parallelIndex ?? null,
    stdout: overrides.stdout ?? null,
    stderr: overrides.stderr ?? null,
    steps: overrides.steps ?? null,
    attachments: overrides.attachments ?? null,
    fingerprint: overrides.fingerprint ?? null,
  };
}

// ─── Quarantine ──────────────────────────────────────────────────────────
export interface QuarantineOverrides {
  id?: string;
  testTitle?: string;
  testFile?: string;
  reason?: string | null;
  quarantinedAt?: string;
  quarantinedBy?: string;
  status?: 'pending' | 'approved' | 'rejected';
  flakinessCategory?: string | null;
  categoryConfidence?: number | null;
  categoryEvidence?: string | null;
  resolvedAt?: string | null;
  resolutionType?: string | null;
  ttfMs?: number | null;
}

export function quarantineEntry(overrides: QuarantineOverrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    testTitle: overrides.testTitle ?? 'Flaky Test',
    testFile: overrides.testFile ?? 'tests/flaky.spec.ts',
    reason: overrides.reason ?? 'Intermittent failure',
    quarantinedAt: overrides.quarantinedAt ?? new Date().toISOString(),
    quarantinedBy: overrides.quarantinedBy ?? 'manual',
    status: overrides.status ?? 'approved',
    flakinessCategory: overrides.flakinessCategory ?? null,
    categoryConfidence: overrides.categoryConfidence ?? null,
    categoryEvidence: overrides.categoryEvidence ?? null,
    resolvedAt: overrides.resolvedAt ?? null,
    resolutionType: overrides.resolutionType ?? null,
    ttfMs: overrides.ttfMs ?? null,
  };
}

// ─── Workspace ───────────────────────────────────────────────────────────
export interface WorkspaceOverrides {
  id?: string;
  name?: string;
  configPath?: string;
  testResultsDir?: string | null;
  createdAt?: string;
}

export function workspace(overrides: WorkspaceOverrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    name: overrides.name ?? 'Test Workspace',
    configPath: overrides.configPath ?? './playwright.config.ts',
    testResultsDir: overrides.testResultsDir ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

// ─── Schedule ────────────────────────────────────────────────────────────
export interface ScheduleOverrides {
  id?: string;
  cronExpr?: string;
  runOptions?: string | null;
  enabled?: boolean;
  lastRunAt?: string | null;
  createdAt?: string;
}

export function schedule(overrides: ScheduleOverrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    cronExpr: overrides.cronExpr ?? '0 */6 * * *',
    runOptions: overrides.runOptions ?? null,
    enabled: overrides.enabled ?? true,
    lastRunAt: overrides.lastRunAt ?? null,
    createdAt: overrides.createdAt ?? new Date().toISOString(),
  };
}

// ─── Known Failure ───────────────────────────────────────────────────────
export interface KnownFailureOverrides {
  id?: string;
  testTitle?: string;
  testFile?: string;
  comment?: string | null;
  createdAt?: string;
  createdBy?: string;
}

export function knownFailure(overrides: KnownFailureOverrides = {}) {
  return {
    id: overrides.id ?? randomUUID(),
    testTitle: overrides.testTitle ?? 'Known Broken Test',
    testFile: overrides.testFile ?? 'tests/broken.spec.ts',
    comment: overrides.comment ?? 'Tracked in JIRA-123',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    createdBy: overrides.createdBy ?? 'manual',
  };
}
