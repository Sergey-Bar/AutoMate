import { describe, expect, it } from 'vitest';
import { AGENT_SIGNATURES } from '@automate/reporting';
import {
  attributionVersionOf,
  classifyPullRequest,
  type CommitSubject,
  type PullRequestSubject,
} from './ai-code-attribution.js';

const pr = (extra: Partial<PullRequestSubject> = {}): PullRequestSubject => ({
  authorLogin: 'alice',
  headBranch: 'feature/login',
  labels: [],
  body: null,
  ...extra,
});

const commit = (extra: Partial<CommitSubject> = {}): CommitSubject => ({
  sha: 'a'.repeat(40),
  authorLogin: 'alice',
  authorEmail: 'alice@example.com',
  authorName: 'Alice',
  committerLogin: 'alice',
  message: 'Add login',
  ...extra,
});

const CLAUDE_TRAILER = 'Add login\n\nCo-authored-by: Claude <noreply@anthropic.com>';

describe('classifyPullRequest: how commit signals roll up to the pull request', () => {
  it('reads a human pull request with human commits as human, at the modest floor', () => {
    const result = classifyPullRequest(pr(), [commit()], {});
    expect(result).toMatchObject({ attribution: 'human', agent: null, confidence: 0.5 });
    expect(result.signals).toEqual([]);
  });

  it('makes a pull request whose commit carries an agent co-author trailer at least ai-assisted', () => {
    const result = classifyPullRequest(
      pr(),
      [commit(), commit({ sha: 'b'.repeat(40), message: CLAUDE_TRAILER })],
      {},
    );
    expect(result.attribution).toBe('ai-assisted');
    expect(result.agent).toBe('claude-code');
    expect(result.signals[0]?.detail).toMatch(/^commit bbbbbbb: co-authored-by trailer/u);
  });

  it('lets agent-authored win, from whichever level it came', () => {
    // The pull request reads as assisted (an IDE footer); one commit was pushed by an agent bot.
    const result = classifyPullRequest(
      pr({ body: 'Generated with Claude Code' }),
      [
        commit({
          sha: 'c'.repeat(40),
          authorLogin: 'copilot-swe-agent[bot]',
          authorEmail: null,
          authorName: null,
        }),
      ],
      {},
    );
    expect(result.attribution).toBe('agent-authored');
    expect(result.agent).toBe('github-copilot');
    // And the pull request's own agent is named when it already carries the winning mode.
    const own = classifyPullRequest(
      pr({ authorLogin: 'claude[bot]' }),
      [commit({ message: CLAUDE_TRAILER })],
      {},
    );
    expect(own).toMatchObject({ attribution: 'agent-authored', agent: 'claude-code' });
  });

  it('counts one kind of evidence once, however many commits repeat it, and grows with a new kind', () => {
    const one = classifyPullRequest(pr(), [commit({ message: CLAUDE_TRAILER })], {});
    const many = classifyPullRequest(
      pr(),
      ['1', '2', '3'].map((digit) => commit({ sha: digit.repeat(40), message: CLAUDE_TRAILER })),
      {},
    );
    expect(many.confidence).toBeCloseTo(one.confidence, 10);
    expect(many.signals).toHaveLength(1);
    const more = classifyPullRequest(
      pr({ body: 'Generated with Claude Code' }),
      [commit({ message: CLAUDE_TRAILER })],
      {},
    );
    expect(more.confidence).toBeGreaterThan(one.confidence);
  });

  it('applies the policy labels to the pull request only', () => {
    const result = classifyPullRequest(pr({ labels: ['Agent'] }), [commit()], {
      agentLabels: ['agent'],
    });
    expect(result).toMatchObject({ attribution: 'agent-authored', agent: null, confidence: 0.5 });
  });

  it('is unknown, never human, with no identity anywhere', () => {
    const result = classifyPullRequest(
      pr({ authorLogin: null }),
      [commit({ authorLogin: null, authorEmail: null, authorName: null, committerLogin: null })],
      {},
    );
    expect(result).toMatchObject({ attribution: 'unknown', confidence: 0 });
    // A non-AI bot is reported, but is neither an AI signal nor a human author.
    const bot = classifyPullRequest(pr({ authorLogin: 'dependabot[bot]' }), [], {});
    expect(bot.attribution).toBe('unknown');
    expect(bot.signals.map((signal) => signal.detail)).toEqual([
      'author dependabot[bot] is a bot that is not an AI agent',
    ]);
  });

  it('reads a pull request with no author but a human commit as human', () => {
    expect(classifyPullRequest(pr({ authorLogin: null }), [commit()], {}).attribution).toBe(
      'human',
    );
  });

  it('does not let a non-AI bot signal raise the confidence of an AI reading', () => {
    const plain = classifyPullRequest(pr(), [commit({ message: CLAUDE_TRAILER })], {});
    const withBot = classifyPullRequest(
      pr(),
      [
        commit({ message: CLAUDE_TRAILER }),
        commit({ sha: 'd'.repeat(40), authorLogin: 'renovate[bot]', message: CLAUDE_TRAILER }),
      ],
      {},
    );
    expect(withBot.confidence).toBeCloseTo(plain.confidence, 10);
  });

  it('keeps at most 20 signals', () => {
    const commits = Array.from({ length: 30 }, (_, index) =>
      commit({
        sha: index.toString(16).padStart(40, '0'),
        message: `Change ${String(index)}\n\nCo-authored-by: x <noreply@anthropic.com>\nMade-with: Cursor`,
        authorName: `Person ${String(index)} (aider)`,
      }),
    );
    expect(classifyPullRequest(pr(), commits, {}).signals.length).toBeLessThanOrEqual(20);
  });
});

describe('attributionVersionOf', () => {
  it('is the signature table version without labels, and changes when the labels do', () => {
    expect(attributionVersionOf({})).toBe(AGENT_SIGNATURES.version);
    expect(attributionVersionOf({ agentLabels: [] })).toBe(AGENT_SIGNATURES.version);
    const labelled = attributionVersionOf({ agentLabels: ['agent'] });
    expect(labelled.startsWith(`${AGENT_SIGNATURES.version}+labels:`)).toBe(true);
    expect(attributionVersionOf({ agentLabels: [' Agent '] })).toBe(labelled);
    expect(attributionVersionOf({ assistedLabels: ['agent'] })).not.toBe(labelled);
  });
});
