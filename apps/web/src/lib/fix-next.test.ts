import { describe, expect, it } from 'vitest';
import type { FixNext } from '@automate/shared-contracts';
import { makeScorecard } from '../test-utils.js';
import { rankFixNext } from './fix-next.js';

function item(overrides: Partial<FixNext> = {}): FixNext {
  return {
    key: 'rule:security:gitleaks:aws',
    dimension: 'security',
    title: 'Resolve 1 open secret',
    findings: 1,
    gain: 12,
    helpUri: null,
    ...overrides,
  };
}

const failing = (title: string, score: number | null, reasons: string[]) =>
  makeScorecard({
    title,
    status: 'fail',
    score,
    cappedBy: score === null ? null : 'm',
    reasons,
  });

describe('rankFixNext', () => {
  it('keeps the grade’s own order first, then failing scorecards worst first', () => {
    const ranked = rankFixNext(
      {
        fixNext: [
          item({ key: 'gate:open-secret', title: 'Close the open secret', gain: 3 }),
          item({
            key: 'metric:coverage:lines',
            dimension: 'coverage',
            title: 'Raise coverage',
            gain: 9,
            helpUri: 'https://docs',
          }),
        ],
      },
      [
        { scorecard: failing('Flow', 60, ['Review latency is over the limit']), href: '/flow' },
        {
          scorecard: failing('DORA', 20, ['Lead time is too long', 'Too few deploys']),
          href: '/dora',
        },
        { scorecard: failing('Agents', null, ['No baseline yet']), href: '/agents' },
        {
          scorecard: makeScorecard({ title: 'AI', status: 'pass', reasons: ['ignored'] }),
          href: '/ai',
        },
      ],
      { gradeHref: '/grade' },
    );
    expect(ranked.map((entry) => entry.title)).toEqual([
      // The server ranked gate 3 before metric 9 for its own reasons; it is not re-ranked.
      'Close the open secret',
      'Raise coverage',
      'Lead time is too long',
      'Too few deploys',
      'Review latency is over the limit',
      'No baseline yet',
    ]);
    expect(ranked[0]).toMatchObject({ source: 'Grade · Security', gain: 3, href: '/grade' });
    expect(ranked[1]).toMatchObject({ source: 'Grade · Coverage', href: 'https://docs' });
    expect(ranked[2]).toMatchObject({ source: 'DORA', gain: null, href: '/dora' });
  });

  it('lists a sentence once, keeps to the limit, and survives a missing grade', () => {
    const ranked = rankFixNext(
      { fixNext: [item({ title: 'Lead time is too long' })] },
      [{ scorecard: failing('DORA', 10, ['lead time is too long ', 'A', 'B', 'C']), href: '/d' }],
      { gradeHref: '/g', limit: 3 },
    );
    expect(ranked.map((entry) => entry.title)).toEqual(['Lead time is too long', 'A', 'B']);
    expect(rankFixNext(null, [], { gradeHref: '/g' })).toEqual([]);
  });

  it('gives each scorecard reason a stable, distinct key', () => {
    const ranked = rankFixNext(null, [{ scorecard: failing('DORA', 10, ['x', 'y']), href: '/d' }], {
      gradeHref: '/g',
    });
    expect(new Set(ranked.map((entry) => entry.key)).size).toBe(2);
  });
});
