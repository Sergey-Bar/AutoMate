import {
  TestStatusSchema,
  RunStatusSchema,
  TestAttachmentSchema,
  TestResultSchema,
  TestSuiteSchema,
  TestRunSchema,
} from './test-results.js';

// ---------------------------------------------------------------------------
// TestStatusSchema
// ---------------------------------------------------------------------------

describe('TestStatusSchema', () => {
  it('accepts all valid test statuses', () => {
    const statuses = ['passed', 'failed', 'flaky', 'skipped', 'timedOut', 'running', 'queued'];
    for (const s of statuses) {
      expect(TestStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an invalid test status', () => {
    expect(TestStatusSchema.safeParse('pending').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RunStatusSchema
// ---------------------------------------------------------------------------

describe('RunStatusSchema', () => {
  it('accepts all valid run statuses', () => {
    const statuses = ['running', 'passed', 'failed', 'interrupted', 'queued'];
    for (const s of statuses) {
      expect(RunStatusSchema.safeParse(s).success).toBe(true);
    }
  });

  it('rejects an invalid run status', () => {
    expect(RunStatusSchema.safeParse('cancelled').success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TestAttachmentSchema
// ---------------------------------------------------------------------------

describe('TestAttachmentSchema', () => {
  it('accepts a screenshot attachment', () => {
    const result = TestAttachmentSchema.safeParse({
      name: 'screenshot',
      contentType: 'image/png',
      path: '/results/run-1/screenshot.png',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when name is missing', () => {
    const result = TestAttachmentSchema.safeParse({ contentType: 'image/png' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('name');
    }
  });
});

// ---------------------------------------------------------------------------
// TestResultSchema
// ---------------------------------------------------------------------------

describe('TestResultSchema', () => {
  it('accepts a valid test result', () => {
    const result = TestResultSchema.safeParse({
      id: 'res-001',
      testId: 'test-001',
      runId: 'run-001',
      retry: 0,
      status: 'passed',
      durationMs: 1200,
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a failed result with attachments', () => {
    const result = TestResultSchema.safeParse({
      id: 'res-002',
      testId: 'test-002',
      runId: 'run-001',
      retry: 1,
      status: 'failed',
      errorMessage: 'Expected "Login" to be visible',
      errorStack: 'Error at page.locator...',
      attachments: [{ name: 'screenshot', contentType: 'image/png', path: '/s.png' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects when testId is missing', () => {
    const result = TestResultSchema.safeParse({
      id: 'res-003',
      runId: 'run-001',
      retry: 0,
      status: 'passed',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('testId');
    }
  });

  it('rejects when retry is negative', () => {
    const result = TestResultSchema.safeParse({
      id: 'res-004',
      testId: 'test-001',
      runId: 'run-001',
      retry: -1,
      status: 'passed',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TestSuiteSchema
// ---------------------------------------------------------------------------

describe('TestSuiteSchema', () => {
  it('accepts a valid test suite', () => {
    const result = TestSuiteSchema.safeParse({
      id: 'suite-001',
      runId: 'run-001',
      title: 'Authentication',
      file: 'e2e/auth.spec.ts',
      total: 10,
      passed: 9,
      failed: 1,
      skipped: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when title is missing', () => {
    const result = TestSuiteSchema.safeParse({
      id: 'suite-002',
      runId: 'run-001',
      file: 'e2e/auth.spec.ts',
      total: 5,
      passed: 5,
      failed: 0,
      skipped: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('title');
    }
  });
});

// ---------------------------------------------------------------------------
// TestRunSchema
// ---------------------------------------------------------------------------

describe('TestRunSchema', () => {
  it('accepts a valid completed run', () => {
    const result = TestRunSchema.safeParse({
      id: 'run-001',
      status: 'passed',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
      durationMs: 60000,
      total: 100,
      passed: 98,
      failed: 1,
      flaky: 1,
      skipped: 0,
      branch: 'main',
      commitSha: 'abc123',
      triggeredBy: 'ci-pipeline',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a running (in-progress) run', () => {
    const result = TestRunSchema.safeParse({
      id: 'run-002',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      total: 100,
      passed: 50,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects when status is missing', () => {
    const result = TestRunSchema.safeParse({
      id: 'run-003',
      startedAt: '2026-01-01T00:00:00.000Z',
      total: 10,
      passed: 10,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('status');
    }
  });

  it('rejects an invalid run status', () => {
    const result = TestRunSchema.safeParse({
      id: 'run-004',
      status: 'cancelled',
      startedAt: '2026-01-01T00:00:00.000Z',
      total: 5,
      passed: 5,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
    expect(result.success).toBe(false);
  });
});
