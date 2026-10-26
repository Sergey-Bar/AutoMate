import { describe, expect, it } from 'vitest';
import {
  CHANGED_PATHS_LIMIT,
  COMMIT_MESSAGE_LIMIT,
  GitHubDeploymentSchema,
  GitHubFileSchema,
  GitHubPullSchema,
  changeFacts,
  commitValues,
  deploymentOutcome,
  isHumanReviewer,
  isTestPath,
  parseItems,
  reviewFacts,
  stateOf,
  workflowRunDeployment,
  type GitHubCommit,
  type GitHubReview,
  type GitHubWorkflowRun,
} from './delivery-github.js';

const review = (
  login: string | null,
  state: string,
  at = '2026-10-01T00:00:00Z',
): GitHubReview => ({
  user: login === null ? null : { login },
  state,
  submitted_at: at,
});

describe('reviewFacts: human approvals', () => {
  it('counts distinct approvers who are neither the author nor a bot nor an agent', () => {
    const facts = reviewFacts(
      [
        review('alice', 'APPROVED'),
        review('Bob', 'APPROVED'),
        review('bob', 'APPROVED', '2026-10-02T00:00:00Z'),
        review('carol', 'COMMENTED'),
        review('github-actions[bot]', 'APPROVED'),
        // An agent that approves without the `[bot]` suffix is still not a human.
        review('Copilot', 'APPROVED'),
        review(null, 'APPROVED'),
        review('dave', 'PENDING'),
      ],
      'Alice',
    );
    expect(facts.humanApprovalCount).toBe(1);
    // The Wave-3 count is unchanged: it counts every approver but the author.
    expect(facts.approvalCount).toBe(6);
  });

  it('counts no human approval on a pull request only bots approved', () => {
    expect(reviewFacts([review('claude[bot]', 'APPROVED')], 'alice').humanApprovalCount).toBe(0);
  });

  it('isHumanReviewer refuses a missing login, the author in any case, and bots', () => {
    expect(isHumanReviewer('bob', 'alice')).toBe(true);
    expect(isHumanReviewer('bob', null)).toBe(true);
    expect(isHumanReviewer(undefined, 'alice')).toBe(false);
    expect(isHumanReviewer('ALICE', 'alice')).toBe(false);
    expect(isHumanReviewer('renovate[bot]', 'alice')).toBe(false);
    expect(isHumanReviewer('openhands-agent', 'alice')).toBe(false);
  });
});

describe('changeFacts: changed paths', () => {
  it('keeps the first 300 paths, each bounded', () => {
    const files = Array.from({ length: 320 }, (_, index) => ({
      filename: `src/f${String(index)}.ts`,
    }));
    files[0] = { filename: `${'x'.repeat(600)}.ts` };
    const facts = changeFacts([], files);
    expect(facts.changedPaths).toHaveLength(CHANGED_PATHS_LIMIT);
    expect(facts.changedPaths[0]).toHaveLength(500);
    expect(facts.changedPaths[1]).toBe('src/f1.ts');
  });
});

describe('GitHubPullSchema', () => {
  it('reads the head sha when GitHub sends it, and does without it', () => {
    const base = {
      id: 1,
      number: 1,
      state: 'open',
      title: 't',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    };
    expect(GitHubPullSchema.parse({ ...base, head: { ref: 'x', sha: 'ABC' } }).head?.sha).toBe(
      'ABC',
    );
    expect(GitHubPullSchema.parse({ ...base, head: { ref: 'x' } }).head?.sha).toBeUndefined();
  });
});

describe('isTestPath: what counts as touching tests', () => {
  it.each([
    ['src/__tests__/a.ts', true],
    ['test/a.js', true],
    ['packages/x/tests/a.py', true],
    ['spec/models/user_spec.rb', true],
    ['e2e/login.ts', true],
    ['src/a.test.ts', true],
    ['src/a.spec.tsx', true],
    ['pkg/server_test.go', true],
    ['app/test_views.py', true],
    ['app/views_test.py', true],
    ['SRC\\Widget.Test.TS', true],
    ['src/a.ts', false],
    ['src/testing.ts', false],
    ['src/contest/a.ts', false],
    ['docs/test.md', false],
    ['latest_results.py', false],
  ])('%s → %s', (path, expected) => {
    expect(isTestPath(path)).toBe(expected);
  });
});

describe('deploymentOutcome', () => {
  it.each([
    ['success', 'success'],
    ['INACTIVE', 'success'],
    ['failure', 'failure'],
    ['error', 'failure'],
    ['queued', null],
    ['in_progress', null],
    [undefined, null],
  ] as const)('%s → %s', (state, expected) => {
    expect(deploymentOutcome(state)).toBe(expected);
  });
});

describe('workflowRunDeployment', () => {
  const run = (extra: Partial<GitHubWorkflowRun> = {}): GitHubWorkflowRun => ({
    id: 7,
    name: 'Deploy',
    path: '.github/workflows/deploy.yml',
    head_sha: 'ABC1234',
    head_branch: 'main',
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:10:00Z',
    html_url: 'https://github.com/o/r/actions/runs/7',
    ...extra,
  });

  it('turns a finished run of a deploy workflow into a deployment at its finish time', () => {
    expect(workflowRunDeployment(run(), ['deploy'], 'production')).toEqual({
      externalId: 'run:7',
      environment: 'production',
      status: 'success',
      createdAt: new Date('2026-10-01T00:10:00Z'),
      sha: 'abc1234',
      url: 'https://github.com/o/r/actions/runs/7',
    });
  });

  it('matches the workflow by name or by file, case-insensitively, and nothing else', () => {
    expect(workflowRunDeployment(run({ name: 'Other' }), ['deploy.yml'], 'p')).not.toBeNull();
    expect(workflowRunDeployment(run({ name: null }), ['DEPLOY'], 'p')).toBeNull();
    expect(
      workflowRunDeployment(run({ name: undefined, path: undefined }), ['deploy'], 'p'),
    ).toBeNull();
    expect(workflowRunDeployment(run({ name: 'CI', path: 'ci.yml' }), ['deploy'], 'p')).toBeNull();
    expect(workflowRunDeployment(run(), [], 'p')).toBeNull();
  });

  it.each([
    ['failure', 'failure'],
    ['timed_out', 'failure'],
    ['SUCCESS', 'success'],
    ['cancelled', null],
    ['skipped', null],
    [null, null],
  ])('reads conclusion %s as %s', (conclusion, expected) => {
    expect(workflowRunDeployment(run({ conclusion }), ['deploy'], 'p')?.status ?? null).toBe(
      expected,
    );
  });

  it('has no url when GitHub sent none', () => {
    expect(workflowRunDeployment(run({ html_url: undefined }), ['deploy'], 'p')?.url).toBeNull();
  });
});

describe('commits and pull requests as the sync stores them', () => {
  const commit = (extra: Partial<GitHubCommit['commit']> = {}): GitHubCommit => ({
    sha: 'ABCDEF0',
    commit: { author: null, committer: null, message: 'm', ...extra },
    author: null,
    committer: null,
  });

  it('dates a commit by its author, then its committer, and leaves it undated with neither', () => {
    expect(
      commitValues(commit({ author: { date: '2026-10-01T00:00:00Z' } }), 3).committedAt,
    ).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(
      commitValues(commit({ committer: { date: '2026-10-02T00:00:00Z' } }), null).committedAt,
    ).toEqual(new Date('2026-10-02T00:00:00Z'));
    expect(commitValues(commit(), null)).toMatchObject({
      sha: 'abcdef0',
      prNumber: null,
      authorLogin: null,
      authorEmail: null,
      authorName: null,
      committerLogin: null,
      committedAt: null,
    });
  });

  it('bounds a commit message', () => {
    const long = commitValues(commit({ message: 'x'.repeat(COMMIT_MESSAGE_LIMIT + 50) }), 1);
    expect(long.message).toHaveLength(COMMIT_MESSAGE_LIMIT);
  });

  it('sums the size, counting a file with no line counts as zero, and dates the first commit', () => {
    const facts = changeFacts(
      [
        commit({ committer: { date: '2026-10-03T00:00:00Z' } }),
        commit({ author: { date: '2026-10-02T00:00:00Z' } }),
        commit(),
      ],
      [{ filename: 'src/a.ts', additions: 3, deletions: 1 }, { filename: 'README.md' }],
    );
    expect(facts).toMatchObject({
      firstCommitAt: new Date('2026-10-02T00:00:00Z'),
      additions: 3,
      deletions: 1,
      changedFiles: 2,
      testsTouched: false,
    });
    expect(changeFacts([], []).firstCommitAt).toBeNull();
  });

  it('calls a pull request merged only when GitHub says when', () => {
    const pull = GitHubPullSchema.parse({
      id: 1,
      number: 1,
      state: 'closed',
      title: 't',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
    });
    expect(stateOf(pull)).toBe('closed');
    expect(stateOf({ ...pull, merged_at: null })).toBe('closed');
    expect(stateOf({ ...pull, merged_at: '2026-10-01T00:00:00Z' })).toBe('merged');
  });

  it('skips and counts an item that lacks a field, rather than guessing it', () => {
    expect(parseItems(GitHubFileSchema, [{ filename: 'a' }, { additions: 1 }, null, 'b'])).toEqual({
      parsed: [{ filename: 'a' }],
      skipped: 3,
    });
    // A timestamp that is not one is a malformed item, not a date of NaN.
    expect(
      GitHubDeploymentSchema.safeParse({ id: 1, environment: 'p', created_at: 'yesterday' })
        .success,
    ).toBe(false);
  });

  it('reads no review by the author, and none still pending, as a review', () => {
    const facts = reviewFacts(
      [
        review('alice', 'COMMENTED', '2026-10-01T00:00:00Z'),
        review('bob', 'pending', '2026-10-01T01:00:00Z'),
        review('carol', 'COMMENTED', '2026-10-03T00:00:00Z'),
        review('dave', 'APPROVED', '2026-10-04T00:00:00Z'),
      ],
      'alice',
    );
    expect(facts).toMatchObject({
      firstReviewAt: new Date('2026-10-03T00:00:00Z'),
      approvedAt: new Date('2026-10-04T00:00:00Z'),
      reviewCount: 2,
      commentCount: 1,
    });
    expect(reviewFacts([], null)).toMatchObject({ firstReviewAt: null, approvedAt: null });
  });
});
