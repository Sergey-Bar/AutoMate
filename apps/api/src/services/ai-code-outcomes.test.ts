import { describe, expect, it } from 'vitest';
import {
  deriveOutcomes,
  isFixPullRequest,
  isRevertOf,
  revertedShas,
  weeklyShare,
  type OutcomeInputs,
  type OutcomePullRequest,
} from './ai-code-outcomes.js';

const DAY = 86_400_000;
const NOW = new Date('2026-10-26T00:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY);

let next = 1;
const pr = (extra: Partial<OutcomePullRequest> = {}): OutcomePullRequest => {
  const number = extra.number ?? next++;
  return {
    id: `pr-${String(number)}`,
    number,
    title: `Change ${String(number)}`,
    labels: [],
    headBranch: `feature/${String(number)}`,
    baseBranch: 'main',
    mergedAt: daysAgo(40),
    mergeCommitSha: number.toString(16).padEnd(40, 'a'),
    headSha: number.toString(16).padEnd(40, 'b'),
    changedPaths: ['src/a.ts'],
    additions: 10,
    deletions: 0,
    commentCount: 0,
    approvalCount: 1,
    attribution: 'human',
    aiAgent: null,
    ...extra,
  };
};

const inputs = (
  pullRequests: OutcomePullRequest[],
  extra: Partial<OutcomeInputs> = {},
): OutcomeInputs => ({
  pullRequests,
  landedCommits: [],
  carriers: new Map(),
  diffCoverage: new Map(),
  gateFindings: new Map(),
  defaultBranch: 'main',
  ...extra,
});

describe('reverted', () => {
  it('is a later merged GitHub revert pull request, by branch or by title', () => {
    const original = pr({ number: 10, title: 'Add search' });
    expect(
      isRevertOf(pr({ headBranch: 'revert-10-feature/search', mergedAt: daysAgo(30) }), original),
    ).toBe(true);
    expect(isRevertOf(pr({ title: 'Revert "Add search"', mergedAt: daysAgo(30) }), original)).toBe(
      true,
    );
    // Not later, not merged, another number, or merely mentioning the word.
    expect(isRevertOf(pr({ headBranch: 'revert-10-x', mergedAt: daysAgo(50) }), original)).toBe(
      false,
    );
    expect(isRevertOf(pr({ headBranch: 'revert-10-x', mergedAt: null }), original)).toBe(false);
    expect(isRevertOf(pr({ headBranch: 'revert-100-x', mergedAt: daysAgo(30) }), original)).toBe(
      false,
    );
    expect(
      isRevertOf(pr({ title: 'Revert the search change', mergedAt: daysAgo(30) }), original),
    ).toBe(false);
    expect(isRevertOf(original, original)).toBe(false);
  });

  it('is a landed commit that says "This reverts commit <merge sha>"', () => {
    const original = pr({ number: 20 });
    const shas = revertedShas([
      {
        message: `Revert "x"\n\nThis reverts commit ${original.mergeCommitSha as string}.`,
      },
      { message: 'This reverts commit ABCDEF1.' },
    ]);
    expect(shas.has(original.mergeCommitSha as string)).toBe(true);
    const [outcome] = deriveOutcomes(
      inputs([original], {
        landedCommits: [{ message: `This reverts commit ${original.mergeCommitSha as string}.` }],
      }),
    );
    expect(outcome?.reverted).toBe(true);
    // An abbreviated sha in the message reverts the commit it is a prefix of.
    expect(
      deriveOutcomes(
        inputs([original], {
          landedCommits: [
            { message: `This reverts commit ${(original.mergeCommitSha as string).slice(0, 9)}.` },
          ],
        }),
      )[0]?.reverted,
    ).toBe(true);
  });
});

describe('causedFailure', () => {
  it('is DORA’s verdict on the first production deployment carrying the merge commit, null when none did', () => {
    const shipped = pr({ number: 30 });
    const failed = pr({ number: 31 });
    const never = pr({ number: 32 });
    const outcomes = deriveOutcomes(
      inputs([shipped, failed, never], {
        carriers: new Map([
          [shipped.mergeCommitSha as string, { failed: false }],
          [failed.mergeCommitSha as string, { failed: true }],
        ]),
      }),
    );
    expect(outcomes.map((outcome) => outcome.causedFailure)).toEqual([false, true, null]);
  });
});

describe('followUpFixDays', () => {
  it('is the days until the first later merged fix that touched one of the same files', () => {
    const original = pr({
      number: 40,
      changedPaths: ['src/a.ts', 'src/b.ts'],
      mergedAt: daysAgo(40),
    });
    const unrelated = pr({
      number: 41,
      title: 'fix: c',
      changedPaths: ['src/c.ts'],
      mergedAt: daysAgo(39),
    });
    const notFix = pr({
      number: 42,
      title: 'Refactor b',
      changedPaths: ['src/b.ts'],
      mergedAt: daysAgo(38),
    });
    const fix = pr({
      number: 43,
      title: 'fix(b): null check',
      changedPaths: ['src/b.ts'],
      mergedAt: daysAgo(35),
    });
    const later = pr({
      number: 44,
      labels: ['bug'],
      changedPaths: ['src/a.ts'],
      mergedAt: daysAgo(30),
    });
    const [outcome] = deriveOutcomes(inputs([original, unrelated, notFix, fix, later]));
    expect(outcome?.followUpFixDays).toBeCloseTo(5, 6);
  });

  it('is null with no later fix, and with no recorded paths', () => {
    expect(deriveOutcomes(inputs([pr({ number: 50 })]))[0]?.followUpFixDays).toBeNull();
    const pathless = pr({ number: 51, changedPaths: [] });
    const fix = pr({ number: 52, title: 'hotfix', changedPaths: [], mergedAt: daysAgo(30) });
    expect(deriveOutcomes(inputs([pathless, fix]))[0]?.followUpFixDays).toBeNull();
  });

  it('does not count a revert of the change as its fix', () => {
    const original = pr({ number: 60, title: 'Add x' });
    const revert = pr({
      number: 61,
      title: 'Revert "Add x"',
      labels: ['hotfix'],
      mergedAt: daysAgo(30),
    });
    const [outcome] = deriveOutcomes(inputs([original, revert]));
    expect(outcome).toMatchObject({ reverted: true, followUpFixDays: null });
  });

  it('recognises a fix by title, label or branch', () => {
    for (const fix of [
      { title: 'Fix login' },
      { title: 'fix: login' },
      { title: 'Fixes #12' },
      { title: 'Bugfix for login' },
      { title: '[hotfix] login' },
      { labels: ['Hotfix'] },
      { labels: ['type: bug'] },
      { headBranch: 'fix/login' },
      { headBranch: 'bugfix-login' },
      { headBranch: 'hotfix/login' },
    ]) {
      expect(
        isFixPullRequest({ title: 'Change', labels: [], headBranch: 'feature/x', ...fix }),
        JSON.stringify(fix),
      ).toBe(true);
    }
    for (const notFix of [
      { title: 'Prefix the cache keys' },
      { title: 'Add a fixture' },
      { labels: ['enhancement'] },
      { headBranch: 'feature/fixtures' },
    ]) {
      expect(
        isFixPullRequest({ title: 'Change', labels: [], headBranch: 'feature/x', ...notFix }),
        JSON.stringify(notFix),
      ).toBe(false);
    }
  });
});

describe('the review and gate inputs', () => {
  it('reads lines changed, review comments, rubber stamps, diff coverage in percent, and the gate’s findings', () => {
    const reviewed = pr({
      number: 70,
      additions: 30,
      deletions: 10,
      commentCount: 2,
      approvalCount: 1,
    });
    const stamped = pr({ number: 71, commentCount: 0, approvalCount: 1 });
    const unapproved = pr({ number: 72, commentCount: 0, approvalCount: 0, headSha: null });
    const outcomes = deriveOutcomes(
      inputs([reviewed, stamped, unapproved], {
        diffCoverage: new Map([[reviewed.headSha as string, 87.5]]),
        gateFindings: new Map([[70, { high: 2, critical: 1 }]]),
      }),
    );
    expect(outcomes[0]).toMatchObject({
      linesChanged: 40,
      reviewComments: 2,
      approvedWithoutComments: false,
      diffCoverage: 87.5,
      newHighFindings: 3,
    });
    expect(outcomes[1]).toMatchObject({
      approvedWithoutComments: true,
      diffCoverage: null,
      newHighFindings: null,
    });
    expect(outcomes[2]).toMatchObject({ approvedWithoutComments: false, diffCoverage: null });
  });

  it('keeps only changes merged into the default branch, and carries no person', () => {
    const outcomes = deriveOutcomes(
      inputs([
        pr({ number: 80 }),
        pr({ number: 81, baseBranch: 'release' }),
        pr({ number: 82, mergedAt: null }),
      ]),
    );
    expect(outcomes.map((outcome) => outcome.id)).toEqual(['pr-80']);
    expect(Object.keys(outcomes[0] ?? {}).sort()).toEqual(
      [
        'agent',
        'approvedWithoutComments',
        'attribution',
        'causedFailure',
        'diffCoverage',
        'followUpFixDays',
        'id',
        'linesChanged',
        'mergedAt',
        'newHighFindings',
        'reverted',
        'reviewComments',
      ].sort(),
    );
  });
});

describe('weeklyShare', () => {
  it('buckets merged changes by attribution into zero-filled Monday weeks across the window', () => {
    const share = weeklyShare(
      [
        { attribution: 'agent-authored', mergedAt: '2026-10-20T10:00:00Z' },
        { attribution: 'human', mergedAt: '2026-10-25T23:00:00Z' },
        { attribution: 'ai-assisted', mergedAt: '2026-10-12T00:00:00Z' },
        { attribution: 'unknown', mergedAt: '2026-10-13T00:00:00Z' },
        // Outside the window, and unreadable: neither counts.
        { attribution: 'human', mergedAt: '2026-01-01T00:00:00Z' },
        { attribution: 'human', mergedAt: 'not a time' },
      ],
      NOW,
      14,
    );
    expect(share).toEqual([
      { weekStart: '2026-10-12', agentAuthored: 0, aiAssisted: 1, human: 0, unknown: 1, total: 2 },
      { weekStart: '2026-10-19', agentAuthored: 1, aiAssisted: 0, human: 1, unknown: 0, total: 2 },
      { weekStart: '2026-10-26', agentAuthored: 0, aiAssisted: 0, human: 0, unknown: 0, total: 0 },
    ]);
  });
});
