/**
 * events.test.ts
 *
 * Tests for the typed WebSocket event contracts defined in events.ts.
 * Covers: valid parses, unknown type rejection, wrong version rejection,
 * and missing required field rejection for both discriminated unions.
 */

import {
  ReporterEventSchema,
  RealtimeEventSchema,
  RunStartedEventSchema,
  RunCompletedEventSchema,
  RunUpdatedEventSchema,
  TestCompletedEventSchema,
  AIToolEventSchema,
} from './events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ok<T>(result: { success: boolean; data?: T }) {
  expect(result.success).toBe(true);
}

function fail(result: { success: boolean }) {
  expect(result.success).toBe(false);
}

// ---------------------------------------------------------------------------
// ReporterEventSchema — run:started
// ---------------------------------------------------------------------------

describe('ReporterEventSchema — run:started', () => {
  const valid = {
    type: 'run:started',
    version: '1',
    runId: 'r-001',
    projectName: 'acme',
    startedAt: '2024-01-01T00:00:00.000Z',
  };

  it('parses a valid run:started event', () => {
    ok(ReporterEventSchema.safeParse(valid));
  });

  it('rejects wrong version', () => {
    fail(ReporterEventSchema.safeParse({ ...valid, version: '2' }));
  });

  it('rejects missing runId', () => {
    const { runId: _runId, ...rest } = valid;
    fail(ReporterEventSchema.safeParse(rest));
  });

  it('rejects missing projectName', () => {
    const { projectName: _p, ...rest } = valid;
    fail(ReporterEventSchema.safeParse(rest));
  });

  it('rejects missing startedAt', () => {
    const { startedAt: _s, ...rest } = valid;
    fail(ReporterEventSchema.safeParse(rest));
  });
});

// ---------------------------------------------------------------------------
// ReporterEventSchema — run:completed
// ---------------------------------------------------------------------------

describe('ReporterEventSchema — run:completed', () => {
  const valid = {
    type: 'run:completed',
    version: '1',
    runId: 'r-002',
    status: 'passed',
    total: 10,
    passed: 9,
    failed: 1,
    duration: 5432,
  };

  it('parses a valid run:completed event', () => {
    ok(ReporterEventSchema.safeParse(valid));
  });

  it('rejects wrong version', () => {
    fail(ReporterEventSchema.safeParse({ ...valid, version: '0' }));
  });

  it('rejects non-numeric duration', () => {
    fail(ReporterEventSchema.safeParse({ ...valid, duration: 'fast' }));
  });

  it('rejects missing failed field', () => {
    const { failed: _f, ...rest } = valid;
    fail(ReporterEventSchema.safeParse(rest));
  });
});

// ---------------------------------------------------------------------------
// ReporterEventSchema — test:completed
// ---------------------------------------------------------------------------

describe('ReporterEventSchema — test:completed', () => {
  const valid = {
    type: 'test:completed',
    version: '1',
    runId: 'r-003',
    testId: 't-001',
    title: 'should render button',
    status: 'passed',
    duration: 120,
  };

  it('parses a valid test:completed event', () => {
    ok(ReporterEventSchema.safeParse(valid));
  });

  it('rejects wrong version', () => {
    fail(ReporterEventSchema.safeParse({ ...valid, version: 'v1' }));
  });

  it('rejects missing testId', () => {
    const { testId: _t, ...rest } = valid;
    fail(ReporterEventSchema.safeParse(rest));
  });

  it('rejects missing title', () => {
    const { title: _t, ...rest } = valid;
    fail(ReporterEventSchema.safeParse(rest));
  });
});

// ---------------------------------------------------------------------------
// ReporterEventSchema — unknown type rejection
// ---------------------------------------------------------------------------

describe('ReporterEventSchema — unknown type', () => {
  it('rejects an unknown event type', () => {
    fail(
      ReporterEventSchema.safeParse({
        type: 'run:exploded',
        version: '1',
        runId: 'r-999',
      }),
    );
  });

  it('rejects missing type field entirely', () => {
    fail(
      ReporterEventSchema.safeParse({
        version: '1',
        runId: 'r-999',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// RealtimeEventSchema — run:updated
// ---------------------------------------------------------------------------

describe('RealtimeEventSchema — run:updated', () => {
  const valid = {
    type: 'run:updated',
    version: '1',
    runId: 'r-004',
    status: 'running',
    timestamp: '2024-01-01T00:01:00.000Z',
  };

  it('parses a valid run:updated event', () => {
    ok(RealtimeEventSchema.safeParse(valid));
  });

  it('rejects wrong version', () => {
    fail(RealtimeEventSchema.safeParse({ ...valid, version: '2' }));
  });

  it('rejects missing timestamp', () => {
    const { timestamp: _ts, ...rest } = valid;
    fail(RealtimeEventSchema.safeParse(rest));
  });
});

// ---------------------------------------------------------------------------
// RealtimeEventSchema — ai:tool
// ---------------------------------------------------------------------------

describe('RealtimeEventSchema — ai:tool', () => {
  const valid = {
    type: 'ai:tool',
    version: '1',
    conversationId: 'conv-001',
    toolName: 'create_issue',
    status: 'started',
    timestamp: '2024-01-01T00:02:00.000Z',
  };

  it('parses a valid ai:tool event', () => {
    ok(RealtimeEventSchema.safeParse(valid));
  });

  it('rejects wrong version', () => {
    fail(RealtimeEventSchema.safeParse({ ...valid, version: '' }));
  });

  it('rejects missing toolName', () => {
    const { toolName: _tn, ...rest } = valid;
    fail(RealtimeEventSchema.safeParse(rest));
  });

  it('rejects missing conversationId', () => {
    const { conversationId: _c, ...rest } = valid;
    fail(RealtimeEventSchema.safeParse(rest));
  });
});

// ---------------------------------------------------------------------------
// RealtimeEventSchema — test:completed (shared schema)
// ---------------------------------------------------------------------------

describe('RealtimeEventSchema — test:completed', () => {
  const valid = {
    type: 'test:completed',
    version: '1',
    runId: 'r-005',
    testId: 't-002',
    title: 'login flow',
    status: 'failed',
    duration: 340,
  };

  it('parses a valid test:completed event via realtime union', () => {
    ok(RealtimeEventSchema.safeParse(valid));
  });
});

// ---------------------------------------------------------------------------
// RealtimeEventSchema — unknown type rejection
// ---------------------------------------------------------------------------

describe('RealtimeEventSchema — unknown type', () => {
  it('rejects an unknown event type', () => {
    fail(
      RealtimeEventSchema.safeParse({
        type: 'dashboard:blink',
        version: '1',
        runId: 'r-999',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Individual schema unit tests (RunStartedEventSchema direct)
// ---------------------------------------------------------------------------

describe('RunStartedEventSchema', () => {
  it('infers correct TypeScript shape', () => {
    const result = RunStartedEventSchema.safeParse({
      type: 'run:started',
      version: '1',
      runId: 'r-abc',
      projectName: 'suite-a',
      startedAt: '2024-06-01T12:00:00.000Z',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('run:started');
      expect(result.data.version).toBe('1');
      expect(result.data.runId).toBe('r-abc');
    }
  });
});

describe('RunCompletedEventSchema', () => {
  it('rejects string totals', () => {
    fail(
      RunCompletedEventSchema.safeParse({
        type: 'run:completed',
        version: '1',
        runId: 'r-x',
        status: 'passed',
        total: '10',
        passed: '10',
        failed: '0',
        duration: '500',
      }),
    );
  });
});

describe('RunUpdatedEventSchema', () => {
  it('parses a minimal valid run:updated', () => {
    ok(
      RunUpdatedEventSchema.safeParse({
        type: 'run:updated',
        version: '1',
        runId: 'r-upd',
        status: 'running',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    );
  });
});

describe('TestCompletedEventSchema', () => {
  it('parses a minimal valid test:completed', () => {
    ok(
      TestCompletedEventSchema.safeParse({
        type: 'test:completed',
        version: '1',
        runId: 'r-tc',
        testId: 't-tc',
        title: 'my test',
        status: 'passed',
        duration: 10,
      }),
    );
  });
});

describe('AIToolEventSchema', () => {
  it('parses a minimal valid ai:tool event', () => {
    ok(
      AIToolEventSchema.safeParse({
        type: 'ai:tool',
        version: '1',
        conversationId: 'c-1',
        toolName: 'run_query',
        status: 'completed',
        timestamp: '2024-01-01T00:00:00.000Z',
      }),
    );
  });
});
