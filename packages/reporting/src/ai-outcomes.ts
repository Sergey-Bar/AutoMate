import type { Scorecard, ScorecardMetric } from '@automate/shared-contracts';
import type { Attribution } from './ai-attribution.js';
import { compareRates, median, wilson, type Interval } from './stats.js';

/**
 * What AI-written change does to a repository, measured against human change.
 *
 * The question a team asks of its agents is not "how much do they write" but "is what they
 * write worse". Every outcome here is therefore a rate beside the human rate, with an
 * interval, and a difference is only declared when the intervals separate *and* both sides
 * carry at least `minSample` observations. A dashboard that calls 3 reverts of 7 agent
 * PRs "43% revert rate, 10x human" teaches a team to distrust the scorecard.
 *
 * **There is no per-person data in the output, by design.** The input carries no author,
 * and the output carries no change id: the unit of comparison is a kind of authorship and
 * a tool, never a developer. A per-person AI-usage table is a surveillance instrument, and
 * the governance question does not need one to be answered.
 */

export interface AiOutcomeChange {
  id: string;
  attribution: Attribution;
  agent: string | null;
  mergedAt: string;
  reverted: boolean;
  /** `null` when nobody determined whether it caused a failure. */
  causedFailure: boolean | null;
  /** Days until a later fix touched the same files; `null` if none has. */
  followUpFixDays: number | null;
  linesChanged: number;
  reviewComments: number;
  approvedWithoutComments: boolean;
  /** In whatever unit the producer reports; the mean is in the same unit. */
  diffCoverage: number | null;
  /** New high or critical findings the change introduced. */
  newHighFindings: number | null;
}

export interface RateStat {
  successes: number;
  trials: number;
  /** `null` over no trials: a rate over nothing is not zero. */
  rate: number | null;
  interval: Interval | null;
}

export interface ValueStat {
  value: number | null;
  sampleSize: number;
}

export type RateComparison = 'higher' | 'lower' | 'same' | 'insufficient';

export interface OutcomeStats {
  n: number;
  revert: RateStat;
  changeFailure: RateStat;
  followUpFix14: RateStat;
  followUpFix30: RateStat;
  /** Median review comments per 100 changed lines. */
  reviewDepth: ValueStat;
  rubberStamp: RateStat;
  diffCoverage: ValueStat;
  /** Mean new high/critical findings per change. */
  newHighFindings: ValueStat;
}

export interface VersusHuman {
  revert: RateComparison;
  changeFailure: RateComparison;
  followUpFix14: RateComparison;
  followUpFix30: RateComparison;
  rubberStamp: RateComparison;
}

export interface OutcomeGroup extends OutcomeStats {
  /** `null` for the human group itself. */
  vsHuman: VersusHuman | null;
}

export interface AgentOutcome extends OutcomeGroup {
  agent: string;
}

export interface AiOutcomeComparison {
  evaluatedAt: string;
  windowDays: number;
  minSample: number;
  /** Changes inside the window. */
  total: number;
  /** Changes outside the window or with an unreadable merge time. */
  excluded: number;
  groups: Record<Attribution, OutcomeGroup>;
  /** One row per AI tool, in name order. */
  agents: AgentOutcome[];
}

export interface AiOutcomeOptions {
  now: string;
  windowDays: number;
  minSample?: number;
}

const DAY_MS = 86_400_000;
type ComparedRate = keyof VersusHuman;

function parseNow(now: string): number {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) throw new RangeError(`now is not a readable time: ${now}`);
  return at;
}

function rate(successes: number, trials: number): RateStat {
  return {
    successes,
    trials,
    rate: trials > 0 ? successes / trials : null,
    interval: wilson(successes, trials),
  };
}

function mean(values: readonly number[]): ValueStat {
  if (values.length === 0) return { value: null, sampleSize: 0 };
  return {
    value: values.reduce((sum, value) => sum + value, 0) / values.length,
    sampleSize: values.length,
  };
}

function finite(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

interface Dated {
  change: AiOutcomeChange;
  ageDays: number;
}

/**
 * A follow-up fix within `days` is only observable for a change at least `days` old. A
 * change merged last week has not had the chance to need a 30-day fix, and counting it as
 * "no fix" would make the newest — often the most agent-heavy — change look the safest.
 */
function followUp(dated: readonly Dated[], days: number): RateStat {
  let successes = 0;
  let trials = 0;
  for (const { change, ageDays } of dated) {
    if (ageDays < days) continue;
    const fix = change.followUpFixDays;
    if (fix !== null && (!Number.isFinite(fix) || fix < 0)) continue;
    trials += 1;
    if (fix !== null && fix <= days) successes += 1;
  }
  return rate(successes, trials);
}

function stats(dated: readonly Dated[]): OutcomeStats {
  const changes = dated.map((item) => item.change);
  const judged = changes.filter((change) => change.causedFailure !== null);
  const depth = changes
    .filter((change) => change.linesChanged > 0)
    .map((change) => (change.reviewComments / change.linesChanged) * 100);
  return {
    n: changes.length,
    revert: rate(changes.filter((change) => change.reverted).length, changes.length),
    changeFailure: rate(
      judged.filter((change) => change.causedFailure === true).length,
      judged.length,
    ),
    followUpFix14: followUp(dated, 14),
    followUpFix30: followUp(dated, 30),
    reviewDepth: { value: median(depth), sampleSize: depth.length },
    rubberStamp: rate(
      changes.filter((change) => change.approvedWithoutComments).length,
      changes.length,
    ),
    diffCoverage: mean(finite(changes.map((change) => change.diffCoverage))),
    newHighFindings: mean(finite(changes.map((change) => change.newHighFindings))),
  };
}

/**
 * One rate against the human rate. `insufficient` below the sample floor on either side,
 * whatever the intervals say: a floor is what keeps a small, lucky sample from becoming a
 * headline.
 */
export function compareRate(group: RateStat, human: RateStat, minSample: number): RateComparison {
  if (group.trials < minSample || human.trials < minSample) return 'insufficient';
  return compareRates(group, human) ?? 'insufficient';
}

function versus(group: OutcomeStats, human: OutcomeStats, minSample: number): VersusHuman {
  const against = (key: ComparedRate) => compareRate(group[key], human[key], minSample);
  return {
    revert: against('revert'),
    changeFailure: against('changeFailure'),
    followUpFix14: against('followUpFix14'),
    followUpFix30: against('followUpFix30'),
    rubberStamp: against('rubberStamp'),
  };
}

/**
 * Validate the window and return the sample floor, in that order, so a bad window is
 * reported before a bad floor.
 */
function comparisonMinSample(options: AiOutcomeOptions): number {
  const { windowDays } = options;
  if (!Number.isFinite(windowDays) || windowDays <= 0) {
    throw new RangeError(`windowDays must be positive: ${windowDays}`);
  }
  const minSample = options.minSample ?? 20;
  if (!Number.isInteger(minSample) || minSample < 1) {
    throw new RangeError(`minSample must be a positive integer: ${minSample}`);
  }
  return minSample;
}

/** The changes merged inside the window, each with its age; unreadable merge times drop out. */
function datedInWindow(
  changes: readonly AiOutcomeChange[],
  nowMs: number,
  windowDays: number,
): Dated[] {
  const inWindow: Dated[] = [];
  for (const change of changes) {
    const merged = Date.parse(change.mergedAt);
    const ageDays = (nowMs - merged) / DAY_MS;
    if (Number.isFinite(ageDays) && ageDays >= 0 && ageDays <= windowDays) {
      inWindow.push({ change, ageDays });
    }
  }
  return inWindow;
}

function isAiAttribution(attribution: Attribution): boolean {
  return attribution === 'agent-authored' || attribution === 'ai-assisted';
}

/** AI change grouped by tool. A tool name on human or unknown change is ignored. */
function groupByAgent(inWindow: readonly Dated[]): Map<string, Dated[]> {
  const byAgent = new Map<string, Dated[]>();
  for (const item of inWindow) {
    const { attribution, agent } = item.change;
    if (agent === null || !isAiAttribution(attribution)) continue;
    const items = byAgent.get(agent);
    if (items === undefined) byAgent.set(agent, [item]);
    else items.push(item);
  }
  return byAgent;
}

/**
 * Compare the outcomes of AI-written and human change over one window.
 *
 * Changes are grouped by attribution — `unknown` kept apart rather than folded into
 * `human`, because an unattributed change may well be an agent's — and by AI tool. Only
 * agent-authored and ai-assisted change is grouped by tool; a tool name on a human or
 * unknown change is ignored, since it cannot be a claim about that tool's output.
 */
export function compareAiOutcomes(
  changes: readonly AiOutcomeChange[],
  options: AiOutcomeOptions,
): AiOutcomeComparison {
  const nowMs = parseNow(options.now);
  const { windowDays } = options;
  const minSample = comparisonMinSample(options);
  const inWindow = datedInWindow(changes, nowMs, windowDays);

  const human = stats(inWindow.filter((item) => item.change.attribution === 'human'));
  const group = (attribution: Exclude<Attribution, 'human'>): OutcomeGroup => {
    const own = stats(inWindow.filter((item) => item.change.attribution === attribution));
    return { ...own, vsHuman: versus(own, human, minSample) };
  };
  const groups: Record<Attribution, OutcomeGroup> = {
    'agent-authored': group('agent-authored'),
    'ai-assisted': group('ai-assisted'),
    human: { ...human, vsHuman: null },
    unknown: group('unknown'),
  };

  const byAgent = groupByAgent(inWindow);
  const agents = [...byAgent.keys()].sort().map((agent) => {
    // Every key was set with at least one change just above.
    const own = stats(byAgent.get(agent) as Dated[]);
    return { agent, ...own, vsHuman: versus(own, human, minSample) };
  });

  return {
    evaluatedAt: new Date(nowMs).toISOString(),
    windowDays,
    minSample,
    total: inWindow.length,
    excluded: changes.length - inWindow.length,
    groups,
    agents,
  };
}

function pooled(left: RateStat, right: RateStat): RateStat {
  return rate(left.successes + right.successes, left.trials + right.trials);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

interface Comparison {
  key: string;
  label: string;
  /** Finishes "AI-written change … than human change". */
  verb: string;
  ai: RateStat;
  human: RateStat;
}

const UNKNOWN_SHARE_TARGET = 20;

/**
 * The `ai-code` scorecard: how much change is AI-written, and whether it is reverted or
 * causes failures more often than human change.
 *
 * Agent-authored and ai-assisted change are pooled as "AI change" here, because the card
 * answers one question; the split is in the comparison it is built from. The score is
 * 100 while AI change is no worse than human change, and falls by the credible excess
 * rate otherwise — `100 − 100·(ai − human)`, so an AI revert rate 38 points above human
 * scores 62. Only a difference the comparison would declare moves it.
 *
 * `ai-share` is informational: more AI change is neither good nor bad, so it is always
 * `good` when measured and never limits the score. `attribution-unknown` warns above 20%,
 * because past that the human baseline may be quietly full of agent change. When every
 * change is unknown, attribution is not set up, and the card says `not_configured` rather
 * than `insufficient`.
 */
export function aiCodeScorecard(
  result: AiOutcomeComparison,
  options: { now: string; windowDays: number },
): Scorecard {
  const evaluatedAt = new Date(parseNow(options.now)).toISOString();
  const { windowDays } = options;
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366) {
    throw new RangeError(`windowDays must be an integer in [1, 366]: ${windowDays}`);
  }
  const { groups, minSample, total } = result;
  const configured = total === 0 || groups.unknown.n < total;
  const unmeasured = unmeasuredFor(configured);

  const metrics: ScorecardMetric[] = shareMetrics(result, configured, unmeasured);
  const reasons: string[] = [];
  const scored: Scored[] = [];
  for (const comparison of aiCodeComparisons(groups)) {
    const outcome = comparisonMetrics(comparison, minSample, unmeasured);
    metrics.push(...outcome.metrics);
    if (outcome.scored !== null) scored.push(outcome.scored);
    if (outcome.reason !== null) reasons.push(outcome.reason);
  }

  const { score, cappedBy } = lowestScore(scored);
  return {
    id: 'ai-code',
    title: 'AI-written code',
    dimension: 'ai-governance',
    evaluatedAt,
    windowDays,
    status: cardStatus(configured, reasons, score),
    score: score === null ? null : Math.round(score),
    cappedBy,
    metrics,
    reasons,
  };
}

const METRIC_BASE = { direction: 'lower-better' as const, trend: null, band: null };

type Measurement = Pick<ScorecardMetric, 'value' | 'status' | 'summary'>;
type Unmeasured = (summary: string) => Measurement;

interface Scored {
  key: string;
  score: number;
}

/**
 * What an unmeasured metric says: `insufficient` with its own reason while attribution is
 * set up, `not_configured` with one shared reason when it is not.
 */
function unmeasuredFor(configured: boolean): Unmeasured {
  return (summary) =>
    configured
      ? { value: null, status: 'insufficient', summary }
      : {
          value: null,
          status: 'not_configured',
          summary: 'No change in the window could be attributed; attribution is not set up.',
        };
}

/** `ai-share` and `attribution-unknown`, both measured only past the sample floor. */
function shareMetrics(
  result: AiOutcomeComparison,
  configured: boolean,
  unmeasured: Unmeasured,
): ScorecardMetric[] {
  const { groups, minSample, total } = result;
  const unknown = groups.unknown.n;
  const aiCount = groups['agent-authored'].n + groups['ai-assisted'].n;
  const enough = total >= minSample;
  const measured = configured && enough;
  const tooFew = `${total} changes in the window; ${minSample} are needed.`;
  const unknownShare = enough ? (unknown / total) * 100 : 0;
  return [
    {
      key: 'ai-share',
      label: 'Share of change written with AI',
      unit: 'percent',
      ...METRIC_BASE,
      direction: 'higher-better',
      target: null,
      sampleSize: total,
      ...(measured
        ? {
            value: (aiCount / total) * 100,
            status: 'good' as const,
            summary: `${aiCount} of ${total} changes were agent-authored or AI-assisted. Informational.`,
          }
        : unmeasured(tooFew)),
    },
    {
      key: 'attribution-unknown',
      label: 'Share of change with unknown attribution',
      unit: 'percent',
      ...METRIC_BASE,
      target: UNKNOWN_SHARE_TARGET,
      sampleSize: total,
      ...(measured
        ? {
            value: unknownShare,
            status: unknownShare > UNKNOWN_SHARE_TARGET ? ('warn' as const) : ('good' as const),
            summary: `${unknown} of ${total} changes had no author identity to attribute.`,
          }
        : unmeasured(tooFew)),
    },
  ];
}

function aiCodeComparisons(groups: AiOutcomeComparison['groups']): Comparison[] {
  return [
    {
      key: 'revert-rate',
      label: 'revert rate',
      verb: 'is reverted more often',
      ai: pooled(groups['agent-authored'].revert, groups['ai-assisted'].revert),
      human: groups.human.revert,
    },
    {
      key: 'change-failure-rate',
      label: 'change failure rate',
      verb: 'causes a failure more often',
      ai: pooled(groups['agent-authored'].changeFailure, groups['ai-assisted'].changeFailure),
      human: groups.human.changeFailure,
    },
  ];
}

interface ComparisonOutcome {
  /** The AI metric, then the human baseline it is compared against. */
  metrics: ScorecardMetric[];
  scored: Scored | null;
  reason: string | null;
}

function comparisonMetrics(
  comparison: Comparison,
  minSample: number,
  unmeasured: Unmeasured,
): ComparisonOutcome {
  const humanRate = comparison.human.trials >= minSample ? comparison.human.rate : null;
  const verdict = compareRate(comparison.ai, comparison.human, minSample);
  const human = humanMetric(comparison, humanRate, minSample, unmeasured);
  if (verdict === 'insufficient') {
    const ai = insufficientAiMetric(comparison, humanRate, minSample, unmeasured);
    return { metrics: [ai, human], scored: null, reason: null };
  }
  // Past the sample floor on both sides, both rates exist.
  const judged = judgedAiMetric(comparison, verdict === 'higher', humanRate as number);
  return { metrics: [judged.metric, human], scored: judged.scored, reason: judged.reason };
}

function insufficientAiMetric(
  comparison: Comparison,
  humanRate: number | null,
  minSample: number,
  unmeasured: Unmeasured,
): ScorecardMetric {
  return {
    key: `ai-${comparison.key}`,
    label: `AI change ${comparison.label}`,
    unit: 'percent',
    ...METRIC_BASE,
    target: humanRate === null ? null : humanRate * 100,
    sampleSize: comparison.ai.trials,
    ...unmeasured(
      `${comparison.ai.trials} AI and ${comparison.human.trials} human changes measured; ${minSample} of each are needed.`,
    ),
  };
}

/**
 * A declared comparison. The score is 100 unless AI change is credibly worse, and then
 * falls by the excess rate.
 */
function judgedAiMetric(
  comparison: Comparison,
  worse: boolean,
  humanRate: number,
): { metric: ScorecardMetric; scored: Scored; reason: string | null } {
  const aiKey = `ai-${comparison.key}`;
  const aiRate = comparison.ai.rate as number;
  const score = worse ? Math.max(0, 100 - 100 * (aiRate - humanRate)) : 100;
  const detail = `${percent(aiRate)} vs ${percent(humanRate)} (n=${comparison.ai.trials} vs ${comparison.human.trials})`;
  return {
    metric: {
      key: aiKey,
      label: `AI change ${comparison.label}`,
      unit: 'percent',
      ...METRIC_BASE,
      value: aiRate * 100,
      target: humanRate * 100,
      sampleSize: comparison.ai.trials,
      status: worse ? 'bad' : 'good',
      summary: worse
        ? `Credibly above human change: ${detail}.`
        : `Not credibly above human change: ${detail}.`,
    },
    scored: { key: aiKey, score },
    reason: worse ? `AI-written change ${comparison.verb} than human change: ${detail}.` : null,
  };
}

function humanMetric(
  comparison: Comparison,
  humanRate: number | null,
  minSample: number,
  unmeasured: Unmeasured,
): ScorecardMetric {
  return {
    key: `human-${comparison.key}`,
    label: `Human change ${comparison.label}`,
    unit: 'percent',
    ...METRIC_BASE,
    target: null,
    sampleSize: comparison.human.trials,
    ...(humanRate !== null
      ? {
          value: humanRate * 100,
          status: 'good' as const,
          summary: `The baseline AI change is compared against, over ${comparison.human.trials} changes.`,
        }
      : unmeasured(`${comparison.human.trials} human changes measured; ${minSample} are needed.`)),
  };
}

/** The lowest score and the metric that set it; the first of equal scores wins. */
function lowestScore(scored: readonly Scored[]): { score: number | null; cappedBy: string | null } {
  let score: number | null = null;
  let cappedBy: string | null = null;
  for (const entry of scored) {
    if (score === null || entry.score < score) {
      score = entry.score;
      cappedBy = entry.key;
    }
  }
  return { score, cappedBy };
}

function cardStatus(
  configured: boolean,
  reasons: readonly string[],
  score: number | null,
): Scorecard['status'] {
  if (!configured) return 'not_configured';
  if (reasons.length > 0) return 'fail';
  return score !== null ? 'pass' : 'insufficient';
}
