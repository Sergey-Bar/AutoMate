import { describe, expect, it } from 'vitest';
import {
  AGENT_SIGNATURES,
  KIND_WEIGHTS,
  classifyAttribution,
  parseTrailers,
  type AttributionSubject,
} from './ai-attribution.js';

const human: AttributionSubject = {
  authorLogin: 'octo-dev',
  authorEmail: 'dev@example.test',
  authorName: 'Octo Dev',
  message: 'fix: handle empty run list',
  branch: 'fix/empty-runs',
};

describe('the signature table', () => {
  it('is versioned and every entry cites a source', () => {
    expect(AGENT_SIGNATURES.version).toBe('2026-10-26');
    expect(AGENT_SIGNATURES.entries.length).toBeGreaterThan(10);
    for (const entry of AGENT_SIGNATURES.entries) {
      expect(entry.source).toMatch(/^https:\/\//u);
      expect(entry.pattern).toBe(entry.pattern.toLowerCase());
      expect(entry.pattern.trim()).toBe(entry.pattern);
      expect(entry.agent.length).toBeGreaterThan(0);
    }
  });

  it('holds no duplicate signature', () => {
    const keys = AGENT_SIGNATURES.entries.map((entry) => `${entry.kind}:${entry.pattern}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('weights every kind inside (0, 1)', () => {
    for (const weight of Object.values(KIND_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThan(1);
    }
  });
});

describe('parseTrailers', () => {
  it('reads the final paragraph only', () => {
    const message = [
      'feat: add the thing',
      '',
      'Co-authored-by: Not A Trailer <x@example.test> sits in the body',
      'and this line is prose.',
      '',
      'Co-Authored-By: Claude <noreply@anthropic.com>',
      'Signed-off-by: Octo Dev <dev@example.test>',
    ].join('\r\n');
    expect(parseTrailers(message)).toEqual([
      { key: 'co-authored-by', value: 'Claude <noreply@anthropic.com>' },
      { key: 'signed-off-by', value: 'Octo Dev <dev@example.test>' },
    ]);
  });

  it('never reads the subject as a trailer', () => {
    expect(parseTrailers('fix: thing')).toEqual([]);
    expect(parseTrailers('Co-authored-by: Claude <noreply@anthropic.com>')).toEqual([]);
  });

  it('refuses a final paragraph that is not all trailers', () => {
    expect(
      parseTrailers('subject\n\nCo-authored-by: Claude <noreply@anthropic.com>\nprose'),
    ).toEqual([]);
  });

  it('has nothing to read in an absent or blank message', () => {
    expect(parseTrailers(null)).toEqual([]);
    expect(parseTrailers(undefined)).toEqual([]);
    expect(parseTrailers('   \n\n  ')).toEqual([]);
  });

  it('tolerates trailing blank lines', () => {
    expect(parseTrailers('s\n\nAssisted-by: Kiro\n\n\n')).toEqual([
      { key: 'assisted-by', value: 'Kiro' },
    ]);
  });
});

describe('classifyAttribution', () => {
  it('calls a named author with no signal human, at a modest confidence', () => {
    const result = classifyAttribution(human);
    expect(result).toEqual({
      attribution: 'human',
      agent: null,
      confidence: KIND_WEIGHTS.label,
      signals: [],
    });
  });

  it('accepts an author name or email alone as an identity', () => {
    expect(classifyAttribution({ authorName: 'Octo Dev' }).attribution).toBe('human');
    expect(classifyAttribution({ authorEmail: 'dev@example.test' }).attribution).toBe('human');
  });

  it('never calls a subject with no author identity human', () => {
    expect(classifyAttribution({})).toEqual({
      attribution: 'unknown',
      agent: null,
      confidence: 0,
      signals: [],
    });
    expect(
      classifyAttribution({ authorLogin: '  ', authorEmail: '', authorName: null, message: 'x' })
        .attribution,
    ).toBe('unknown');
  });

  it('calls a bot that is not an AI agent unknown, not human', () => {
    const result = classifyAttribution({ authorLogin: 'dependabot[bot]', message: 'chore: bump' });
    expect(result.attribution).toBe('unknown');
    expect(result.confidence).toBe(0);
    expect(result.signals).toEqual([
      { kind: 'bot-login', detail: 'author dependabot[bot] is a bot that is not an AI agent' },
    ]);
  });

  it('calls a known agent bot author agent-authored', () => {
    const result = classifyAttribution({ authorLogin: 'copilot-swe-agent[bot]' });
    expect(result.attribution).toBe('agent-authored');
    expect(result.agent).toBe('github-copilot');
    expect(result.confidence).toBeCloseTo(KIND_WEIGHTS['bot-login']);
    expect(result.signals[0]?.kind).toBe('bot-login');
  });

  it.each([
    ['Copilot', 'github-copilot'],
    ['devin-ai-integration[bot]', 'devin'],
    ['chatgpt-codex-connector[bot]', 'openai-codex'],
    ['google-labs-jules[bot]', 'google-jules'],
    ['amazon-q-developer[bot]', 'amazon-q-developer'],
    ['openhands-agent', 'openhands'],
    ['sweep-ai[bot]', 'sweep'],
    ['kiro-agent[bot]', 'kiro'],
    ['claude[bot]', 'claude-code'],
  ])('knows %s as %s', (login, agent) => {
    const result = classifyAttribution({ authorLogin: login });
    expect(result.attribution).toBe('agent-authored');
    expect(result.agent).toBe(agent);
  });

  it('calls a Claude co-author trailer on a human commit ai-assisted', () => {
    const result = classifyAttribution({
      ...human,
      message: 'feat: x\n\nCo-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>',
    });
    expect(result.attribution).toBe('ai-assisted');
    expect(result.agent).toBe('claude-code');
    expect(result.signals).toEqual([
      {
        kind: 'trailer',
        detail: 'co-authored-by trailer matches "noreply@anthropic.com" (claude-code)',
      },
    ]);
  });

  it('ignores a co-author trailer that is not in the final paragraph', () => {
    const result = classifyAttribution({
      ...human,
      message: 'feat: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n\nThanks all.',
    });
    expect(result.attribution).toBe('human');
  });

  it('only reads the attribution trailer keys', () => {
    const result = classifyAttribution({
      ...human,
      message: 'feat: x\n\nReviewed-by: Claude <noreply@anthropic.com>',
    });
    expect(result.attribution).toBe('human');
  });

  it.each(['Assisted-by', 'generated-by', 'CO-AUTHORED-BY'])('reads %s', (key) => {
    const result = classifyAttribution({
      ...human,
      message: `x\n\n${key}: Codex <267193182+codex@users.noreply.github.com>`,
    });
    expect(result.attribution).toBe('ai-assisted');
    expect(result.agent).toBe('openai-codex');
  });

  it('reads the Cursor attribution trailer', () => {
    const result = classifyAttribution({ ...human, message: 'x\n\nMade-with: Cursor' });
    expect(result.attribution).toBe('ai-assisted');
    expect(result.agent).toBe('cursor');
  });

  it('reads the Claude Code footer from the message or the PR notes', () => {
    const footer = '🤖 Generated with [Claude Code](https://claude.com/claude-code)';
    expect(classifyAttribution({ ...human, notes: `Summary\n\n${footer}` }).attribution).toBe(
      'ai-assisted',
    );
    const inMessage = classifyAttribution({
      ...human,
      message: `feat: x\n\n${footer}\n\nCo-Authored-By: Claude <noreply@anthropic.com>`,
    });
    expect(inMessage.attribution).toBe('ai-assisted');
    expect(inMessage.signals.map((signal) => signal.kind)).toEqual(['trailer', 'message-marker']);
    expect(inMessage.confidence).toBeCloseTo(
      1 - (1 - KIND_WEIGHTS.trailer) * (1 - KIND_WEIGHTS['message-marker']),
    );
  });

  it('reads the Aider author suffix and message prefix', () => {
    const suffix = classifyAttribution({ ...human, authorName: 'Octo Dev (aider)' });
    expect(suffix.attribution).toBe('ai-assisted');
    expect(suffix.agent).toBe('aider');
    expect(suffix.signals[0]?.kind).toBe('author-name');

    const prefix = classifyAttribution({ ...human, message: 'aider: fix the parser' });
    expect(prefix.attribution).toBe('ai-assisted');
    expect(prefix.agent).toBe('aider');
    // The prefix is anchored: the same text in the body is prose, not a marker.
    expect(
      classifyAttribution({ ...human, message: 'fix\n\nthen aider: did it' }).attribution,
    ).toBe('human');
    expect(classifyAttribution({ ...human, notes: 'aider: wrote it' }).attribution).toBe(
      'ai-assisted',
    );
  });

  it('reads an agent author email, including the GitHub noreply id prefix', () => {
    const cursor = classifyAttribution({ authorEmail: 'CursorAgent@cursor.com' });
    expect(cursor.attribution).toBe('agent-authored');
    expect(cursor.agent).toBe('cursor');

    const copilot = classifyAttribution({
      authorName: 'Copilot',
      authorEmail: '198982749+copilot@users.noreply.github.com',
    });
    expect(copilot.attribution).toBe('agent-authored');
    expect(copilot.agent).toBe('github-copilot');
    // A lookalike address is not the agent.
    expect(
      classifyAttribution({ authorEmail: 'evilcopilot@users.noreply.github.com' }).attribution,
    ).toBe('human');
  });

  it('reads the agent branch prefixes', () => {
    for (const [branch, agent] of [
      ['copilot/fix-123', 'github-copilot'],
      ['codex/add-tests', 'openai-codex'],
      ['Cursor/refactor-x', 'cursor'],
    ] as const) {
      const result = classifyAttribution({ ...human, branch });
      expect(result.attribution).toBe('agent-authored');
      expect(result.agent).toBe(agent);
    }
    expect(classifyAttribution({ ...human, branch: 'feature/copilot/x' }).attribution).toBe(
      'human',
    );
  });

  it('lets agent-authored win over ai-assisted when signals conflict', () => {
    const result = classifyAttribution({
      ...human,
      branch: 'copilot/fix-1',
      message: 'x\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
    });
    expect(result.attribution).toBe('agent-authored');
    expect(result.agent).toBe('github-copilot');
    expect(result.confidence).toBeCloseTo(
      1 - (1 - KIND_WEIGHTS['branch-prefix']) * (1 - KIND_WEIGHTS.trailer),
    );
  });

  it('names the agent with the most signals, table order breaking a tie', () => {
    const result = classifyAttribution({
      authorLogin: 'chatgpt-codex-connector[bot]',
      branch: 'codex/x',
      message: 'x\n\nCo-authored-by: Copilot <copilot@github.com>',
    });
    expect(result.agent).toBe('openai-codex');

    const tie = classifyAttribution({ authorLogin: 'Copilot', branch: 'codex/x' });
    expect(tie.agent).toBe('github-copilot');
  });

  it('does not count two signals of one kind as independent', () => {
    const one = classifyAttribution({ ...human, branch: 'codex/x' });
    const two = classifyAttribution({ ...human, branch: 'codex/x', authorLogin: 'Copilot' });
    const same = classifyAttribution({
      ...human,
      message:
        'x\n\nCo-authored-by: Claude <noreply@anthropic.com>\nCo-authored-by: Codex <codex@users.noreply.github.com>',
    });
    expect(two.confidence).toBeGreaterThan(one.confidence);
    expect(same.confidence).toBeCloseTo(KIND_WEIGHTS.trailer);
    expect(same.signals).toHaveLength(2);
  });

  it('treats an agent committer on a human commit as assistance, and alone as authorship', () => {
    const assisted = classifyAttribution({ ...human, committerLogin: 'copilot-swe-agent[bot]' });
    expect(assisted.attribution).toBe('ai-assisted');
    expect(assisted.signals[0]?.detail).toContain('committer');

    const alone = classifyAttribution({ committerLogin: 'copilot-swe-agent[bot]' });
    expect(alone.attribution).toBe('agent-authored');

    // A non-AI bot committer (GitHub's own) is no signal at all.
    expect(classifyAttribution({ ...human, committerLogin: 'web-flow' }).signals).toEqual([]);
  });

  it('reads configured labels, which carry no agent name', () => {
    const options = { agentLabels: ['AI-Agent'], assistedLabels: ['ai-assisted'] };
    const agent = classifyAttribution({ ...human, labels: ['ai-agent'] }, options);
    expect(agent).toEqual({
      attribution: 'agent-authored',
      agent: null,
      confidence: KIND_WEIGHTS.label,
      signals: [{ kind: 'label', detail: 'label "ai-agent" marks agent-authored change' }],
    });
    const assisted = classifyAttribution({ ...human, labels: ['AI-Assisted'] }, options);
    expect(assisted.attribution).toBe('ai-assisted');
    expect(classifyAttribution({ ...human, labels: ['ai-agent'] }).attribution).toBe('human');
  });

  it('falls back to any named agent when the winning signals name none', () => {
    const result = classifyAttribution(
      { ...human, labels: ['bot-pr'], message: 'x\n\nMade-with: Cursor' },
      { agentLabels: ['bot-pr'] },
    );
    expect(result.attribution).toBe('agent-authored');
    expect(result.agent).toBe('cursor');
  });

  it('classifies AI involvement with no author identity by the signal', () => {
    const result = classifyAttribution({ branch: 'codex/x' });
    expect(result.attribution).toBe('agent-authored');
    const assisted = classifyAttribution({
      message: 'x\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
    });
    expect(assisted.attribution).toBe('ai-assisted');
  });

  it('keeps confidence inside [0, 1] when every kind fires', () => {
    const result = classifyAttribution(
      {
        authorLogin: 'Copilot',
        authorEmail: 'cursoragent@cursor.com',
        authorName: 'x (aider)',
        branch: 'copilot/x',
        labels: ['ai'],
        message: 'aider: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>',
      },
      { agentLabels: ['ai'] },
    );
    expect(result.confidence).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThan(0.99);
  });
});
