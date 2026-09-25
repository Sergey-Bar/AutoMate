import {
  REPORTER_EVENT_VERSION,
  ReporterEventSchema,
  RunStartedSchema,
  TestStartedSchema,
  TestCompletedSchema,
  RunCompletedSchema,
} from './reporter-events.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('REPORTER_EVENT_VERSION', () => {
  it('is "1"', () => {
    expect(REPORTER_EVENT_VERSION).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// ReporterEventSchema (base)
// ---------------------------------------------------------------------------

describe('ReporterEventSchema', () => {
  it('accepts a valid base event', () => {
    const result = ReporterEventSchema.safeParse({
      type: 'custom:event',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1');
    }
  });

  it('rejects an incompatible version', () => {
    const result = ReporterEventSchema.safeParse({
      version: '2',
      type: 'future:event',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('defaults version to "1" when not provided', () => {
    const result = ReporterEventSchema.safeParse({
      type: 'run:started',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1');
    }
  });

  it('rejects when runId is missing', () => {
    const result = ReporterEventSchema.safeParse({
      type: 'run:started',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('runId');
    }
  });
});

// ---------------------------------------------------------------------------
// RunStartedSchema
// ---------------------------------------------------------------------------

describe('RunStartedSchema', () => {
  it('accepts a valid run:started event', () => {
    const result = RunStartedSchema.safeParse({
      type: 'run:started',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: {
        total: 50,
        workers: 4,
        branch: 'main',
        commitSha: 'abc123',
        triggeredBy: 'ci',
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts minimal payload', () => {
    const result = RunStartedSchema.safeParse({
      type: 'run:started',
      runId: 'run-002',
      timestamp: '2026-01-01T00:00:00.000Z',
      payload: { total: 10 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when payload is missing', () => {
    const result = RunStartedSchema.safeParse({
      type: 'run:started',
      runId: 'run-003',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('payload');
    }
  });
});

// ---------------------------------------------------------------------------
// TestStartedSchema
// ---------------------------------------------------------------------------

describe('TestStartedSchema', () => {
  it('accepts a valid test:started event', () => {
    const result = TestStartedSchema.safeParse({
      type: 'test:started',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:01.000Z',
      payload: {
        testId: 'test-001',
        title: 'Login with valid credentials',
        file: 'e2e/auth.spec.ts',
        retry: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when payload.testId is missing', () => {
    const result = TestStartedSchema.safeParse({
      type: 'test:started',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:01.000Z',
      payload: {
        title: 'Login test',
        file: 'e2e/auth.spec.ts',
        retry: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TestCompletedSchema
// ---------------------------------------------------------------------------

describe('TestCompletedSchema', () => {
  it('accepts a passed test:completed event', () => {
    const result = TestCompletedSchema.safeParse({
      type: 'test:completed',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:02.000Z',
      payload: {
        testId: 'test-001',
        status: 'passed',
        durationMs: 850,
        retry: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a failed test:completed event with errorMessage', () => {
    const result = TestCompletedSchema.safeParse({
      type: 'test:completed',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:02.000Z',
      payload: {
        testId: 'test-002',
        status: 'failed',
        retry: 1,
        errorMessage: 'Expected "Dashboard" but got "Login"',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid test status', () => {
    const result = TestCompletedSchema.safeParse({
      type: 'test:completed',
      runId: 'run-001',
      timestamp: '2026-01-01T00:00:02.000Z',
      payload: {
        testId: 'test-003',
        status: 'running',
        retry: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RunCompletedSchema
// ---------------------------------------------------------------------------

describe('RunCompletedSchema', () => {
  it('accepts a valid run:completed event', () => {
    const result = RunCompletedSchema.safeParse({
      type: 'run:completed',
      runId: 'run-001',
      timestamp: '2026-01-01T00:10:00.000Z',
      payload: {
        status: 'passed',
        total: 50,
        passed: 48,
        failed: 1,
        flaky: 1,
        skipped: 0,
        durationMs: 600000,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when total is missing', () => {
    const result = RunCompletedSchema.safeParse({
      type: 'run:completed',
      runId: 'run-001',
      timestamp: '2026-01-01T00:10:00.000Z',
      payload: {
        status: 'passed',
        passed: 5,
        failed: 0,
        flaky: 0,
        skipped: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});
