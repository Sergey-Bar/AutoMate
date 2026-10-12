import { describe, expect, it } from 'vitest';
import type { QaScore } from './qa.js';
import { deriveFindings, type FindingsSnapshot, type Reading } from './findings.js';

/**
 * The findings engine, tested directly.
 *
 * These rules used to live behind the cockpit's render, where a test had to
 * mount seven reads to check one sentence. They are the product — a zero caps
 * the mean, a flaky cell is a decision — so each rule is asserted here with
 * nothing mounted, and the source and citation each finding carries are asserted
 * with it: a finding the reader cannot trace back to the read it came from is a
 * claim the reader has to trust.
 */

/** A settled read of nothing. */
function none<T>(): Reading<T> {
  return { value: null, failure: null };
}

/** A failed read, which is a different claim from an empty one. */
function failed<T>(failure = 'boom'): Reading<T> {
  return { value: null, failure };
}

/** A settled read with a value. */
function of<T>(value: T): Reading<T> {
  return { value, failure: null };
}

/** The minimum a score needs for the rules that read it. */
function score(overrides: Partial<QaScore> = {}): QaScore {
  return {
    projectId: 'p1',
    at: '2026-10-11T00:00:00.000Z',
    total: 42,
    cappedBy: 'e2e',
    cappingValue: 0.4,
    cells: [],
    surfaces: { backend: 0, frontend: 0, platform: 0 },
    rows: [],
    pyramid: {
      observed: { unit: 0.8, integration: 0.15, e2e: 0.05 },
      target: { unit: 0.7, integration: 0.2, e2e: 0.1 },
      declaredTarget: null,
      shape: 0.9,
      drift: 0.1,
    },
    gaps: [],
    findings: [],
    provenance: {
      projectId: 'p1',
      detectorVersion: 1,
      runsRead: 3,
      resultsRead: 40,
      infraFailedRuns: [],
      infraFailedRate: 0,
      quarantinedFingerprints: [],
      outcomeCounts: {},
    },
    weights: {
      cell: { depth: 1 / 3, stability: 1 / 3, signal: 1 / 3 },
      rows: { unit: 0.2, integration: 0.2, e2e: 0.2, performance: 0.2, security: 0.2 },
      pyramid: 0,
    },
    // The empty series: no earlier window was read. The rules never read the
    // trend, so a fixture that invented one would be decoration.
    trend: { points: [], labels: [] },
    ...overrides,
  };
}

/** A snapshot where every read is empty. */
function emptySnapshot(): FindingsSnapshot {
  return {
    analytics: none(),
    score: none(),
    flaky: none(),
    gaps: none(),
    quarantine: none(),
    hollow: none(),
    structure: none(),
  };
}

describe('deriveFindings', () => {
  it('emits nothing from a snapshot where every read is empty', () => {
    // The empty case is the one a UI renders most, and a rule that fires on
    // missing data produces a dashboard that cries wolf on an empty install.
    expect(deriveFindings(emptySnapshot())).toEqual([]);
  });

  it('treats a failed read as absent, not as a zero', () => {
    // `read()` settles a failure as `failure`, and the rule for a zero reads
    // `cappingValue === 0`. A failed read must not arrive as a score whose
    // capping value is zero, or every dead endpoint invents a critical.
    const snapshot: FindingsSnapshot = { ...emptySnapshot(), score: failed() };
    expect(deriveFindings(snapshot).some((insight) => insight.id === 'zero-caps-mean')).toBe(false);
  });

  describe('rule 1: a zero caps the geometric mean', () => {
    it('is critical and names the row that capped the total', () => {
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        score: of(score({ cappedBy: 'security', cappingValue: 0 })),
      };
      const insight = deriveFindings(snapshot).find((entry) => entry.id === 'zero-caps-mean');
      expect(insight).toBeDefined();
      expect(insight?.severity).toBe('critical');
      expect(insight?.statement).toContain('security');
      expect(insight?.citation).toContain('cappedBy=security');
      expect(insight?.citation).toContain('cappingValue=0');
    });

    it('does not fire when the cap is positive, however thin', () => {
      const snapshot: FindingsSnapshot = { ...emptySnapshot(), score: of(score()) };
      expect(deriveFindings(snapshot).some((insight) => insight.id === 'zero-caps-mean')).toBe(
        false,
      );
    });
  });

  describe('rule 2: flaky cells are decisions', () => {
    it('ranks by flake rate and names the worst cell', () => {
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        flaky: of({
          cells: [
            { cell: 'unit:backend', flakyFingerprints: ['a'], flakeRate: 0.1, stability: 0.9 },
            { cell: 'e2e:frontend', flakyFingerprints: ['b', 'c'], flakeRate: 0.4, stability: 0.6 },
          ],
        }),
      };
      const insight = deriveFindings(snapshot).find((entry) => entry.id === 'flaky-decision');
      expect(insight?.severity).toBe('critical');
      expect(insight?.title).toContain('2');
      expect(insight?.statement).toContain('e2e:frontend');
      expect(insight?.statement).toContain('40.0%');
      expect(insight?.citation).toContain('worst e2e:frontend at 40.0%');
    });

    it('is singular for one cell, because the grammar is the claim', () => {
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        flaky: of({
          cells: [
            { cell: 'unit:backend', flakyFingerprints: ['a'], flakeRate: 0.2, stability: 0.8 },
          ],
        }),
      };
      const insight = deriveFindings(snapshot).find((entry) => entry.id === 'flaky-decision');
      expect(insight?.title).toBe('1 flaky cell needs a decision');
    });
  });

  describe('rule 3: hollow tests inflate the pass rate', () => {
    it('is singular for one hollow cell, and plural for more', () => {
      // The grammar is part of the claim: "1 hollow test inflates" and "2 hollow
      // tests inflate" are the same rule at two counts, and a title that reads
      // "1 hollow tests" tells the reader nobody is watching the sentence.
      const one: FindingsSnapshot = {
        ...emptySnapshot(),
        hollow: of({ cells: [{ cell: 'unit:backend', hollowFingerprints: ['h1'], signal: 0.2 }] }),
      };
      const two: FindingsSnapshot = {
        ...emptySnapshot(),
        hollow: of({
          cells: [
            { cell: 'unit:backend', hollowFingerprints: ['h1'], signal: 0.2 },
            { cell: 'e2e:frontend', hollowFingerprints: ['h2'], signal: 0.3 },
          ],
        }),
      };
      expect(deriveFindings(one).find((entry) => entry.id === 'hollow-tests')?.title).toBe(
        '1 hollow test inflates the pass rate',
      );
      expect(deriveFindings(two).find((entry) => entry.id === 'hollow-tests')?.title).toBe(
        '2 hollow tests inflate the pass rate',
      );
    });

    it('distinguishes "no hollow cells" from "the read failed"', () => {
      // `hollow` arrives as `value: null` with no failure when there are none,
      // and as a failure when the endpoint died. Both render as no insight —
      // but the failed read is reported by the failure notice, not here.
      const snapshot: FindingsSnapshot = { ...emptySnapshot(), hollow: failed('503') };
      expect(deriveFindings(snapshot).some((insight) => insight.id === 'hollow-tests')).toBe(false);
    });
  });

  describe('rule 4: structural findings are reported, never scored', () => {
    it('is singular for one finding and plural for more', () => {
      const one: FindingsSnapshot = {
        ...emptySnapshot(),
        structure: of({
          findings: [
            {
              kind: 'dominant_cell',
              statement: 'One cell dominates.',
              cells: ['unit:backend'],
              impact: 0.2,
            },
          ],
        }),
      };
      const two: FindingsSnapshot = {
        ...emptySnapshot(),
        structure: of({
          findings: [
            {
              kind: 'dominant_cell',
              statement: 'One cell dominates.',
              cells: ['unit:backend'],
              impact: 0.2,
            },
            {
              kind: 'green_but_empty',
              statement: 'Green with nothing.',
              cells: ['e2e:frontend'],
              impact: 0.1,
            },
          ],
        }),
      };
      expect(deriveFindings(one).find((entry) => entry.id === 'structural-findings')?.title).toBe(
        '1 structural finding',
      );
      expect(deriveFindings(two).find((entry) => entry.id === 'structural-findings')?.title).toBe(
        '2 structural findings',
      );
    });
  });

  describe('rule 5: a gap without a closure is not a task', () => {
    it('ranks closable gaps by potential', () => {
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        gaps: of({
          cappedBy: 'e2e',
          gaps: [
            {
              cell: 'unit:backend',
              category: 'unit',
              surface: 'backend',
              current: 0.2,
              potential: 0.3,
              cheapestClosure: 'add unit tests',
            },
            {
              cell: 'e2e:frontend',
              category: 'e2e',
              surface: 'frontend',
              current: 0.1,
              potential: 0.9,
              cheapestClosure: 'write one e2e test',
            },
          ],
        }),
      };
      const insight = deriveFindings(snapshot).find((entry) => entry.id === 'gap-queue');
      expect(insight?.severity).toBe('info');
      expect(insight?.statement).toContain('e2e:frontend');
      expect(insight?.statement).toContain('+90 points');
      expect(insight?.statement).toContain('write one e2e test');
    });

    it('is not a task when no gap carries a closure', () => {
      // `cheapestClosure` is required by the contract, but a queue entry whose
      // closure is empty is a cell with a low number. The rule counts only
      // rows that name an action, so an empty list must produce no queue.
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        gaps: of({
          cappedBy: 'e2e',
          gaps: [
            {
              cell: 'unit:backend',
              category: 'unit',
              surface: 'backend',
              current: 0.2,
              potential: 0.5,
              cheapestClosure: '',
            },
          ],
        }),
      };
      expect(deriveFindings(snapshot).some((insight) => insight.id === 'gap-queue')).toBe(false);
    });
  });

  describe('rule 6: quarantine entries pending a verdict', () => {
    it('is singular for one pending entry and plural for more', () => {
      const pending = (id: string) => ({
        id,
        testTitle: id,
        testFile: 'a.spec.ts',
        reason: null,
        quarantinedAt: '2026-10-01T00:00:00.000Z',
        status: 'pending' as const,
      });
      const one: FindingsSnapshot = { ...emptySnapshot(), quarantine: of([pending('q1')]) };
      const two: FindingsSnapshot = {
        ...emptySnapshot(),
        quarantine: of([pending('q1'), pending('q2')]),
      };
      expect(deriveFindings(one).find((entry) => entry.id === 'quarantine-pending')?.title).toBe(
        '1 quarantined test awaits a verdict',
      );
      expect(deriveFindings(two).find((entry) => entry.id === 'quarantine-pending')?.title).toBe(
        '2 quarantined tests await a verdict',
      );
    });
    it('counts only pending entries, because an approved one is decided', () => {
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        quarantine: of([
          {
            id: 'q1',
            testTitle: 'flaky login',
            testFile: 'a.spec.ts',
            reason: null,
            quarantinedAt: '2026-10-01T00:00:00.000Z',
            status: 'pending',
          },
          {
            id: 'q2',
            testTitle: 'decided one',
            testFile: 'b.spec.ts',
            reason: null,
            quarantinedAt: '2026-10-01T00:00:00.000Z',
            status: 'approved',
          },
        ]),
      };
      const insight = deriveFindings(snapshot).find((entry) => entry.id === 'quarantine-pending');
      expect(insight?.severity).toBe('warning');
      expect(insight?.title).toBe('1 quarantined test awaits a verdict');
      expect(insight?.citation).toContain('flaky login');
      expect(insight?.citation).not.toContain('decided one');
    });
  });

  describe('rule 7: the pass rate beside its own evidence', () => {
    it('states the average when it was measured', () => {
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        analytics: of({ totalRuns: 12, passRate: 91.5, avgDurationMs: 4200 }),
      };
      const insight = deriveFindings(snapshot).find((entry) => entry.id === 'pass-rate');
      expect(insight?.severity).toBe('info');
      expect(insight?.statement).toContain('91.5%');
      expect(insight?.statement).toContain('4200ms');
      expect(insight?.citation).toContain('passRate=91.5');
    });

    it('says "not measured" rather than printing null', () => {
      // `avgDurationMs` is nullable, and a template that prints it raw renders
      // the word "null" into a sentence. The sentence has to say the
      // measurement is absent.
      const snapshot: FindingsSnapshot = {
        ...emptySnapshot(),
        analytics: of({ totalRuns: 2, passRate: 50, avgDurationMs: null }),
      };
      const insight = deriveFindings(snapshot).find((entry) => entry.id === 'pass-rate');
      expect(insight?.statement).toContain('not measured');
      expect(insight?.statement).not.toContain('null');
    });
  });

  it('returns every rule at once when every read is full', () => {
    // The verdict card renders these in order; the engine must not stop at the
    // first match, or a suite with all seven problems shows one headline.
    const snapshot: FindingsSnapshot = {
      analytics: of({ totalRuns: 5, passRate: 80, avgDurationMs: 100 }),
      score: of(score({ cappingValue: 0 })),
      flaky: of({
        cells: [{ cell: 'unit:backend', flakyFingerprints: ['a'], flakeRate: 0.5, stability: 0.5 }],
      }),
      gaps: of({
        cappedBy: 'e2e',
        gaps: [
          {
            cell: 'e2e:frontend',
            category: 'e2e',
            surface: 'frontend',
            current: 0,
            potential: 0.5,
            cheapestClosure: 'x',
          },
        ],
      }),
      quarantine: of([
        {
          id: 'q1',
          testTitle: 't',
          testFile: 'f',
          reason: null,
          quarantinedAt: '2026-10-01T00:00:00.000Z',
          status: 'pending',
        },
      ]),
      hollow: of({ cells: [{ cell: 'unit:backend', hollowFingerprints: ['h'], signal: 0.1 }] }),
      structure: of({
        findings: [
          {
            kind: 'dominant_cell',
            statement: 'One cell dominates.',
            cells: ['unit:backend'],
            impact: 0.2,
          },
        ],
      }),
    };
    const ids = deriveFindings(snapshot).map((insight) => insight.id);
    expect(ids).toEqual([
      'zero-caps-mean',
      'flaky-decision',
      'hollow-tests',
      'structural-findings',
      'gap-queue',
      'quarantine-pending',
      'pass-rate',
    ]);
    for (const insight of deriveFindings(snapshot)) {
      // Every finding names the endpoint it read and the values that decided
      // it. A finding with a citation but no source is a claim the reader has
      // to trust, which is the opposite of what this product is — and a
      // citation that says nothing ("1 cells") is the same failure in prose.
      expect(insight.source, `${insight.id} has no source`).toMatch(/^[a-z/]+$/u);
      expect(insight.citation.length, `${insight.id} has no citation`).toBeGreaterThan(5);
    }
  });
});
