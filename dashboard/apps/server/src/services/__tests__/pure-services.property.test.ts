/**
 * T23 — Property-based tests for pure service functions.
 *
 * Covers:
 *  - predictive-selection: computeHistoricalRisk, computeScore
 *  - locator-intelligence: computeAttributeTokenOverlap, computeConfidence
 *  - nl-query: stripSQLComments, addLimitClause
 *
 * No DB access. No imports of db/drizzle/sqlite.
 * Uses fast-check directly (no @fast-check/vitest).
 */
import fc from 'fast-check';
import { computeHistoricalRisk, computeScore, WEIGHTS } from '../predictive-selection.js';
import {
  computeAttributeTokenOverlap,
  computeConfidence,
  type SelectorContext,
} from '../locator-intelligence.js';
import { stripSQLComments, addLimitClause, MAX_ROWS } from '../nl-query.js';

// Deterministic seed; 100 examples per property keeps the suite fast.
fc.configureGlobal({ seed: 42, numRuns: 100 });

// ─── Helpers ──────────────────────────────────────────────────────────────────

const unitFloat = fc.double({ min: 0, max: 1, noNaN: true });

/** Arbitrary for a CorrelationEntry with runCount > 0 */
const correlationEntry = fc.record({
  failureCount: fc.nat(),
  runCount: fc.integer({ min: 1, max: 10_000 }),
}).map(({ failureCount, runCount }) => ({
  failureCount: Math.min(failureCount, runCount), // failureCount ≤ runCount
  runCount,
}));

/** Arbitrary for a non-empty array of CorrelationEntry */
const correlationList = fc.array(correlationEntry, { minLength: 1, maxLength: 20 });

// ─── computeHistoricalRisk ────────────────────────────────────────────────────

describe('computeHistoricalRisk', () => {
  it('returns 0 for empty array', () => {
    expect(computeHistoricalRisk([])).toBe(0);
  });

  it('result is always in [0, 1]', () => {
    fc.assert(
      fc.property(correlationList, (entries) => {
        const risk = computeHistoricalRisk(entries);
        expect(risk).toBeGreaterThanOrEqual(0);
        expect(risk).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('doubling failure counts never decreases risk', () => {
    fc.assert(
      fc.property(correlationList, (entries) => {
        const base = computeHistoricalRisk(entries);
        const doubled = entries.map((e) => ({
          failureCount: Math.min(e.failureCount * 2, e.runCount),
          runCount: e.runCount,
        }));
        const higher = computeHistoricalRisk(doubled);
        expect(higher).toBeGreaterThanOrEqual(base - 1e-9); // allow float epsilon
      }),
    );
  });
});

// ─── computeScore ─────────────────────────────────────────────────────────────

describe('computeScore', () => {
  it('result is in [0, 1] when both inputs are in [0, 1]', () => {
    fc.assert(
      fc.property(unitFloat, unitFloat, (staticImpact, historicalRisk) => {
        const score = computeScore(staticImpact, historicalRisk);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1 + 1e-9); // weights sum to 1.0
      }),
    );
  });

  it('is a weighted linear combination of inputs', () => {
    fc.assert(
      fc.property(unitFloat, unitFloat, (s, h) => {
        const expected = WEIGHTS.static * s + WEIGHTS.historical * h;
        expect(computeScore(s, h)).toBeCloseTo(expected, 10);
      }),
    );
  });

  it('is monotone: higher staticImpact → higher or equal score (historicalRisk fixed)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        fc.double({ min: 0.5, max: 1, noNaN: true }),
        unitFloat,
        (low, high, h) => {
          expect(computeScore(high, h)).toBeGreaterThanOrEqual(computeScore(low, h) - 1e-9);
        },
      ),
    );
  });
});

// ─── computeAttributeTokenOverlap ────────────────────────────────────────────

describe('computeAttributeTokenOverlap', () => {
  const selector = fc.string({ minLength: 0, maxLength: 80 });

  it('result is always in [0, 1]', () => {
    fc.assert(
      fc.property(selector, selector, (a, b) => {
        const overlap = computeAttributeTokenOverlap(a, b);
        expect(overlap).toBeGreaterThanOrEqual(0);
        expect(overlap).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('is symmetric: overlap(a, b) === overlap(b, a)', () => {
    fc.assert(
      fc.property(selector, selector, (a, b) => {
        expect(computeAttributeTokenOverlap(a, b)).toBeCloseTo(
          computeAttributeTokenOverlap(b, a),
          10,
        );
      }),
    );
  });

  it('identity: overlap(s, s) === 1 for any string', () => {
    fc.assert(
      fc.property(selector, (s) => {
        expect(computeAttributeTokenOverlap(s, s)).toBe(1);
      }),
    );
  });
});

// ─── computeConfidence ────────────────────────────────────────────────────────

describe('computeConfidence', () => {
  const selector = fc.string({ minLength: 1, maxLength: 80 });
  const nullableString = fc.option(fc.string({ minLength: 0, maxLength: 120 }), { nil: null as null });
  const historicalSelectors = fc.array(fc.string({ minLength: 1, maxLength: 80 }), {
    minLength: 0,
    maxLength: 5,
  });

  const contextArb = fc.record<SelectorContext>({
    originalSelector: selector,
    errorMessage: nullableString,
    pageContent: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
    historicalSelectors: fc.option(historicalSelectors, { nil: undefined }),
  });

  it('result is always in [0, 1]', () => {
    fc.assert(
      fc.property(selector, selector, contextArb, (original, candidate, context) => {
        const confidence = computeConfidence(original, candidate, context);
        expect(confidence).toBeGreaterThanOrEqual(0);
        expect(confidence).toBeLessThanOrEqual(1 + 1e-9);
      }),
    );
  });
});

// ─── stripSQLComments ─────────────────────────────────────────────────────────

describe('stripSQLComments', () => {
  it('is idempotent: strip(strip(s)) === strip(s)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (sql) => {
        const once = stripSQLComments(sql);
        const twice = stripSQLComments(once);
        expect(twice).toBe(once);
      }),
    );
  });

  it('output contains no block comments', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (sql) => {
        const stripped = stripSQLComments(sql);
        expect(stripped).not.toMatch(/\/\*/);
      }),
    );
  });

  it('output contains no line comments', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (sql) => {
        const stripped = stripSQLComments(sql);
        expect(stripped).not.toMatch(/--/);
      }),
    );
  });
});

// ─── addLimitClause ───────────────────────────────────────────────────────────

describe('addLimitClause', () => {
  /** Generates a simple SELECT without a LIMIT clause */
  const selectNoLimit = fc
    .string({ minLength: 1, maxLength: 100 })
    .map((s) => `SELECT ${s.replace(/;/g, '')} FROM runs`);

  it('is idempotent: addLimit(addLimit(s)) === addLimit(s)', () => {
    fc.assert(
      fc.property(selectNoLimit, (sql) => {
        const once = addLimitClause(sql);
        const twice = addLimitClause(once);
        expect(twice).toBe(once);
      }),
    );
  });

  it('output always contains a LIMIT clause', () => {
    fc.assert(
      fc.property(selectNoLimit, (sql) => {
        expect(addLimitClause(sql)).toMatch(/\bLIMIT\b/i);
      }),
    );
  });

  it('LIMIT value is always ≤ MAX_ROWS', () => {
    fc.assert(
      fc.property(selectNoLimit, (sql) => {
        const result = addLimitClause(sql);
        const match = result.match(/\bLIMIT\s+(\d+)/i);
        expect(match).not.toBeNull();
        const limit = parseInt(match![1]!, 10);
        expect(limit).toBeLessThanOrEqual(MAX_ROWS);
      }),
    );
  });

  it('caps an existing LIMIT that exceeds MAX_ROWS', () => {
    const oversized = `SELECT id FROM runs LIMIT ${MAX_ROWS + 500}`;
    const result = addLimitClause(oversized);
    const match = result.match(/\bLIMIT\s+(\d+)/i);
    expect(match).not.toBeNull();
    expect(parseInt(match![1]!, 10)).toBe(MAX_ROWS);
  });

  it('preserves an existing LIMIT that is within MAX_ROWS', () => {
    const small = `SELECT id FROM runs LIMIT 10`;
    expect(addLimitClause(small)).toBe(small);
  });
});
