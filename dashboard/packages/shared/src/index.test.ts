import {
  TestStatus,
  RunStatus,
  RunSchema,
  TestSchema,
  StepSchema,
  ResultSchema,
  CompareChangeType,
  CompareRowSchema,
  parseResult,
} from './index.js';
import type { Result } from './index.js';

// ─── Minimal valid fixtures ────────────────────────────────────────────────

const validRun = {
  id: 'r1',
  startedAt: '2024-01-01T00:00:00Z',
  finishedAt: null,
  status: 'running' as const,
  total: 10,
  passed: 8,
  failed: 1,
  flaky: 0,
  skipped: 1,
  durationMs: null,
  branch: null,
  commitSha: null,
  commitMessage: null,
  triggeredBy: null,
  config: null,
  rawArgs: null,
};

const validTest = {
  id: 't1',
  runId: 'r1',
  suiteId: null,
  title: 'my test',
  file: 'tests/foo.spec.ts',
  line: null,
  column: null,
  status: 'passed' as const,
  durationMs: null,
  tags: null,
  annotations: null,
  retryCount: null,
  expectedStatus: null,
  workerIndex: null,
  stableId: null,
};

const validResult: Result = {
  id: 'res1',
  testId: 't1',
  runId: 'r1',
  retry: 0,
  status: 'passed',
  durationMs: null,
  startedAt: null,
  errorMessage: null,
  errorStack: null,
  workerIndex: null,
  parallelIndex: null,
  stdout: null,
  stderr: null,
  steps: null,
  attachments: null,
};

// ─── TestStatus ───────────────────────────────────────────────────────────

describe('TestStatus', () => {
  it.each(['passed', 'failed', 'flaky', 'skipped', 'timedOut', 'running', 'queued'])(
    'parses valid value: %s',
    (val: string) => {
      const result = TestStatus.safeParse(val);
      expect(result.success).toBe(true);
    },
  );

  it('rejects an invalid value', () => {
    const result = TestStatus.safeParse('unknown');
    expect(result.success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(TestStatus.safeParse('').success).toBe(false);
  });

  it('rejects non-string', () => {
    expect(TestStatus.safeParse(42).success).toBe(false);
  });
});

// ─── RunStatus ────────────────────────────────────────────────────────────

describe('RunStatus', () => {
  it.each(['running', 'passed', 'failed', 'interrupted'])(
    'parses valid value: %s',
    (val: string) => {
      expect(RunStatus.safeParse(val).success).toBe(true);
    },
  );

  it('rejects an invalid value', () => {
    expect(RunStatus.safeParse('queued').success).toBe(false);
  });

  it('rejects null', () => {
    expect(RunStatus.safeParse(null).success).toBe(false);
  });
});

// ─── RunSchema ────────────────────────────────────────────────────────────

describe('RunSchema', () => {
  it('parses a minimal valid run', () => {
    const result = RunSchema.safeParse(validRun);
    expect(result.success).toBe(true);
  });

  it('parses a run with all optional fields populated', () => {
    const result = RunSchema.safeParse({
      ...validRun,
      finishedAt: '2024-01-01T01:00:00Z',
      durationMs: 60000,
      branch: 'main',
      commitSha: 'abc123',
      commitMessage: 'fix: test',
      triggeredBy: 'ci',
      config: 'playwright.config.ts',
      rawArgs: '--workers=4',
      gateStatus: 'passed',
      source: 'live',
    });
    expect(result.success).toBe(true);
  });

  it('parses run with gateStatus=null (optional nullable)', () => {
    const result = RunSchema.safeParse({ ...validRun, gateStatus: null });
    expect(result.success).toBe(true);
  });

  it('parses run with source=blob', () => {
    const result = RunSchema.safeParse({ ...validRun, source: 'blob' });
    expect(result.success).toBe(true);
  });

  it('parses run without optional gateStatus/source fields', () => {
    // These fields are optional, so omitting them should be fine
    const { gateStatus: _g, source: _s, ...withoutOptionals } = { ...validRun, gateStatus: undefined, source: undefined };
    const result = RunSchema.safeParse(withoutOptionals);
    expect(result.success).toBe(true);
  });

  it('rejects run with invalid status', () => {
    const result = RunSchema.safeParse({ ...validRun, status: 'pending' });
    expect(result.success).toBe(false);
  });

  it('rejects run missing required id field', () => {
    const { id: _id, ...withoutId } = validRun;
    const result = RunSchema.safeParse(withoutId);
    expect(result.success).toBe(false);
  });

  it('rejects run with non-number total', () => {
    const result = RunSchema.safeParse({ ...validRun, total: 'ten' });
    expect(result.success).toBe(false);
  });

  it('rejects run with invalid gateStatus', () => {
    const result = RunSchema.safeParse({ ...validRun, gateStatus: 'running' });
    expect(result.success).toBe(false);
  });

  it('rejects run with invalid source', () => {
    const result = RunSchema.safeParse({ ...validRun, source: 'unknown' });
    expect(result.success).toBe(false);
  });
});

// ─── TestSchema ───────────────────────────────────────────────────────────

describe('TestSchema', () => {
  it('parses a minimal valid test', () => {
    expect(TestSchema.safeParse(validTest).success).toBe(true);
  });

  it('parses a test with all optional fields populated', () => {
    const result = TestSchema.safeParse({
      ...validTest,
      suiteId: 'suite-1',
      line: 10,
      column: 5,
      durationMs: 1234,
      tags: '["@smoke"]',
      annotations: '[{"type":"issue","description":"#123"}]',
      retryCount: 2,
      expectedStatus: 'passed',
      workerIndex: 0,
      stableId: 'stable-abc',
    });
    expect(result.success).toBe(true);
  });

  it('rejects test with invalid status', () => {
    const result = TestSchema.safeParse({ ...validTest, status: 'cancelled' });
    expect(result.success).toBe(false);
  });

  it('rejects test missing title', () => {
    const { title: _t, ...withoutTitle } = validTest;
    const result = TestSchema.safeParse(withoutTitle);
    expect(result.success).toBe(false);
  });

  it('rejects test missing file', () => {
    const { file: _f, ...withoutFile } = validTest;
    const result = TestSchema.safeParse(withoutFile);
    expect(result.success).toBe(false);
  });

  it('rejects test with non-number line', () => {
    const result = TestSchema.safeParse({ ...validTest, line: 'ten' });
    expect(result.success).toBe(false);
  });
});

// ─── StepSchema ───────────────────────────────────────────────────────────

describe('StepSchema', () => {
  const validStep = {
    title: 'click button',
    category: 'action',
    steps: [],
  };

  it('parses a minimal valid step', () => {
    expect(StepSchema.safeParse(validStep).success).toBe(true);
  });

  it('parses a step with all optional fields', () => {
    const result = StepSchema.safeParse({
      title: 'fill input',
      category: 'action',
      durationMs: 100,
      error: { message: 'Element not found', stack: 'at foo.ts:1' },
      location: { file: 'foo.ts', line: 1, column: 0 },
      steps: [
        { title: 'child step', category: 'action', steps: [] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('parses nested recursive steps', () => {
    const nested = {
      title: 'outer',
      category: 'action',
      steps: [
        {
          title: 'middle',
          category: 'action',
          steps: [
            { title: 'inner', category: 'action', steps: [] },
          ],
        },
      ],
    };
    expect(StepSchema.safeParse(nested).success).toBe(true);
  });

  it('parses error without stack', () => {
    const result = StepSchema.safeParse({
      ...validStep,
      error: { message: 'oops' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects step missing title', () => {
    const { title: _t, ...withoutTitle } = validStep;
    expect(StepSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('rejects step missing category', () => {
    const { category: _c, ...withoutCategory } = validStep;
    expect(StepSchema.safeParse(withoutCategory).success).toBe(false);
  });

  it('rejects step with missing steps array', () => {
    expect(StepSchema.safeParse({ title: 'x', category: 'y' }).success).toBe(false);
  });

  it('rejects step with invalid durationMs', () => {
    expect(StepSchema.safeParse({ ...validStep, durationMs: 'slow' }).success).toBe(false);
  });
});

// ─── ResultSchema ─────────────────────────────────────────────────────────

describe('ResultSchema', () => {
  it('parses a minimal valid result', () => {
    expect(ResultSchema.safeParse(validResult).success).toBe(true);
  });

  it('parses a result with all fields populated', () => {
    const steps = JSON.stringify([{ title: 'click', category: 'action', steps: [] }]);
    const attachments = JSON.stringify([{ name: 'screenshot', contentType: 'image/png', path: '/tmp/foo.png' }]);
    const result = ResultSchema.safeParse({
      ...validResult,
      durationMs: 5000,
      startedAt: '2024-01-01T00:00:00Z',
      errorMessage: 'Expected x to be y',
      errorStack: 'Error: ...\n  at foo.ts:1',
      workerIndex: 0,
      parallelIndex: 1,
      stdout: 'test output',
      stderr: 'error output',
      steps,
      attachments,
    });
    expect(result.success).toBe(true);
  });

  it('rejects result with invalid status', () => {
    const result = ResultSchema.safeParse({ ...validResult, status: 'done' });
    expect(result.success).toBe(false);
  });

  it('rejects result missing testId', () => {
    const { testId: _t, ...withoutTestId } = validResult;
    expect(ResultSchema.safeParse(withoutTestId).success).toBe(false);
  });

  it('rejects result with non-number retry', () => {
    expect(ResultSchema.safeParse({ ...validResult, retry: 'first' }).success).toBe(false);
  });
});

// ─── CompareChangeType ────────────────────────────────────────────────────

describe('CompareChangeType', () => {
  it.each(['new_failure', 'fixed', 'regression', 'unchanged', 'added', 'removed'])(
    'parses valid value: %s',
    (val: string) => {
      expect(CompareChangeType.safeParse(val).success).toBe(true);
    },
  );

  it('rejects an invalid value', () => {
    expect(CompareChangeType.safeParse('pending').success).toBe(false);
  });

  it('rejects undefined', () => {
    expect(CompareChangeType.safeParse(undefined).success).toBe(false);
  });
});

// ─── CompareRowSchema ─────────────────────────────────────────────────────

describe('CompareRowSchema', () => {
  const validRow = {
    title: 'Login test',
    file: 'tests/login.spec.ts',
    statusA: null,
    statusB: 'passed',
    durationA: null,
    durationB: 1200,
    changeType: 'added' as const,
  };

  it('parses a valid compare row', () => {
    expect(CompareRowSchema.safeParse(validRow).success).toBe(true);
  });

  it('parses a row with all statuses and durations set', () => {
    const result = CompareRowSchema.safeParse({
      title: 'Logout test',
      file: 'tests/logout.spec.ts',
      statusA: 'passed',
      statusB: 'failed',
      durationA: 900,
      durationB: 1100,
      changeType: 'regression',
    });
    expect(result.success).toBe(true);
  });

  it('parses a row with all nullable fields as null', () => {
    const result = CompareRowSchema.safeParse({
      ...validRow,
      statusA: null,
      statusB: null,
      durationA: null,
      durationB: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a row with invalid changeType', () => {
    const result = CompareRowSchema.safeParse({ ...validRow, changeType: 'modified' });
    expect(result.success).toBe(false);
  });

  it('rejects a row missing title', () => {
    const { title: _t, ...withoutTitle } = validRow;
    expect(CompareRowSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('rejects a row missing file', () => {
    const { file: _f, ...withoutFile } = validRow;
    expect(CompareRowSchema.safeParse(withoutFile).success).toBe(false);
  });

  it('rejects a row with non-number durationB', () => {
    expect(CompareRowSchema.safeParse({ ...validRow, durationB: 'fast' }).success).toBe(false);
  });
});

// ─── parseResult() function ───────────────────────────────────────────────

describe('parseResult', () => {
  it('returns empty steps and attachments when both are null', () => {
    const parsed = parseResult(validResult);
    expect(parsed.steps).toEqual([]);
    expect(parsed.attachments).toEqual([]);
    expect(parsed.error).toBeUndefined();
  });

  it('parses steps from JSON string', () => {
    const step = { title: 'click', category: 'action', steps: [] };
    const result: Result = { ...validResult, steps: JSON.stringify([step]) };
    const parsed = parseResult(result);
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0]?.title).toBe('click');
  });

  it('parses attachments from JSON string', () => {
    const attachment = { name: 'screenshot', contentType: 'image/png', path: '/tmp/img.png' };
    const result: Result = { ...validResult, attachments: JSON.stringify([attachment]) };
    const parsed = parseResult(result);
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]?.name).toBe('screenshot');
  });

  it('creates error object from errorMessage and errorStack', () => {
    const result: Result = {
      ...validResult,
      errorMessage: 'Expected true to be false',
      errorStack: 'Error: Expected true to be false\n  at foo.ts:10',
    };
    const parsed = parseResult(result);
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.message).toBe('Expected true to be false');
    expect(parsed.error?.stack).toBe('Error: Expected true to be false\n  at foo.ts:10');
  });

  it('creates error object without stack when errorStack is null', () => {
    const result: Result = { ...validResult, errorMessage: 'oops', errorStack: null };
    const parsed = parseResult(result);
    expect(parsed.error?.message).toBe('oops');
    expect(parsed.error?.stack).toBeUndefined();
  });

  it('returns undefined error when errorMessage is null', () => {
    const result: Result = { ...validResult, errorMessage: null, errorStack: null };
    const parsed = parseResult(result);
    expect(parsed.error).toBeUndefined();
  });

  it('preserves all base result fields', () => {
    const result: Result = {
      ...validResult,
      id: 'res99',
      testId: 'test-x',
      runId: 'run-y',
      retry: 3,
      status: 'failed',
    };
    const parsed = parseResult(result);
    expect(parsed.id).toBe('res99');
    expect(parsed.testId).toBe('test-x');
    expect(parsed.runId).toBe('run-y');
    expect(parsed.retry).toBe(3);
    expect(parsed.status).toBe('failed');
  });

  it('parses nested steps from JSON', () => {
    const nestedSteps = [
      {
        title: 'outer',
        category: 'action',
        steps: [{ title: 'inner', category: 'action', steps: [] }],
      },
    ];
    const result: Result = { ...validResult, steps: JSON.stringify(nestedSteps) };
    const parsed = parseResult(result);
    expect(parsed.steps[0]?.steps).toHaveLength(1);
    expect(parsed.steps[0]?.steps[0]?.title).toBe('inner');
  });

  it('parses multiple attachments', () => {
    const attachments = [
      { name: 'screenshot', contentType: 'image/png' },
      { name: 'video', contentType: 'video/webm', path: '/tmp/vid.webm' },
    ];
    const result: Result = { ...validResult, attachments: JSON.stringify(attachments) };
    const parsed = parseResult(result);
    expect(parsed.attachments).toHaveLength(2);
    expect(parsed.attachments[1]?.name).toBe('video');
  });
});

// ─── Mutation-killing: parseResult conditional guards ────────────────────────

describe('parseResult — ConditionalExpression mutations', () => {
  it('returns EMPTY array for steps when steps field is null — kills ConditionalExpression true mutation', () => {
    // If `r.steps ? ... : []` were mutated to always parse (true branch), this would throw
    const result: Result = { ...validResult, steps: null };
    const parsed = parseResult(result);
    expect(parsed.steps).toEqual([]);
    expect(Array.isArray(parsed.steps)).toBe(true);
  });

  it('returns EMPTY array for attachments when attachments field is null — kills ConditionalExpression true mutation', () => {
    // If `r.attachments ? ... : []` were mutated to always parse (true branch), this would throw
    const result: Result = { ...validResult, attachments: null };
    const parsed = parseResult(result);
    expect(parsed.attachments).toEqual([]);
    expect(Array.isArray(parsed.attachments)).toBe(true);
  });

  it('returns parsed steps when steps is a non-null JSON string — kills ConditionalExpression false mutation', () => {
    // If `r.steps ? ... : []` were mutated to always return [] (false branch), this would fail
    const step = { title: 'click', category: 'action', steps: [] };
    const result: Result = { ...validResult, steps: JSON.stringify([step]) };
    const parsed = parseResult(result);
    expect(parsed.steps).not.toEqual([]);
    expect(parsed.steps).toHaveLength(1);
  });

  it('returns parsed attachments when attachments is a non-null JSON string — kills ConditionalExpression false mutation', () => {
    // If `r.attachments ? ... : []` were mutated to always return [] (false branch), this would fail
    const att = { name: 'screenshot', contentType: 'image/png' };
    const result: Result = { ...validResult, attachments: JSON.stringify([att]) };
    const parsed = parseResult(result);
    expect(parsed.attachments).not.toEqual([]);
    expect(parsed.attachments).toHaveLength(1);
  });

  it('returns defined error when errorMessage is non-null — kills ConditionalExpression false mutation', () => {
    // If `r.errorMessage ? ... : undefined` were mutated to always return undefined, this fails
    const result: Result = { ...validResult, errorMessage: 'boom', errorStack: null };
    const parsed = parseResult(result);
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.message).toBe('boom');
  });

  it('returns undefined error when errorMessage is null — kills ConditionalExpression true mutation', () => {
    // If `r.errorMessage ? ... : undefined` were mutated to always build error object, this fails
    const result: Result = { ...validResult, errorMessage: null, errorStack: 'some stack' };
    const parsed = parseResult(result);
    expect(parsed.error).toBeUndefined();
  });

  it('errorStack is undefined (not null) when stack is null — kills ?? undefined mutation (MethodExpression)', () => {
    // `r.errorStack ?? undefined` — if `?? undefined` is removed, errorStack: null would be in error object
    const result: Result = { ...validResult, errorMessage: 'msg', errorStack: null };
    const parsed = parseResult(result);
    expect(parsed.error?.stack).toBeUndefined();
    expect(parsed.error?.stack).not.toBe(null);
  });
});

// ─── Mutation-killing: enum string literals ──────────────────────────────────

describe('TestStatus enum values — kills StringLiteral mutations', () => {
  it('rejects "timedout" (wrong case) — kills StringLiteral mutation on "timedOut"', () => {
    expect(TestStatus.safeParse('timedout').success).toBe(false);
  });

  it('rejects "PASSED" (uppercase) — kills StringLiteral mutation on "passed"', () => {
    expect(TestStatus.safeParse('PASSED').success).toBe(false);
  });

  it('parses exactly "timedOut" with correct casing — kills StringLiteral mutation', () => {
    expect(TestStatus.safeParse('timedOut').success).toBe(true);
  });
});

describe('RunStatus enum values — kills StringLiteral mutations', () => {
  it('rejects "complete" — kills StringLiteral mutation on "interrupted"', () => {
    expect(RunStatus.safeParse('complete').success).toBe(false);
  });

  it('parses exactly "interrupted" — kills StringLiteral mutation', () => {
    expect(RunStatus.safeParse('interrupted').success).toBe(true);
  });
});

describe('CompareChangeType enum values — kills StringLiteral mutations', () => {
  it('rejects "new_failures" (wrong spelling) — kills StringLiteral mutation on "new_failure"', () => {
    expect(CompareChangeType.safeParse('new_failures').success).toBe(false);
  });

  it('parses exactly "new_failure" — kills StringLiteral mutation', () => {
    expect(CompareChangeType.safeParse('new_failure').success).toBe(true);
  });

  it('rejects "fix" instead of "fixed" — kills StringLiteral mutation on "fixed"', () => {
    expect(CompareChangeType.safeParse('fix').success).toBe(false);
  });
});

describe('RunSchema gateStatus enum — kills StringLiteral mutations', () => {
  it('parses gateStatus="skipped" — kills StringLiteral mutation', () => {
    expect(RunSchema.safeParse({ ...validRun, gateStatus: 'skipped' }).success).toBe(true);
  });

  it('rejects gateStatus="skip" (wrong value) — kills StringLiteral mutation', () => {
    expect(RunSchema.safeParse({ ...validRun, gateStatus: 'skip' }).success).toBe(false);
  });

  it('parses source="live" — kills StringLiteral mutation', () => {
    expect(RunSchema.safeParse({ ...validRun, source: 'live' }).success).toBe(true);
  });
});
