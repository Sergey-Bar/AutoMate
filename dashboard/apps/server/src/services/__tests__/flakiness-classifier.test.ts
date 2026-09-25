import { describe, it, expect } from 'vitest';
import { classifyFlakiness } from '../flakiness-classifier.js';

describe('classifyFlakiness', () => {
  // ── Basic category detection ─────────────────────────────────────────────

  it('classifies timing errors correctly', () => {
    const result = classifyFlakiness({
      testTitle: 'login flow',
      errorMessages: ['Element timed out waiting for selector'],
    });
    expect(result.category).toBe('timing');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies environment errors correctly', () => {
    const result = classifyFlakiness({
      testTitle: 'api call test',
      errorMessages: ['ECONNREFUSED 127.0.0.1:3000'],
    });
    expect(result.category).toBe('environment');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies data errors correctly', () => {
    const result = classifyFlakiness({
      testTitle: 'create user test',
      errorMessages: ['unique constraint violation on users.email'],
    });
    expect(result.category).toBe('data');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies assertion_drift errors correctly', () => {
    const result = classifyFlakiness({
      testTitle: 'counter test',
      errorMessages: ['expected 100 got 98'],
    });
    expect(result.category).toBe('assertion_drift');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies assertion_drift with "to be" pattern', () => {
    const result = classifyFlakiness({
      testTitle: 'balance test',
      errorMessages: ['100.5 to be 100.0'],
    });
    expect(result.category).toBe('assertion_drift');
  });

  it('classifies assertion_drift with "to equal" pattern', () => {
    const result = classifyFlakiness({
      testTitle: 'count test',
      errorMessages: ['42 to equal 43'],
    });
    expect(result.category).toBe('assertion_drift');
  });

  // ── Unknown category ─────────────────────────────────────────────────────

  it('returns unknown for unrecognised error messages', () => {
    const result = classifyFlakiness({
      testTitle: 'weird test',
      errorMessages: ['Something unexpected happened in the pipeline'],
    });
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0.3);
  });

  it('returns unknown with confidence 0.3 for empty errorMessages array', () => {
    const result = classifyFlakiness({
      testTitle: 'no errors test',
      errorMessages: [],
    });
    expect(result.category).toBe('unknown');
    expect(result.confidence).toBe(0.3);
    expect(result.evidence).toEqual([]);
  });

  // ── Confidence capping ───────────────────────────────────────────────────

  it('caps confidence at 0.9 even when all errors match timing', () => {
    const result = classifyFlakiness({
      testTitle: 'async test',
      errorMessages: [
        'timeout waiting for element',
        'timed out after 30s',
        'race condition detected',
      ],
    });
    expect(result.category).toBe('timing');
    expect(result.confidence).toBe(0.9);
  });

  it('returns 0.9 confidence when 1 error matches (1 match / 1 error = 1.0, capped)', () => {
    const result = classifyFlakiness({
      testTitle: 'single error test',
      errorMessages: ['ECONNREFUSED localhost:5432'],
    });
    expect(result.category).toBe('environment');
    expect(result.confidence).toBe(0.9);
  });

  // ── Tie-breaking by priority ─────────────────────────────────────────────

  it('prefers timing over environment on a tie', () => {
    // 2 timing matches, 2 environment matches → timing wins (priority 4 > 3)
    const result = classifyFlakiness({
      testTitle: 'flaky multi',
      errorMessages: [
        'timeout waiting',
        'ECONNREFUSED 127.0.0.1:3000',
        'timed out after 10s',
        'network error occurred',
      ],
    });
    expect(result.category).toBe('timing');
  });

  it('prefers timing over data on a tie', () => {
    const result = classifyFlakiness({
      testTitle: 'tie test',
      errorMessages: [
        'timed out after 5s',
        'unique constraint violation',
      ],
    });
    expect(result.category).toBe('timing');
  });

  it('prefers environment over data on a tie', () => {
    const result = classifyFlakiness({
      testTitle: 'env vs data',
      errorMessages: [
        'ENOTFOUND api.example.com',
        'duplicate key error',
      ],
    });
    expect(result.category).toBe('environment');
  });

  it('prefers data over assertion_drift on a tie', () => {
    const result = classifyFlakiness({
      testTitle: 'data vs assertion',
      errorMessages: [
        'stale data detected',
        'expected 5 got 4',
      ],
    });
    expect(result.category).toBe('data');
  });

  // ── Evidence ─────────────────────────────────────────────────────────────

  it('includes matched text in evidence array', () => {
    const result = classifyFlakiness({
      testTitle: 'evidence test',
      errorMessages: ['Element timed out waiting for visible'],
    });
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.some((e) => /timeout|timed out/i.test(e))).toBe(true);
  });

  it('returns empty evidence for unknown category', () => {
    const result = classifyFlakiness({
      testTitle: 'no match test',
      errorMessages: ['Completely unrecognised error text'],
    });
    expect(result.evidence).toEqual([]);
  });

  it('deduplicates identical evidence entries', () => {
    const result = classifyFlakiness({
      testTitle: 'dedup test',
      errorMessages: [
        'ECONNREFUSED 127.0.0.1:3000',
        'ECONNREFUSED 127.0.0.1:5432',
      ],
    });
    // Both contain "ECONNREFUSED" — evidence should deduplicate same matched text
    const econnCount = result.evidence.filter((e) => e === 'ECONNREFUSED').length;
    expect(econnCount).toBeLessThanOrEqual(1);
  });

  // ── Multiple errors with a clear winner ──────────────────────────────────

  it('picks the category with the most matches across all errors', () => {
    // 3 timing, 1 environment → timing wins
    const result = classifyFlakiness({
      testTitle: 'mixed errors',
      errorMessages: [
        'timeout after 5000ms',
        'parallel worker crashed',
        'timed out waiting',
        'ECONNREFUSED 127.0.0.1:3000',
      ],
    });
    expect(result.category).toBe('timing');
    // confidence = Math.min(3/4, 0.9) = 0.75
    expect(result.confidence).toBeCloseTo(0.75);
  });

  // ── Case insensitivity ───────────────────────────────────────────────────

  it('matches patterns case-insensitively', () => {
    const result = classifyFlakiness({
      testTitle: 'case test',
      errorMessages: ['TIMEOUT waiting for element'],
    });
    expect(result.category).toBe('timing');
  });

  it('matches "socket hang up" for environment', () => {
    const result = classifyFlakiness({
      testTitle: 'socket test',
      errorMessages: ['socket hang up'],
    });
    expect(result.category).toBe('environment');
  });

  it('matches "expected ... received ..." assertion_drift pattern', () => {
    const result = classifyFlakiness({
      testTitle: 'assertion test',
      errorMessages: ['expected 3.14 received 3.15'],
    });
    expect(result.category).toBe('assertion_drift');
  });
});
