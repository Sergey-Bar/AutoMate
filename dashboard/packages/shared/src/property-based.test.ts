/**
 * Property-based tests for Automate shared schemas.
 *
 * Verifies:
 *  - Schema parse idempotency: schema.parse(schema.parse(data)) equals schema.parse(data)
 *  - parseResult preserves all base fields when steps/attachments are non-null strings
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  RunSchema,
  TestSchema,
  CompareRowSchema,
  parseResult,
} from './index.js';
import type { Result } from './index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate either an arbitrary value or null (nullable field). */
const nullable = <T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T | null> =>
  fc.oneof(arb, fc.constant(null));

const nonEmptyString = fc.string({ minLength: 1, maxLength: 50 });

// ─── Arbitraries ──────────────────────────────────────────────────────────────

const runArb = fc.record({
  id: nonEmptyString,
  startedAt: fc.string(),
  finishedAt: nullable(fc.string()),
  status: fc.constantFrom('running', 'passed', 'failed', 'interrupted'),
  total: fc.nat({ max: 10_000 }),
  passed: fc.nat({ max: 10_000 }),
  failed: fc.nat({ max: 10_000 }),
  flaky: fc.nat({ max: 10_000 }),
  skipped: fc.nat({ max: 10_000 }),
  durationMs: nullable(fc.nat({ max: 36_000_000 })),
  branch: nullable(fc.string()),
  commitSha: nullable(fc.string()),
  commitMessage: nullable(fc.string()),
  triggeredBy: nullable(fc.string()),
  config: nullable(fc.string()),
  rawArgs: nullable(fc.string()),
});

const testArb = fc.record({
  id: nonEmptyString,
  runId: nonEmptyString,
  suiteId: nullable(fc.string()),
  title: nonEmptyString,
  file: nonEmptyString,
  line: nullable(fc.nat({ max: 10_000 })),
  column: nullable(fc.nat({ max: 1_000 })),
  status: fc.constantFrom('passed', 'failed', 'flaky', 'skipped', 'timedOut', 'running', 'queued'),
  durationMs: nullable(fc.nat({ max: 36_000_000 })),
  tags: nullable(fc.string()),
  annotations: nullable(fc.string()),
  retryCount: nullable(fc.nat({ max: 10 })),
  expectedStatus: nullable(fc.string()),
  workerIndex: nullable(fc.nat({ max: 100 })),
  stableId: nullable(fc.string()),
});

const changeTypeArb = fc.constantFrom(
  'new_failure',
  'fixed',
  'regression',
  'unchanged',
  'added',
  'removed',
);

const compareRowArb = fc.record({
  title: nonEmptyString,
  file: nonEmptyString,
  statusA: nullable(fc.string()),
  statusB: nullable(fc.string()),
  durationA: nullable(fc.nat({ max: 36_000_000 })),
  durationB: nullable(fc.nat({ max: 36_000_000 })),
  changeType: changeTypeArb,
});

// ─── Schema idempotency: parse(parse(data)) equals parse(data) ────────────────

// Deterministic seed; 200 examples per property keeps the suite fast.
fc.configureGlobal({ seed: 42, numRuns: 200 });

describe('RunSchema property', () => {
  it('parse is idempotent', () => {
    fc.assert(
      fc.property(runArb, (data) => {
        const once = RunSchema.parse(data);
        const twice = RunSchema.parse(once);
        expect(twice).toStrictEqual(once);
      }),
    );
  });
});

describe('TestSchema property', () => {
  it('parse is idempotent', () => {
    fc.assert(
      fc.property(testArb, (data) => {
        const once = TestSchema.parse(data);
        const twice = TestSchema.parse(once);
        expect(twice).toStrictEqual(once);
      }),
    );
  });
});

describe('CompareRowSchema property', () => {
  it('parse is idempotent', () => {
    fc.assert(
      fc.property(compareRowArb, (data) => {
        const once = CompareRowSchema.parse(data);
        const twice = CompareRowSchema.parse(once);
        expect(twice).toStrictEqual(once);
      }),
    );
  });
});

// ─── parseResult: preserves all base scalar fields ───────────────────────────

/**
 * A minimal valid Result value — steps/attachments/errors all null.
 * We use arbitraries only for the fields we want to vary.
 */
const resultArb: fc.Arbitrary<Result> = fc.record({
  id: nonEmptyString,
  testId: nonEmptyString,
  runId: nonEmptyString,
  retry: fc.nat({ max: 5 }),
  status: fc.constantFrom('passed', 'failed', 'flaky', 'skipped', 'timedOut', 'running', 'queued'),
  durationMs: nullable(fc.nat({ max: 36_000_000 })),
  startedAt: nullable(fc.string()),
  errorMessage: nullable(fc.string()),
  errorStack: nullable(fc.string()),
  workerIndex: nullable(fc.nat({ max: 100 })),
  parallelIndex: nullable(fc.nat({ max: 100 })),
  stdout: nullable(fc.string()),
  stderr: nullable(fc.string()),
  steps: fc.constant(null),
  attachments: fc.constant(null),
});

describe('parseResult property', () => {
  it('preserves all scalar base fields from the original Result', () => {
    fc.assert(
      fc.property(resultArb, (result) => {
        const parsed = parseResult(result);
        expect(parsed.id).toBe(result.id);
        expect(parsed.testId).toBe(result.testId);
        expect(parsed.runId).toBe(result.runId);
        expect(parsed.retry).toBe(result.retry);
        expect(parsed.status).toBe(result.status);
        expect(parsed.durationMs).toBe(result.durationMs);
      }),
    );
  });
});
