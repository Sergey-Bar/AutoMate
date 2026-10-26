import { describe, expect, it } from 'vitest';
import { ScorecardSchema } from '@automate/shared-contracts';
import {
  aiCodeScorecard,
  compareAiOutcomes,
  compareRate,
  type AiOutcomeChange,
  type AiOutcomeComparison,
} from './ai-outcomes.js';
import { wilson } from './stats.js';

const NOW = '2026-10-26T00:00:00.000Z';
const DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY).toISOString();
}

let sequence = 0;
function change(overrides: Partial<AiOutcomeChange> = {}): AiOutcomeChange {
  sequence += 1;
  return {
    id: `change-${sequence}`,
    attribution: 'human',
    agent: null,
    mergedAt: daysAgo(40),
    reverted: false,
    causedFailure: false,
    followUpFixDays: null,
    linesChanged: 100,
    reviewComments: 2,
    approvedWithoutComments: false,
    diffCoverage: null,
    newHighFindings: null,
    ...overrides,
  };
}

function many(count: number, overrides: (index: number) => Partial<AiOutcomeChange>) {
  return Array.from({ length: count }, (_, index) => change(overrides(index)));
}

const options = { now: NOW, windowDays: 90 };

describe('compareAiOutcomes', () => {
  it('measures nothing over nothing', () => {
    const result = compareAiOutcomes([], options);
    expect(result.total).toBe(0);
    expect(result.excluded).toBe(0);
    expect(result.minSample).toBe(20);
    expect(result.evaluatedAt).toBe(NOW);
    expect(result.agents).toEqual([]);
    for (const group of Object.values(result.groups)) {
      expect(group.n).toBe(0);
      expect(group.revert).toEqual({ successes: 0, trials: 0, rate: null, interval: null });
      expect(group.reviewDepth).toEqual({ value: null, sampleSize: 0 });
    }
    expect(result.groups.human.vsHuman).toBeNull();
    expect(result.groups['agent-authored'].vsHuman).toEqual({
      revert: 'insufficient',
      changeFailure: 'insufficient',
      followUpFix14: 'insufficient',
      followUpFix30: 'insufficient',
      rubberStamp: 'insufficient',
    });
  });

  it('keeps only changes merged inside the window', () => {
    const result = compareAiOutcomes(
      [
        change({ mergedAt: daysAgo(90) }),
        change({ mergedAt: daysAgo(0) }),
        change({ mergedAt: daysAgo(90.01) }),
        change({ mergedAt: daysAgo(-1) }),
        change({ mergedAt: 'not a date' }),
      ],
      options,
    );
    expect(result.total).toBe(2);
    expect(result.excluded).toBe(3);
  });

  it('gives every rate a Wilson interval', () => {
    const changes = many(10, (index) => ({ reverted: index < 3, causedFailure: index < 1 }));
    const { human } = compareAiOutcomes(changes, options).groups;
    expect(human.revert).toEqual({ successes: 3, trials: 10, rate: 0.3, interval: wilson(3, 10) });
    expect(human.changeFailure.successes).toBe(1);
    expect(human.changeFailure.interval).toEqual(wilson(1, 10));
  });

  it('leaves a change whose failure was not determined out of the failure rate', () => {
    const changes = [change({ causedFailure: null }), change({ causedFailure: true })];
    const { human } = compareAiOutcomes(changes, options).groups;
    expect(human.n).toBe(2);
    expect(human.changeFailure).toMatchObject({ successes: 1, trials: 1, rate: 1 });
  });

  it('counts a follow-up fix only once the change is old enough to have had one', () => {
    const changes = [
      change({ mergedAt: daysAgo(10), followUpFixDays: 3 }), // too young for either window
      change({ mergedAt: daysAgo(20), followUpFixDays: 5 }), // 14-day only
      change({ mergedAt: daysAgo(40), followUpFixDays: 20 }), // fixed, but after 14 days
      change({ mergedAt: daysAgo(40), followUpFixDays: null }), // never fixed
      change({ mergedAt: daysAgo(40), followUpFixDays: 14 }), // the boundary counts
    ];
    const { human } = compareAiOutcomes(changes, options).groups;
    expect(human.followUpFix14).toMatchObject({ successes: 2, trials: 4 });
    expect(human.followUpFix30).toMatchObject({ successes: 2, trials: 3 });
  });

  it('ignores a follow-up fix interval that cannot be real', () => {
    const changes = [
      change({ followUpFixDays: -1 }),
      change({ followUpFixDays: Number.NaN }),
      change({ followUpFixDays: 2 }),
    ];
    const { human } = compareAiOutcomes(changes, options).groups;
    expect(human.followUpFix14).toMatchObject({ successes: 1, trials: 1 });
  });

  it('measures review depth as the median comments per 100 changed lines', () => {
    const changes = [
      change({ linesChanged: 100, reviewComments: 1 }),
      change({ linesChanged: 50, reviewComments: 2 }),
      change({ linesChanged: 200, reviewComments: 20 }),
      change({ linesChanged: 0, reviewComments: 5 }),
    ];
    const { human } = compareAiOutcomes(changes, options).groups;
    expect(human.reviewDepth).toEqual({ value: 4, sampleSize: 3 });
  });

  it('measures the rubber-stamp rate, coverage and new findings', () => {
    const changes = [
      change({ approvedWithoutComments: true, diffCoverage: 0.8, newHighFindings: 1 }),
      change({ diffCoverage: 0.6, newHighFindings: 0 }),
      change({ diffCoverage: null, newHighFindings: null }),
      change({ diffCoverage: Number.NaN, newHighFindings: 2 }),
    ];
    const { human } = compareAiOutcomes(changes, options).groups;
    expect(human.rubberStamp).toMatchObject({ successes: 1, trials: 4 });
    expect(human.diffCoverage.value).toBeCloseTo(0.7);
    expect(human.diffCoverage.sampleSize).toBe(2);
    expect(human.newHighFindings).toEqual({ value: 1, sampleSize: 3 });
  });

  it('calls a difference only when the intervals separate and both sides have the sample', () => {
    const humans = many(100, (index) => ({ reverted: index < 2 }));
    const agents = many(25, (index) => ({
      attribution: 'agent-authored',
      agent: 'github-copilot',
      reverted: index < 10,
      causedFailure: false,
    }));
    const result = compareAiOutcomes([...humans, ...agents], options);
    expect(result.groups['agent-authored'].vsHuman?.revert).toBe('higher');
    expect(result.groups['agent-authored'].vsHuman?.changeFailure).toBe('same');

    // The same difference over a sample below the floor is not declared.
    const fewer = compareAiOutcomes([...humans, ...agents.slice(0, 19)], options);
    expect(fewer.groups['agent-authored'].vsHuman?.revert).toBe('insufficient');
    const raised = compareAiOutcomes([...humans, ...agents], { ...options, minSample: 30 });
    expect(raised.groups['agent-authored'].vsHuman?.revert).toBe('insufficient');
  });

  it('calls a credibly lower rate lower', () => {
    const humans = many(40, (index) => ({ approvedWithoutComments: index < 30 }));
    const assisted = many(40, () => ({ attribution: 'ai-assisted', agent: 'claude-code' }));
    const result = compareAiOutcomes([...humans, ...assisted], options);
    expect(result.groups['ai-assisted'].vsHuman?.rubberStamp).toBe('lower');
  });

  it('reports each agent against human, in name order, and only for AI change', () => {
    const changes = [
      ...many(3, () => ({ attribution: 'agent-authored', agent: 'openai-codex' })),
      ...many(2, () => ({ attribution: 'ai-assisted', agent: 'claude-code' })),
      change({ attribution: 'agent-authored', agent: 'claude-code' }),
      change({ attribution: 'agent-authored', agent: null }),
      change({ attribution: 'human', agent: 'claude-code' }),
      change({ attribution: 'unknown', agent: 'openai-codex' }),
    ];
    const result = compareAiOutcomes(changes, options);
    expect(result.agents.map((agent) => [agent.agent, agent.n])).toEqual([
      ['claude-code', 3],
      ['openai-codex', 3],
    ]);
    expect(result.agents[0]?.vsHuman?.revert).toBe('insufficient');
    expect(result.groups.unknown.n).toBe(1);
    expect(result.groups['agent-authored'].n).toBe(5);
  });

  it('carries no per-change or per-person data', () => {
    const changes = many(30, (index) => ({
      attribution: index % 2 === 0 ? 'human' : 'agent-authored',
      agent: index % 2 === 0 ? null : 'devin',
    }));
    const serialised = JSON.stringify(compareAiOutcomes(changes, options));
    for (const item of changes) expect(serialised).not.toContain(item.id);
  });

  it('refuses a window or a clock it cannot read', () => {
    expect(() => compareAiOutcomes([], { now: 'yesterday', windowDays: 7 })).toThrow(RangeError);
    expect(() => compareAiOutcomes([], { now: NOW, windowDays: 0 })).toThrow(RangeError);
    expect(() => compareAiOutcomes([], { now: NOW, windowDays: Number.NaN })).toThrow(RangeError);
    expect(() => compareAiOutcomes([], { now: NOW, windowDays: 7, minSample: 0 })).toThrow(
      RangeError,
    );
  });
});

describe('compareRate', () => {
  const empty = { successes: 0, trials: 0, rate: null, interval: null };
  const some = { successes: 1, trials: 30, rate: 1 / 30, interval: wilson(1, 30) };

  it('is insufficient over no trials even with no floor', () => {
    expect(compareRate(empty, some, 0)).toBe('insufficient');
    expect(compareRate(some, some, 0)).toBe('same');
  });
});

function scorecardOf(result: AiOutcomeComparison) {
  const card = aiCodeScorecard(result, options);
  expect(ScorecardSchema.parse(card)).toEqual(card);
  return card;
}

function metric(card: ReturnType<typeof aiCodeScorecard>, key: string) {
  const found = card.metrics.find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`no metric ${key}`);
  return found;
}

describe('aiCodeScorecard', () => {
  it('fails when AI change is credibly reverted more often, and says why', () => {
    const humans = many(100, (index) => ({ reverted: index < 2 }));
    const agents = many(25, (index) => ({
      attribution: 'agent-authored',
      agent: 'github-copilot',
      reverted: index < 10,
    }));
    const card = scorecardOf(compareAiOutcomes([...humans, ...agents], options));
    expect(card.id).toBe('ai-code');
    expect(card.dimension).toBe('ai-governance');
    expect(card.windowDays).toBe(90);
    expect(card.evaluatedAt).toBe(NOW);
    expect(card.status).toBe('fail');
    expect(card.cappedBy).toBe('ai-revert-rate');
    expect(card.score).toBe(62);
    expect(card.reasons).toEqual([
      'AI-written change is reverted more often than human change: 40.0% vs 2.0% (n=25 vs 100).',
    ]);
    expect(metric(card, 'ai-revert-rate')).toMatchObject({
      value: 40,
      target: 2,
      status: 'bad',
      sampleSize: 25,
    });
    expect(metric(card, 'ai-change-failure-rate').status).toBe('good');
    expect(metric(card, 'ai-share')).toMatchObject({ value: 20, sampleSize: 125, status: 'good' });
    expect(metric(card, 'attribution-unknown')).toMatchObject({ value: 0, status: 'good' });
  });

  it('pools agent-authored and ai-assisted change as AI change', () => {
    const humans = many(30, () => ({}));
    const ai = [
      ...many(12, () => ({ attribution: 'agent-authored', agent: 'devin', causedFailure: true })),
      ...many(12, () => ({ attribution: 'ai-assisted', agent: 'cursor', causedFailure: true })),
    ];
    const card = scorecardOf(compareAiOutcomes([...humans, ...ai], options));
    expect(metric(card, 'ai-change-failure-rate')).toMatchObject({
      value: 100,
      sampleSize: 24,
      status: 'bad',
    });
    expect(card.cappedBy).toBe('ai-change-failure-rate');
    expect(card.score).toBe(0);
    expect(card.reasons[0]).toContain('causes a failure more often');
  });

  it('passes when AI change is no worse than human change', () => {
    const humans = many(40, (index) => ({ reverted: index < 2 }));
    const ai = many(40, (index) => ({ attribution: 'agent-authored', reverted: index < 3 }));
    const card = scorecardOf(compareAiOutcomes([...humans, ...ai], options));
    expect(card.status).toBe('pass');
    expect(card.score).toBe(100);
    expect(card.cappedBy).toBe('ai-revert-rate');
    expect(card.reasons).toEqual([]);
  });

  it('is insufficient, with no score, below the sample floor', () => {
    const changes = [...many(5, () => ({})), ...many(5, () => ({ attribution: 'ai-assisted' }))];
    const card = scorecardOf(compareAiOutcomes(changes, options));
    expect(card.status).toBe('insufficient');
    expect(card.score).toBeNull();
    expect(card.cappedBy).toBeNull();
    for (const item of card.metrics) {
      expect(item.status).toBe('insufficient');
      expect(item.value).toBeNull();
    }
  });

  it('measures the human baseline even when AI change is too rare to compare', () => {
    const changes = [...many(30, () => ({})), change({ attribution: 'agent-authored' })];
    const card = scorecardOf(compareAiOutcomes(changes, options));
    expect(card.status).toBe('insufficient');
    expect(metric(card, 'human-revert-rate')).toMatchObject({ value: 0, status: 'good' });
    expect(metric(card, 'ai-revert-rate')).toMatchObject({ value: null, target: 0 });
  });

  it('warns when too much change cannot be attributed', () => {
    const changes = [
      ...many(20, () => ({})),
      ...many(20, () => ({ attribution: 'agent-authored' })),
      ...many(15, () => ({ attribution: 'unknown' })),
    ];
    const card = scorecardOf(compareAiOutcomes(changes, options));
    expect(metric(card, 'attribution-unknown')).toMatchObject({
      status: 'warn',
      target: 20,
    });
    expect(metric(card, 'attribution-unknown').value).toBeCloseTo((15 / 55) * 100);
    expect(card.status).toBe('pass');
  });

  it('is not configured when nothing could be attributed at all', () => {
    const card = scorecardOf(
      compareAiOutcomes(
        many(30, () => ({ attribution: 'unknown' })),
        options,
      ),
    );
    expect(card.status).toBe('not_configured');
    expect(card.score).toBeNull();
    for (const item of card.metrics) expect(item.status).toBe('not_configured');
  });

  it('is insufficient over an empty window', () => {
    const card = scorecardOf(compareAiOutcomes([], options));
    expect(card.status).toBe('insufficient');
  });

  it('refuses a clock or window the contract cannot carry', () => {
    const result = compareAiOutcomes([], options);
    expect(() => aiCodeScorecard(result, { now: 'soon', windowDays: 90 })).toThrow(RangeError);
    expect(() => aiCodeScorecard(result, { now: NOW, windowDays: 1.5 })).toThrow(RangeError);
    expect(() => aiCodeScorecard(result, { now: NOW, windowDays: 400 })).toThrow(RangeError);
  });
});
