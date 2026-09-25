import {
  REALTIME_EVENT_VERSION,
  RealtimeEventSchema,
  RunUpdatedSchema,
  TestUpdatedSchema,
} from './realtime-events.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('REALTIME_EVENT_VERSION', () => {
  it('is "1"', () => {
    expect(REALTIME_EVENT_VERSION).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// RealtimeEventSchema (base)
// ---------------------------------------------------------------------------

describe('RealtimeEventSchema', () => {
  it('accepts a valid base realtime event', () => {
    const result = RealtimeEventSchema.safeParse({
      type: 'run:updated',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1');
    }
  });

  it('defaults version to "1" when not provided', () => {
    const result = RealtimeEventSchema.safeParse({
      type: 'test:updated',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe('1');
    }
  });

  it('rejects an incompatible version', () => {
    const result = RealtimeEventSchema.safeParse({
      version: '3',
      type: 'some:future:event',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects when type is missing', () => {
    const result = RealtimeEventSchema.safeParse({
      timestamp: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('type');
    }
  });

  it('rejects when timestamp is missing', () => {
    const result = RealtimeEventSchema.safeParse({ type: 'run:updated' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((i) => i.path[0])).toContain('timestamp');
    }
  });
});

// ---------------------------------------------------------------------------
// RunUpdatedSchema
// ---------------------------------------------------------------------------

describe('RunUpdatedSchema', () => {
  it('accepts a valid run:updated event', () => {
    const result = RunUpdatedSchema.safeParse({
      type: 'run:updated',
      timestamp: '2026-01-01T00:01:00.000Z',
      payload: {
        runId: 'run-001',
        status: 'running',
        total: 100,
        passed: 40,
        failed: 2,
        flaky: 1,
        skipped: 0,
        durationMs: 60000,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts run:updated without optional durationMs', () => {
    const result = RunUpdatedSchema.safeParse({
      type: 'run:updated',
      timestamp: '2026-01-01T00:01:00.000Z',
      payload: {
        runId: 'run-002',
        status: 'passed',
        total: 10,
        passed: 10,
        failed: 0,
        flaky: 0,
        skipped: 0,
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when payload.runId is missing', () => {
    const result = RunUpdatedSchema.safeParse({
      type: 'run:updated',
      timestamp: '2026-01-01T00:01:00.000Z',
      payload: {
        status: 'running',
        total: 10,
        passed: 5,
        failed: 0,
        flaky: 0,
        skipped: 0,
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid run status', () => {
    const result = RunUpdatedSchema.safeParse({
      type: 'run:updated',
      timestamp: '2026-01-01T00:01:00.000Z',
      payload: {
        runId: 'run-003',
        status: 'cancelled',
        total: 5,
        passed: 5,
        failed: 0,
        flaky: 0,
        skipped: 0,
      },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TestUpdatedSchema
// ---------------------------------------------------------------------------

describe('TestUpdatedSchema', () => {
  it('accepts a valid test:updated event', () => {
    const result = TestUpdatedSchema.safeParse({
      type: 'test:updated',
      timestamp: '2026-01-01T00:00:05.000Z',
      payload: {
        testId: 'test-001',
        runId: 'run-001',
        status: 'passed',
        durationMs: 900,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a failed test update with errorMessage', () => {
    const result = TestUpdatedSchema.safeParse({
      type: 'test:updated',
      timestamp: '2026-01-01T00:00:05.000Z',
      payload: {
        testId: 'test-002',
        runId: 'run-001',
        status: 'failed',
        errorMessage: 'Assertion failed: expected 200 got 404',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects when payload.runId is missing', () => {
    const result = TestUpdatedSchema.safeParse({
      type: 'test:updated',
      timestamp: '2026-01-01T00:00:05.000Z',
      payload: {
        testId: 'test-003',
        status: 'passed',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid test status', () => {
    const result = TestUpdatedSchema.safeParse({
      type: 'test:updated',
      timestamp: '2026-01-01T00:00:05.000Z',
      payload: {
        testId: 'test-004',
        runId: 'run-001',
        status: 'unknown',
      },
    });
    expect(result.success).toBe(false);
  });
});
