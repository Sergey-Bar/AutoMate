/**
 * lib/seed-helpers.ts
 * Pure data-generation helpers for E2E seeding scripts.
 *
 * All functions are free of I/O side effects (no DB writes, no filesystem access,
 * no network calls). They return plain data structures that callers can persist
 * however they choose.
 */
import { randomBytes } from 'node:crypto';

// ── Private utilities ─────────────────────────────────────────────────────────

function hex(n: number): string {
  return randomBytes(n).toString('hex');
}

// ── Type definitions ──────────────────────────────────────────────────────────

export interface RunDef {
  id: string;
  startedAt: Date;
  finishedAt: Date;
  status: 'passed' | 'failed' | 'interrupted';
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  durationMs: number;
  branch: string;
  commitSha: string;
  commitMessage: string;
  triggeredBy: string;
  gateStatus: 'passed' | 'failed' | 'skipped';
  workspaceId: string;
}

export interface SuiteTemplate {
  suffix: string;
  title: string;
  file: string;
  project: string;
}

export interface Suite {
  id: string;
  runId: string;
  title: string;
  file: string;
  project: string;
}

export interface StatusCounters {
  passedCnt: number;
  failedCnt: number;
  flakyCnt: number;
  skippedCnt: number;
  inRun: number;
}

export interface TestStatusResult {
  shouldBreak: boolean;
  status: string;
  tags: string;
  retryCnt: number;
  counters: StatusCounters;
}

export interface TrendRow {
  date: string;
  project: string;
  branch: string;
  total: number;
  passed: number;
  failed: number;
  flaky: number;
  avgDurationMs: number;
  p95DurationMs: number;
}

// ── Pure helper ───────────────────────────────────────────────────────────────

/** Convert a Date to an ISO 8601 string. */
export function toISO(d: Date): string {
  return d.toISOString();
}

// ── Data generators ───────────────────────────────────────────────────────────

/**
 * Generate the 5 run definition objects anchored to the given `now` timestamp.
 * Commit SHAs are random (crypto.randomBytes) — call once and cache.
 */
export function generateRunDefs(now: Date): RunDef[] {
  const t = (offsetMs: number): Date => new Date(now.getTime() - offsetMs);

  return [
    {
      id: 'demo-run-1',
      startedAt: t(285_000),
      finishedAt: now,
      status: 'passed',
      total: 100, passed: 95, failed: 2, flaky: 2, skipped: 1,
      durationMs: 285_000,
      branch: 'main',
      commitSha: hex(20),
      commitMessage: 'feat: implement user authentication flow',
      triggeredBy: 'ci',
      gateStatus: 'passed',
      workspaceId: 'demo-ws-1',
    },
    {
      id: 'demo-run-2',
      startedAt: t(24 * 3_600_000 + 342_000),
      finishedAt: t(24 * 3_600_000),
      status: 'failed',
      total: 80, passed: 50, failed: 25, flaky: 3, skipped: 2,
      durationMs: 342_000,
      branch: 'feature/login',
      commitSha: hex(20),
      commitMessage: 'fix: handle login timeout gracefully',
      triggeredBy: 'manual',
      gateStatus: 'failed',
      workspaceId: 'demo-ws-1',
    },
    {
      id: 'demo-run-3',
      startedAt: t(2 * 24 * 3_600_000 + 180_000),
      finishedAt: t(2 * 24 * 3_600_000),
      status: 'passed',
      total: 60, passed: 60, failed: 0, flaky: 0, skipped: 0,
      durationMs: 180_000,
      branch: 'main',
      commitSha: hex(20),
      commitMessage: 'chore: update dependencies',
      triggeredBy: 'schedule',
      gateStatus: 'passed',
      workspaceId: 'demo-ws-1',
    },
    {
      id: 'demo-run-4',
      startedAt: t(3 * 24 * 3_600_000 + 120_000),
      finishedAt: t(3 * 24 * 3_600_000),
      status: 'interrupted',
      total: 40, passed: 20, failed: 5, flaky: 0, skipped: 0,
      durationMs: 120_000,
      branch: 'develop',
      commitSha: hex(20),
      commitMessage: 'refactor: reorganize test structure',
      triggeredBy: 'ci',
      gateStatus: 'skipped',
      workspaceId: 'demo-ws-2',
    },
    {
      id: 'demo-run-5',
      startedAt: t(7 * 24 * 3_600_000 + 295_000),
      finishedAt: t(7 * 24 * 3_600_000),
      status: 'passed',
      total: 100, passed: 98, failed: 1, flaky: 1, skipped: 0,
      durationMs: 295_000,
      branch: 'main',
      commitSha: hex(20),
      commitMessage: 'test: add comprehensive API coverage',
      triggeredBy: 'ci',
      gateStatus: 'passed',
      workspaceId: 'demo-ws-1',
    },
  ];
}

/** Return the 3 suite templates used across all demo runs. */
export function generateSuiteTemplates(): SuiteTemplate[] {
  return [
    { suffix: 'auth',      title: 'Auth Tests',      file: 'tests/auth/login.spec.ts',         project: 'chromium' },
    { suffix: 'dashboard', title: 'Dashboard Tests', file: 'tests/dashboard/overview.spec.ts', project: 'chromium' },
    { suffix: 'api',       title: 'API Tests',       file: 'tests/api/endpoints.spec.ts',      project: 'firefox'  },
  ];
}

/**
 * Build the flat list of Suite objects (one per run × template combination).
 * Does NOT perform any DB inserts — the caller is responsible for persistence.
 */
export function generateSuitesForRuns(runDefs: RunDef[], suiteTemplates: SuiteTemplate[]): Suite[] {
  const suites: Suite[] = [];
  for (const run of runDefs) {
    for (const tmpl of suiteTemplates) {
      const suiteId = `demo-suite-${run.id}-${tmpl.suffix}`;
      suites.push({ id: suiteId, runId: run.id, title: tmpl.title, file: tmpl.file, project: tmpl.project });
    }
  }
  return suites;
}

/** Return the 20 test-title strings cycled across all seeded tests. */
export function generateTestTitles(): string[] {
  return [
    'should login with valid credentials',
    'should reject invalid password',
    'should display dashboard KPIs correctly',
    'should handle network timeout gracefully',
    'should validate form input errors',
    'should render chart data for last 30 days',
    'should export CSV report successfully',
    'should handle concurrent user sessions',
    'should refresh auth token automatically',
    'should display notification badges',
    'should filter table by date range',
    'should sort columns ascending and descending',
    'should paginate results correctly',
    'should search with autocomplete suggestions',
    'should upload files with progress indicator',
    'should delete items with confirmation modal',
    'should edit profile settings',
    'should change theme preference',
    'should display error boundaries on crash',
    'should handle browser back button navigation',
  ];
}

/** Return the 5 error message strings used in failed/flaky results. */
export function generateErrorMessages(): string[] {
  return [
    'expect(received).toBeVisible()\n\nReceived element is not visible',
    'locator.click: Timeout 30000ms exceeded',
    'net::ERR_CONNECTION_REFUSED at https://api.example.com/users',
    'expect(received).toBe(expected)\n\nExpected: "success"\nReceived: "error"',
    'Navigation timeout of 30000ms exceeded',
  ];
}

/**
 * Determine the status for the next test in a run given current counters.
 *
 * Returns a `TestStatusResult` that includes the updated counters (with the
 * relevant counter incremented) and a `shouldBreak` flag for the caller to
 * exit the inner loop. `inRun` is read from `counters` but is NOT incremented
 * by this function — the caller must increment it after each iteration.
 */
export function computeTestStatus(run: RunDef, counters: StatusCounters): TestStatusResult {
  const { passedCnt, failedCnt, flakyCnt, skippedCnt, inRun } = counters;

  if (skippedCnt < run.skipped) {
    return {
      shouldBreak: false,
      status: 'skipped',
      tags: JSON.stringify(['@regression']),
      retryCnt: 0,
      counters: { ...counters, skippedCnt: skippedCnt + 1 },
    };
  }

  if (flakyCnt < run.flaky) {
    return {
      shouldBreak: false,
      status: 'flaky',
      tags: JSON.stringify(['@smoke', '@flaky']),
      retryCnt: 1,
      counters: { ...counters, flakyCnt: flakyCnt + 1 },
    };
  }

  if (failedCnt < run.failed) {
    return {
      shouldBreak: false,
      status: 'failed',
      tags: JSON.stringify(['@smoke']),
      retryCnt: 0,
      counters: { ...counters, failedCnt: failedCnt + 1 },
    };
  }

  if (passedCnt < run.passed) {
    return {
      shouldBreak: false,
      status: 'passed',
      tags: JSON.stringify(['@smoke', '@auth']),
      retryCnt: 0,
      counters: { ...counters, passedCnt: passedCnt + 1 },
    };
  }

  if (run.status === 'interrupted' && inRun >= run.passed + run.failed + run.skipped + run.flaky) {
    return {
      shouldBreak: false,
      status: 'queued',
      tags: JSON.stringify([]),
      retryCnt: 0,
      counters,
    };
  }

  return { shouldBreak: true, status: '', tags: '', retryCnt: 0, counters };
}

/**
 * Generate 30 days × `projects.length` trend rows anchored to `now`.
 * Does NOT perform any DB inserts — the caller is responsible for persistence.
 */
export function generateTrendData(now: Date, projects: string[]): TrendRow[] {
  const rows: TrendRow[] = [];

  for (let dayOff = 0; dayOff < 30; dayOff++) {
    const d = new Date(now.getTime() - dayOff * 86_400_000);
    const dateStr = d.toISOString().substring(0, 10);

    for (const proj of projects) {
      const passRate = 80 + (30 - dayOff) * 0.5;
      const total = 100;
      const passed = Math.floor(total * passRate / 100);
      const failed = Math.floor(total * (100 - passRate - 3) / 100);
      const flaky = total - passed - failed;

      rows.push({
        date: dateStr,
        project: proj,
        branch: 'main',
        total,
        passed,
        failed,
        flaky,
        avgDurationMs: 2500,
        p95DurationMs: 4500,
      });
    }
  }

  return rows;
}
