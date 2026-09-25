import {
  toISO,
  generateRunDefs,
  generateSuiteTemplates,
  generateSuitesForRuns,
  generateTestTitles,
  generateErrorMessages,
  computeTestStatus,
  generateTrendData,
  type RunDef,
  type StatusCounters,
} from './seed-helpers.js';

// ── toISO ─────────────────────────────────────────────────────────────────────

describe('toISO', () => {
  it('returns the correct ISO 8601 string for a fixed date', () => {
    const d = new Date('2024-01-15T12:00:00.000Z');
    expect(toISO(d)).toBe('2024-01-15T12:00:00.000Z');
  });

  it('round-trips back to the same timestamp', () => {
    const d = new Date('2025-06-30T23:59:59.999Z');
    expect(new Date(toISO(d)).getTime()).toBe(d.getTime());
  });
});

// ── generateRunDefs ───────────────────────────────────────────────────────────

describe('generateRunDefs', () => {
  const now = new Date('2024-03-01T12:00:00.000Z');
  let runs: RunDef[];

  beforeEach(() => {
    runs = generateRunDefs(now);
  });

  it('returns exactly 5 run definitions', () => {
    expect(runs).toHaveLength(5);
  });

  it('every run has startedAt strictly before finishedAt', () => {
    for (const run of runs) {
      expect(run.startedAt).toBeInstanceOf(Date);
      expect(run.finishedAt).toBeInstanceOf(Date);
      expect(run.startedAt.getTime()).toBeLessThan(run.finishedAt.getTime());
    }
  });

  it('status values are one of the allowed enum members', () => {
    const valid = new Set<string>(['passed', 'failed', 'interrupted']);
    for (const run of runs) {
      expect(valid.has(run.status)).toBe(true);
    }
  });

  it('gateStatus values are one of the allowed enum members', () => {
    const valid = new Set<string>(['passed', 'failed', 'skipped']);
    for (const run of runs) {
      expect(valid.has(run.gateStatus)).toBe(true);
    }
  });

  it('every run has a non-empty commitSha, branch, and workspaceId', () => {
    for (const run of runs) {
      expect(run.commitSha.length).toBeGreaterThan(0);
      expect(run.branch.length).toBeGreaterThan(0);
      expect(run.workspaceId.length).toBeGreaterThan(0);
    }
  });

  it('the first run finishes exactly at `now`', () => {
    expect(runs[0].finishedAt.getTime()).toBe(now.getTime());
  });

  it('numeric counters are non-negative for every run', () => {
    for (const run of runs) {
      expect(run.total).toBeGreaterThanOrEqual(0);
      expect(run.passed).toBeGreaterThanOrEqual(0);
      expect(run.failed).toBeGreaterThanOrEqual(0);
      expect(run.flaky).toBeGreaterThanOrEqual(0);
      expect(run.skipped).toBeGreaterThanOrEqual(0);
      expect(run.durationMs).toBeGreaterThan(0);
    }
  });
});

// ── generateSuiteTemplates ────────────────────────────────────────────────────

describe('generateSuiteTemplates', () => {
  it('returns exactly 3 suite templates', () => {
    expect(generateSuiteTemplates()).toHaveLength(3);
  });

  it('each template has non-empty suffix, title, file, and project', () => {
    for (const tmpl of generateSuiteTemplates()) {
      expect(tmpl.suffix.length).toBeGreaterThan(0);
      expect(tmpl.title.length).toBeGreaterThan(0);
      expect(tmpl.file.length).toBeGreaterThan(0);
      expect(tmpl.project.length).toBeGreaterThan(0);
    }
  });

  it('all suffixes are unique', () => {
    const suffixes = generateSuiteTemplates().map(t => t.suffix);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it('returns a stable array on repeated calls', () => {
    expect(generateSuiteTemplates()).toEqual(generateSuiteTemplates());
  });
});

// ── generateSuitesForRuns ─────────────────────────────────────────────────────

describe('generateSuitesForRuns', () => {
  const now = new Date();
  const runDefs = generateRunDefs(now);
  const suiteTemplates = generateSuiteTemplates();

  it('produces 5 × 3 = 15 suites for the default inputs', () => {
    const suites = generateSuitesForRuns(runDefs, suiteTemplates);
    expect(suites).toHaveLength(15);
  });

  it('each suite has a non-empty id, runId, title, file, and project', () => {
    for (const suite of generateSuitesForRuns(runDefs, suiteTemplates)) {
      expect(suite.id.length).toBeGreaterThan(0);
      expect(suite.runId.length).toBeGreaterThan(0);
      expect(suite.title.length).toBeGreaterThan(0);
      expect(suite.file.length).toBeGreaterThan(0);
      expect(suite.project.length).toBeGreaterThan(0);
    }
  });

  it('suite id encodes both the run id and the template suffix', () => {
    const suites = generateSuitesForRuns(runDefs, suiteTemplates);
    const first = suites[0];
    expect(first.id).toContain(runDefs[0].id);
    expect(first.id).toContain(suiteTemplates[0].suffix);
  });

  it('returns an empty array when no runs are provided', () => {
    expect(generateSuitesForRuns([], suiteTemplates)).toHaveLength(0);
  });

  it('returns an empty array when no templates are provided', () => {
    expect(generateSuitesForRuns(runDefs, [])).toHaveLength(0);
  });
});

// ── generateTestTitles ────────────────────────────────────────────────────────

describe('generateTestTitles', () => {
  it('returns exactly 20 test titles', () => {
    expect(generateTestTitles()).toHaveLength(20);
  });

  it('all titles are non-empty strings', () => {
    for (const title of generateTestTitles()) {
      expect(typeof title).toBe('string');
      expect(title.length).toBeGreaterThan(0);
    }
  });

  it('returns a stable array on repeated calls', () => {
    expect(generateTestTitles()).toEqual(generateTestTitles());
  });
});

// ── generateErrorMessages ─────────────────────────────────────────────────────

describe('generateErrorMessages', () => {
  it('returns exactly 5 error messages', () => {
    expect(generateErrorMessages()).toHaveLength(5);
  });

  it('all messages are non-empty strings', () => {
    for (const msg of generateErrorMessages()) {
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it('returns a stable array on repeated calls', () => {
    expect(generateErrorMessages()).toEqual(generateErrorMessages());
  });
});

// ── computeTestStatus ─────────────────────────────────────────────────────────

describe('computeTestStatus', () => {
  /** A run with 1 skipped, 1 flaky, 2 failed, 5 passed — total 9. */
  const baseRun: RunDef = {
    id: 'run-x',
    startedAt: new Date(),
    finishedAt: new Date(),
    status: 'passed',
    total: 9,
    passed: 5,
    failed: 2,
    flaky: 1,
    skipped: 1,
    durationMs: 1000,
    branch: 'main',
    commitSha: 'abc',
    commitMessage: 'test commit',
    triggeredBy: 'ci',
    gateStatus: 'passed',
    workspaceId: 'ws-1',
  };

  const zeroCntrs: StatusCounters = {
    passedCnt: 0,
    failedCnt: 0,
    flakyCnt: 0,
    skippedCnt: 0,
    inRun: 0,
  };

  it('returns status=skipped when skippedCnt < run.skipped', () => {
    const result = computeTestStatus(baseRun, zeroCntrs);
    expect(result.status).toBe('skipped');
    expect(result.shouldBreak).toBe(false);
    expect(result.retryCnt).toBe(0);
    expect(result.counters.skippedCnt).toBe(1);
  });

  it('returns status=flaky once the skipped budget is exhausted', () => {
    const counters: StatusCounters = { ...zeroCntrs, skippedCnt: 1 };
    const result = computeTestStatus(baseRun, counters);
    expect(result.status).toBe('flaky');
    expect(result.shouldBreak).toBe(false);
    expect(result.retryCnt).toBe(1);
    expect(result.counters.flakyCnt).toBe(1);
  });

  it('returns status=failed once the skipped and flaky budgets are exhausted', () => {
    const counters: StatusCounters = { ...zeroCntrs, skippedCnt: 1, flakyCnt: 1 };
    const result = computeTestStatus(baseRun, counters);
    expect(result.status).toBe('failed');
    expect(result.shouldBreak).toBe(false);
    expect(result.retryCnt).toBe(0);
    expect(result.counters.failedCnt).toBe(1);
  });

  it('returns status=passed once skipped, flaky, and failed budgets are exhausted', () => {
    const counters: StatusCounters = { ...zeroCntrs, skippedCnt: 1, flakyCnt: 1, failedCnt: 2 };
    const result = computeTestStatus(baseRun, counters);
    expect(result.status).toBe('passed');
    expect(result.shouldBreak).toBe(false);
    expect(result.retryCnt).toBe(0);
    expect(result.counters.passedCnt).toBe(1);
  });

  it('returns shouldBreak=true when all budgets are exhausted for a non-interrupted run', () => {
    const counters: StatusCounters = {
      passedCnt: 5,
      failedCnt: 2,
      flakyCnt: 1,
      skippedCnt: 1,
      inRun: 9,
    };
    const result = computeTestStatus(baseRun, counters);
    expect(result.shouldBreak).toBe(true);
    expect(result.status).toBe('');
  });

  it('returns status=queued for an interrupted run after all expected tests are assigned', () => {
    const interruptedRun: RunDef = {
      ...baseRun,
      status: 'interrupted',
      passed: 2,
      failed: 1,
      flaky: 0,
      skipped: 0,
    };
    const counters: StatusCounters = {
      passedCnt: 2,
      failedCnt: 1,
      flakyCnt: 0,
      skippedCnt: 0,
      inRun: 3, // == passed + failed + flaky + skipped
    };
    const result = computeTestStatus(interruptedRun, counters);
    expect(result.status).toBe('queued');
    expect(result.shouldBreak).toBe(false);
    expect(result.retryCnt).toBe(0);
  });

  it('returns status=queued for an interrupted run with all-zero counters and zero budget', () => {
    const interruptedRun: RunDef = {
      ...baseRun,
      status: 'interrupted',
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
    };
    const result = computeTestStatus(interruptedRun, zeroCntrs);
    expect(result.status).toBe('queued');
    expect(result.counters).toEqual(zeroCntrs);
  });

  it('tags contain @regression for skipped results', () => {
    const result = computeTestStatus(baseRun, zeroCntrs);
    const tags: string[] = JSON.parse(result.tags) as string[];
    expect(tags).toContain('@regression');
  });

  it('tags contain @flaky for flaky results', () => {
    const counters: StatusCounters = { ...zeroCntrs, skippedCnt: 1 };
    const result = computeTestStatus(baseRun, counters);
    const tags: string[] = JSON.parse(result.tags) as string[];
    expect(tags).toContain('@flaky');
  });
});

// ── generateTrendData ─────────────────────────────────────────────────────────

describe('generateTrendData', () => {
  const now = new Date('2024-03-30T12:00:00.000Z');
  const projects = ['chromium', 'firefox', 'webkit'];

  it('returns 30 × 3 = 90 rows for 3 projects', () => {
    expect(generateTrendData(now, projects)).toHaveLength(90);
  });

  it('returns 0 rows for an empty projects array (edge case)', () => {
    expect(generateTrendData(now, [])).toHaveLength(0);
  });

  it('returns exactly 30 rows for a single project', () => {
    expect(generateTrendData(now, ['chromium'])).toHaveLength(30);
  });

  it('all date strings match YYYY-MM-DD format', () => {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    for (const row of generateTrendData(now, projects)) {
      expect(row.date).toMatch(datePattern);
    }
  });

  it('every row references one of the supplied projects', () => {
    const projectSet = new Set(projects);
    for (const row of generateTrendData(now, projects)) {
      expect(projectSet.has(row.project)).toBe(true);
    }
  });

  it('each row has total=100, fixed avgDurationMs, and fixed p95DurationMs', () => {
    for (const row of generateTrendData(now, ['chromium'])) {
      expect(row.total).toBe(100);
      expect(row.avgDurationMs).toBe(2500);
      expect(row.p95DurationMs).toBe(4500);
    }
  });

  it('passed + failed + flaky equals total for every row', () => {
    for (const row of generateTrendData(now, ['chromium'])) {
      expect(row.passed + row.failed + row.flaky).toBe(row.total);
    }
  });
});
