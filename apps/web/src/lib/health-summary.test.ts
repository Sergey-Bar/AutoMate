import { describe, expect, it } from 'vitest';
import { hrefOf, summarizeHealth, WRONG_SHOWN } from './health-summary.js';
import type { DigestItem, ReleaseReadinessCard } from './qa.js';
import type { QaGapsResponse } from './qa.js';

const PROJECT = 'project-1';

function card(
  verdict: ReleaseReadinessCard['verdict'],
  reasons: ReleaseReadinessCard['reasons'],
): ReleaseReadinessCard {
  return { projectId: PROJECT, verdict, reasons, evaluatedAt: '2026-10-21T00:00:00.000Z' };
}

const GAPS: QaGapsResponse = {
  cappedBy: 'security',
  gaps: [
    {
      cell: 'unit:frontend',
      category: 'unit',
      surface: 'frontend',
      current: 0.2,
      potential: 0.1,
      cheapestClosure: 'Add component tests',
    },
    {
      cell: 'security:backend',
      category: 'security',
      surface: 'backend',
      current: 0,
      potential: 0.4,
      cheapestClosure: 'Add a secret scanner',
    },
  ],
};

describe('summarizeHealth', () => {
  it('ranks what is wrong: no-go, caution, unknown, then bad news, then gaps by worth', () => {
    const summary = summarizeHealth({
      projectId: PROJECT,
      readiness: card('no-go', [
        { code: 'flaky', level: 'caution', message: 'Flaky at 2%', evidence: 'flaky results' },
        { code: 'gate', level: 'no-go', message: 'The gate failed', evidence: 'run run-9' },
        { code: 'coverage', level: 'unknown', message: 'No coverage report', evidence: 'none' },
        { code: 'activity', level: 'go', message: 'Ran today', evidence: '12 runs' },
      ]),
      digest: [
        { kind: 'new-failure', tone: 'bad', text: '3 new failures' },
        { kind: 'pass-rate', tone: 'good', text: 'Pass rate +4 pts' },
        { kind: 'runs', tone: 'neutral', text: '12 runs' },
      ],
      gaps: GAPS,
    });
    expect(summary.wrong.map((item) => item.title)).toEqual([
      'The gate failed',
      'Flaky at 2%',
      'No coverage report',
      '3 new failures',
      'Add a secret scanner',
      'Add component tests',
    ]);
    expect(summary.wrong.map((item) => item.tone)).toEqual([
      'bad',
      'warn',
      'unknown',
      'bad',
      'warn',
      'warn',
    ]);
  });

  it('lists what is good: passing checks, then good news; neutral news is neither', () => {
    const summary = summarizeHealth({
      projectId: PROJECT,
      readiness: card('caution', [
        { code: 'flaky', level: 'caution', message: 'Flaky at 2%', evidence: 'flaky' },
        { code: 'gate', level: 'go', message: 'The gate passed', evidence: 'run run-1' },
      ]),
      digest: [
        { kind: 'pass-rate', tone: 'good', text: 'Pass rate +4 pts' },
        { kind: 'runs', tone: 'neutral', text: '12 runs' },
      ],
      gaps: null,
    });
    expect(summary.good.map((item) => item.title)).toEqual(['The gate passed', 'Pass rate +4 pts']);
    expect(summary.good.every((item) => item.tone === 'good')).toBe(true);
    expect([...summary.wrong, ...summary.good].some((item) => item.title === '12 runs')).toBe(
      false,
    );
  });

  it('never counts an unknown input as good', () => {
    const summary = summarizeHealth({
      projectId: PROJECT,
      readiness: card('go', [
        { code: 'coverage', level: 'unknown', message: 'No coverage report', evidence: 'none' },
      ]),
      digest: [],
      gaps: null,
    });
    expect(summary.good).toEqual([]);
    expect(summary.wrong.map((item) => item.tone)).toEqual(['unknown']);
  });

  it('gives every finding its evidence and a next action that opens a real page', () => {
    const summary = summarizeHealth({
      projectId: PROJECT,
      readiness: card('no-go', [
        { code: 'gate', level: 'no-go', message: 'The gate failed', evidence: 'run run-9' },
        { code: 'pass-rate', level: 'caution', message: 'Pass rate 80%', evidence: '20 runs' },
        { code: 'flaky', level: 'caution', message: 'Flaky', evidence: 'flaky' },
        { code: 'coverage', level: 'caution', message: 'Coverage 40%', evidence: 'lcov' },
        { code: 'quarantine', level: 'caution', message: '4 quarantined', evidence: 'list' },
        { code: 'activity', level: 'unknown', message: 'No runs', evidence: 'none' },
      ]),
      digest: [{ kind: 'newly-slow', tone: 'bad', text: 'login is slower' }],
      gaps: GAPS,
    });
    const actions = Object.fromEntries(
      summary.wrong.map((item) => [item.title, hrefOf(item.action)]),
    );
    expect(actions).toEqual({
      'The gate failed': '/dashboard/runs',
      'Pass rate 80%': '/dashboard/analytics',
      Flaky: '/dashboard/insights',
      'Coverage 40%': '/dashboard/map',
      '4 quarantined': '/dashboard/quarantine',
      'No runs': '/dashboard/runner',
      'login is slower': '/dashboard/insights',
      'Add a secret scanner': `/dashboard/gaps/${PROJECT}`,
      'Add component tests': `/dashboard/gaps/${PROJECT}`,
    });
    for (const item of summary.wrong) {
      expect(item.evidence.length, `${item.title} has no evidence`).toBeGreaterThan(0);
      expect(item.action.label.length).toBeGreaterThan(0);
    }
    const gap = summary.wrong.find((item) => item.title === 'Add a secret scanner');
    expect(gap?.evidence).toBe('security:backend · +40 pts');
  });

  it('gives every item a unique key, so a list can render it', () => {
    const summary = summarizeHealth({
      projectId: PROJECT,
      readiness: card('caution', [
        { code: 'flaky', level: 'caution', message: 'Flaky', evidence: 'flaky' },
      ]),
      digest: [
        { kind: 'new-flaky', tone: 'bad', text: 'a' },
        { kind: 'new-flaky', tone: 'bad', text: 'b' },
      ],
      gaps: GAPS,
    });
    const ids = [...summary.wrong, ...summary.good].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('heads with the verdict and the reason that set it', () => {
    expect(
      summarizeHealth({
        projectId: PROJECT,
        readiness: card('no-go', [
          { code: 'gate', level: 'no-go', message: 'The gate failed', evidence: 'run run-9' },
        ]),
        digest: [],
        gaps: null,
      }),
    ).toMatchObject({ verdict: 'no-go', headline: 'The gate failed' });
    expect(
      summarizeHealth({
        projectId: PROJECT,
        readiness: card('go', [
          { code: 'gate', level: 'go', message: 'The gate passed', evidence: 'run run-1' },
        ]),
        digest: [],
        gaps: null,
      }),
    ).toMatchObject({ verdict: 'go', headline: 'Every readiness check passes' });
  });

  it('says it does not know when there is no readiness, and still ranks the rest', () => {
    const digest: DigestItem[] = [{ kind: 'new-failure', tone: 'bad', text: '1 new failure' }];
    const summary = summarizeHealth({ projectId: PROJECT, readiness: null, digest, gaps: GAPS });
    expect(summary.verdict).toBeNull();
    expect(summary.headline).toBe('Release readiness has not been read');
    expect(summary.wrong[0]?.title).toBe('1 new failure');
  });

  it('is empty, not invented, when there is nothing to say', () => {
    const summary = summarizeHealth({
      projectId: PROJECT,
      readiness: null,
      digest: [],
      gaps: null,
    });
    expect(summary.wrong).toEqual([]);
    expect(summary.good).toEqual([]);
  });

  it('shows five at first, which is the most a glance takes in', () => {
    expect(WRONG_SHOWN).toBe(5);
  });
});
