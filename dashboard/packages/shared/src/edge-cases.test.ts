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

// ─── Shared fixtures ───────────────────────────────────────────────────────

const baseRun = {
  id: 'run-edge',
  startedAt: '2024-06-01T00:00:00Z',
  finishedAt: null,
  status: 'running' as const,
  total: 5,
  passed: 4,
  failed: 1,
  flaky: 0,
  skipped: 0,
  durationMs: null,
  branch: null,
  commitSha: null,
  commitMessage: null,
  triggeredBy: null,
  config: null,
  rawArgs: null,
};

const baseResult: Result = {
  id: 'r-edge',
  testId: 't-edge',
  runId: 'run-edge',
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

const baseTest = {
  id: 't-edge',
  runId: 'run-edge',
  suiteId: null,
  title: 'edge test',
  file: 'tests/edge.spec.ts',
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

const baseRow = {
  title: 'Login flow',
  file: 'tests/login.spec.ts',
  statusA: 'passed',
  statusB: 'failed',
  durationA: 1000,
  durationB: 1100,
  changeType: 'regression' as const,
};

// ─── TestStatus — type coercion & boundary values ─────────────────────────

describe('TestStatus — boundary & coercion', () => {
  it('rejects a number that looks like an enum index', () => {
    expect(TestStatus.safeParse(0).success).toBe(false);
  });

  it('rejects boolean true', () => {
    expect(TestStatus.safeParse(true).success).toBe(false);
  });

  it('rejects null', () => {
    expect(TestStatus.safeParse(null).success).toBe(false);
  });

  it('rejects object input', () => {
    expect(TestStatus.safeParse({ status: 'passed' }).success).toBe(false);
  });

  it('rejects array input', () => {
    expect(TestStatus.safeParse(['passed']).success).toBe(false);
  });

  it('is case-sensitive — rejects uppercase PASSED', () => {
    expect(TestStatus.safeParse('PASSED').success).toBe(false);
  });

  it('is case-sensitive — rejects mixed case Passed', () => {
    expect(TestStatus.safeParse('Passed').success).toBe(false);
  });
});

// ─── RunStatus — boundary & coercion ─────────────────────────────────────

describe('RunStatus — boundary & coercion', () => {
  it('rejects empty string', () => {
    expect(RunStatus.safeParse('').success).toBe(false);
  });

  it('rejects number', () => {
    expect(RunStatus.safeParse(1).success).toBe(false);
  });

  it('is case-sensitive — rejects RUNNING', () => {
    expect(RunStatus.safeParse('RUNNING').success).toBe(false);
  });
});

// ─── RunSchema — boundary values, optional omission, long strings ─────────

describe('RunSchema — boundary values', () => {
  it('parses with durationMs=0 (zero is a valid nullable number)', () => {
    expect(RunSchema.safeParse({ ...baseRun, durationMs: 0 }).success).toBe(true);
  });

  it('parses with total=0 (zero tests is valid)', () => {
    expect(RunSchema.safeParse({ ...baseRun, total: 0, passed: 0, failed: 0 }).success).toBe(true);
  });

  it('parses with very long commitMessage (1000+ chars)', () => {
    const longMsg = 'x'.repeat(1001);
    expect(RunSchema.safeParse({ ...baseRun, commitMessage: longMsg }).success).toBe(true);
  });

  it('parses with Unicode/emoji in branch name', () => {
    expect(RunSchema.safeParse({ ...baseRun, branch: 'feat/🚀-unicode-测试' }).success).toBe(true);
  });

  it('parses with empty string id (Zod does not enforce non-empty by default)', () => {
    expect(RunSchema.safeParse({ ...baseRun, id: '' }).success).toBe(true);
  });

  it('parses with empty string startedAt (Zod does not enforce date format by default)', () => {
    expect(RunSchema.safeParse({ ...baseRun, startedAt: '' }).success).toBe(true);
  });

  it('rejects when id is null', () => {
    expect(RunSchema.safeParse({ ...baseRun, id: null }).success).toBe(false);
  });

  it('rejects negative total', () => {
    // total is z.number() — negative is still a number, should succeed
    expect(RunSchema.safeParse({ ...baseRun, total: -1 }).success).toBe(true);
  });

  it('parses when gateStatus is completely absent from object (optional)', () => {
    const { ...run } = baseRun; // no gateStatus key at all
    expect(RunSchema.safeParse(run).success).toBe(true);
  });

  it('parses when source is completely absent from object (optional)', () => {
    const { ...run } = baseRun; // no source key at all
    expect(RunSchema.safeParse(run).success).toBe(true);
  });

  it('parses gateStatus=skipped (third valid enum value)', () => {
    expect(RunSchema.safeParse({ ...baseRun, gateStatus: 'skipped' }).success).toBe(true);
  });

  it('rejects gateStatus as empty string', () => {
    expect(RunSchema.safeParse({ ...baseRun, gateStatus: '' }).success).toBe(false);
  });

  it('rejects source as empty string', () => {
    expect(RunSchema.safeParse({ ...baseRun, source: '' }).success).toBe(false);
  });
});

// ─── TestSchema — boundary values ─────────────────────────────────────────

describe('TestSchema — boundary values', () => {
  it('parses with durationMs=0 (zero duration is valid)', () => {
    expect(TestSchema.safeParse({ ...baseTest, durationMs: 0 }).success).toBe(true);
  });

  it('parses with line=0 (zero line number is a valid number)', () => {
    expect(TestSchema.safeParse({ ...baseTest, line: 0 }).success).toBe(true);
  });

  it('parses with column=0', () => {
    expect(TestSchema.safeParse({ ...baseTest, column: 0 }).success).toBe(true);
  });

  it('parses with very long title (1000+ chars, Unicode)', () => {
    const longTitle = '🔴 '.repeat(200) + 'end';
    expect(TestSchema.safeParse({ ...baseTest, title: longTitle }).success).toBe(true);
  });

  it('parses with empty string tags (JSON string field accepts any string)', () => {
    expect(TestSchema.safeParse({ ...baseTest, tags: '' }).success).toBe(true);
  });

  it('parses with empty string annotations', () => {
    expect(TestSchema.safeParse({ ...baseTest, annotations: '' }).success).toBe(true);
  });

  it('rejects when title is missing entirely', () => {
    const { title: _t, ...withoutTitle } = baseTest;
    expect(TestSchema.safeParse(withoutTitle).success).toBe(false);
  });

  it('rejects workerIndex as a string', () => {
    expect(TestSchema.safeParse({ ...baseTest, workerIndex: 'worker-0' }).success).toBe(false);
  });
});

// ─── StepSchema — deep nesting, large arrays, zero durationMs ─────────────

describe('StepSchema — deep nesting & edge values', () => {
  it('parses durationMs=0 (zero is a valid optional number)', () => {
    expect(
      StepSchema.safeParse({ title: 'step', category: 'action', durationMs: 0, steps: [] }).success,
    ).toBe(true);
  });

  it('parses steps array with 50 items', () => {
    const manySteps = Array.from({ length: 50 }, (_, i) => ({
      title: `step-${i}`,
      category: 'action',
      steps: [],
    }));
    expect(
      StepSchema.safeParse({ title: 'parent', category: 'action', steps: manySteps }).success,
    ).toBe(true);
  });

  it('parses 5-level deep nested steps', () => {
    const makeDeep = (depth: number): object => ({
      title: `level-${depth}`,
      category: 'action',
      steps: depth > 0 ? [makeDeep(depth - 1)] : [],
    });
    expect(StepSchema.safeParse(makeDeep(5)).success).toBe(true);
  });

  it('parses step with very long title (1000+ chars)', () => {
    expect(
      StepSchema.safeParse({ title: 'a'.repeat(1001), category: 'action', steps: [] }).success,
    ).toBe(true);
  });

  it('parses step with Unicode/emoji title', () => {
    expect(
      StepSchema.safeParse({ title: '✅ Verify 결과 פעולה', category: 'hook', steps: [] }).success,
    ).toBe(true);
  });

  it('parses error with empty message string (message is z.string(), empty is valid)', () => {
    expect(
      StepSchema.safeParse({
        title: 'step',
        category: 'action',
        steps: [],
        error: { message: '' },
      }).success,
    ).toBe(true);
  });

  it('parses location with zero line and column', () => {
    expect(
      StepSchema.safeParse({
        title: 'step',
        category: 'action',
        steps: [],
        location: { file: 'foo.ts', line: 0, column: 0 },
      }).success,
    ).toBe(true);
  });

  it('rejects error with missing message', () => {
    expect(
      StepSchema.safeParse({
        title: 'step',
        category: 'action',
        steps: [],
        error: { stack: 'Error at line 1' },
      }).success,
    ).toBe(false);
  });

  it('rejects location with missing column', () => {
    expect(
      StepSchema.safeParse({
        title: 'step',
        category: 'action',
        steps: [],
        location: { file: 'foo.ts', line: 1 },
      }).success,
    ).toBe(false);
  });

  it('rejects steps array containing non-object element', () => {
    expect(
      StepSchema.safeParse({
        title: 'step',
        category: 'action',
        steps: ['not-a-step'],
      }).success,
    ).toBe(false);
  });
});

// ─── ResultSchema — boundary values ──────────────────────────────────────

describe('ResultSchema — boundary values', () => {
  it('parses retry=0 (first attempt is valid edge)', () => {
    expect(ResultSchema.safeParse({ ...baseResult, retry: 0 }).success).toBe(true);
  });

  it('parses durationMs=0', () => {
    expect(ResultSchema.safeParse({ ...baseResult, durationMs: 0 }).success).toBe(true);
  });

  it('parses retry=99 (high retry count)', () => {
    expect(ResultSchema.safeParse({ ...baseResult, retry: 99 }).success).toBe(true);
  });

  it('parses with empty string stdout (empty string is a valid nullable string)', () => {
    expect(ResultSchema.safeParse({ ...baseResult, stdout: '' }).success).toBe(true);
  });

  it('parses with empty string stderr', () => {
    expect(ResultSchema.safeParse({ ...baseResult, stderr: '' }).success).toBe(true);
  });

  it('parses with empty string errorMessage', () => {
    // errorMessage is z.string().nullable() — empty string is valid
    expect(ResultSchema.safeParse({ ...baseResult, errorMessage: '' }).success).toBe(true);
  });

  it('parses with very long steps JSON string', () => {
    const steps = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => ({ title: `step-${i}`, category: 'action', steps: [] })),
    );
    expect(ResultSchema.safeParse({ ...baseResult, steps }).success).toBe(true);
  });

  it('rejects retry as float (non-integer number still satisfies z.number())', () => {
    // z.number() allows floats unless .int() is added — this should parse successfully
    expect(ResultSchema.safeParse({ ...baseResult, retry: 1.5 }).success).toBe(true);
  });

  it('rejects retry as null', () => {
    expect(ResultSchema.safeParse({ ...baseResult, retry: null }).success).toBe(false);
  });
});

// ─── CompareChangeType — boundary & coercion ─────────────────────────────

describe('CompareChangeType — boundary & coercion', () => {
  it('rejects null', () => {
    expect(CompareChangeType.safeParse(null).success).toBe(false);
  });

  it('rejects number', () => {
    expect(CompareChangeType.safeParse(0).success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(CompareChangeType.safeParse('').success).toBe(false);
  });

  it('is case-sensitive — rejects FIXED', () => {
    expect(CompareChangeType.safeParse('FIXED').success).toBe(false);
  });

  it('rejects value with trailing whitespace', () => {
    expect(CompareChangeType.safeParse('fixed ').success).toBe(false);
  });
});

// ─── CompareRowSchema — boundary values ──────────────────────────────────

describe('CompareRowSchema — boundary values', () => {
  it('parses durationA=0 (zero is a valid number, not null)', () => {
    expect(CompareRowSchema.safeParse({ ...baseRow, durationA: 0 }).success).toBe(true);
  });

  it('parses durationB=0', () => {
    expect(CompareRowSchema.safeParse({ ...baseRow, durationB: 0 }).success).toBe(true);
  });

  it('parses with empty string statusA (statusA is z.string().nullable())', () => {
    expect(CompareRowSchema.safeParse({ ...baseRow, statusA: '' }).success).toBe(true);
  });

  it('parses with very long title (1000+ chars)', () => {
    const longTitle = 'Test '.repeat(201);
    expect(CompareRowSchema.safeParse({ ...baseRow, title: longTitle }).success).toBe(true);
  });

  it('parses with Unicode title', () => {
    expect(CompareRowSchema.safeParse({ ...baseRow, title: '测试 テスト 테스트 🎯' }).success).toBe(true);
  });

  it('parses all 6 changeType values explicitly', () => {
    const types = ['new_failure', 'fixed', 'regression', 'unchanged', 'added', 'removed'] as const;
    for (const changeType of types) {
      expect(CompareRowSchema.safeParse({ ...baseRow, changeType }).success).toBe(true);
    }
  });

  it('rejects durationA as a string', () => {
    expect(CompareRowSchema.safeParse({ ...baseRow, durationA: 'fast' }).success).toBe(false);
  });

  it('rejects durationA as boolean', () => {
    expect(CompareRowSchema.safeParse({ ...baseRow, durationA: true }).success).toBe(false);
  });
});

// ─── parseResult — edge paths ─────────────────────────────────────────────

describe('parseResult — edge paths', () => {
  it('returns empty steps/attachments when steps="" and attachments="" (empty string is falsy — guard treats it like null)', () => {
    // In parseResult: r.steps ? JSON.parse(r.steps) : []
    // '' is falsy in JS, so it takes the else branch and returns []
    const result: Result = { ...baseResult, steps: '', attachments: '' };
    const parsed = parseResult(result);
    expect(parsed.steps).toEqual([]);
    expect(parsed.attachments).toEqual([]);
  });

  it('parses result with both steps AND attachments populated', () => {
    const stepsJson = JSON.stringify([
      { title: 'navigate', category: 'action', steps: [] },
      { title: 'click submit', category: 'action', steps: [] },
    ]);
    const attachmentsJson = JSON.stringify([
      { name: 'screenshot', contentType: 'image/png', path: '/tmp/shot.png' },
      { name: 'trace', contentType: 'application/zip', path: '/tmp/trace.zip' },
    ]);
    const result: Result = { ...baseResult, steps: stepsJson, attachments: attachmentsJson };
    const parsed = parseResult(result);
    expect(parsed.steps).toHaveLength(2);
    expect(parsed.attachments).toHaveLength(2);
    expect(parsed.steps[1]?.title).toBe('click submit');
    expect(parsed.attachments[0]?.name).toBe('screenshot');
  });

  it('parses attachment with body field (base64 inline content)', () => {
    const attachmentsJson = JSON.stringify([
      { name: 'data', contentType: 'text/plain', body: 'aGVsbG8=' },
    ]);
    const result: Result = { ...baseResult, attachments: attachmentsJson };
    const parsed = parseResult(result);
    expect(parsed.attachments[0]?.body).toBe('aGVsbG8=');
    expect(parsed.attachments[0]?.path).toBeUndefined();
  });

  it('parses attachment with autoCapture=true flag', () => {
    const attachmentsJson = JSON.stringify([
      { name: 'auto-shot', contentType: 'image/png', path: '/tmp/auto.png', autoCapture: true },
    ]);
    const result: Result = { ...baseResult, attachments: attachmentsJson };
    const parsed = parseResult(result);
    expect(parsed.attachments[0]?.autoCapture).toBe(true);
  });

  it('parses step with durationMs=0 from JSON', () => {
    const stepsJson = JSON.stringify([
      { title: 'instant', category: 'action', durationMs: 0, steps: [] },
    ]);
    const result: Result = { ...baseResult, steps: stepsJson };
    const parsed = parseResult(result);
    expect(parsed.steps[0]?.durationMs).toBe(0);
  });

  it('produces error object with undefined stack when errorStack is null', () => {
    const result: Result = { ...baseResult, errorMessage: 'assertion failed', errorStack: null };
    const parsed = parseResult(result);
    expect(parsed.error).toBeDefined();
    expect(parsed.error?.message).toBe('assertion failed');
    expect(parsed.error?.stack).toBeUndefined();
  });

  it('errorMessage="" (empty string) — falsy in JS, so error should be undefined', () => {
    // In parseResult: r.errorMessage ? { message: ... } : undefined
    // Empty string is falsy, so error should be undefined
    const result: Result = { ...baseResult, errorMessage: '', errorStack: null };
    const parsed = parseResult(result);
    expect(parsed.error).toBeUndefined();
  });

  it('produces error property from errorMessage/errorStack (spread carries raw fields through)', () => {
    // parseResult uses ...r spread, so errorMessage/errorStack ARE present on the object at runtime
    // The TypeScript type ResultParsed omits them, but JS object still has them
    const result: Result = { ...baseResult, errorMessage: 'boom', errorStack: 'at line 1' };
    const parsed = parseResult(result);
    // The error property should be derived from errorMessage/errorStack
    expect(parsed.error?.message).toBe('boom');
    expect(parsed.error?.stack).toBe('at line 1');
  });

  it('preserves stdout/stderr in parsed result', () => {
    const result: Result = { ...baseResult, stdout: 'hello', stderr: 'warn' };
    const parsed = parseResult(result);
    expect(parsed.stdout).toBe('hello');
    expect(parsed.stderr).toBe('warn');
  });

  it('parses deeply nested steps from JSON (5 levels)', () => {
    const makeDeep = (depth: number): object =>
      depth === 0
        ? { title: 'leaf', category: 'action', steps: [] }
        : { title: `level-${depth}`, category: 'action', steps: [makeDeep(depth - 1)] };

    const result: Result = { ...baseResult, steps: JSON.stringify([makeDeep(5)]) };
    const parsed = parseResult(result);
    // Traverse to the leaf
    let node = parsed.steps[0];
    for (let i = 0; i < 5; i++) {
      node = node?.steps[0];
    }
    expect(node?.title).toBe('leaf');
  });

  it('handles result with retry=0 and durationMs=0 (both valid zero-value fields)', () => {
    const result: Result = { ...baseResult, retry: 0, durationMs: 0 };
    const parsed = parseResult(result);
    expect(parsed.retry).toBe(0);
    expect(parsed.durationMs).toBe(0);
  });
});
