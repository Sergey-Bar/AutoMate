import {
  FINDING_SEVERITIES,
  HEALTH_DIMENSION_LABELS,
  HEALTH_DIMENSIONS,
  HEALTH_GATES,
  type CanonicalFinding,
  type DimensionMetric,
  type DimensionScore,
  type FindingSeverity,
  type FindingState,
  type FixNext,
  type HealthDimension,
  type HealthGate,
  type HealthGateId,
  type HealthGrade,
  type HealthLetter,
  type HealthPolicy,
  type HealthTool,
} from '@automate/shared-contracts';
import { weightedGeometric } from '../score/geometric.js';

/**
 * The repository health grade, as a pure function of what the scanners said.
 *
 * ## What it reads
 *
 * - `findingTools`: every scanner that **ran** and reports findings, and which dimensions it
 *   covers. A tool that ran and found nothing is a measurement of 100; a tool that did not
 *   run is no measurement at all. That distinction is the reason this list exists separately
 *   from `findings`.
 * - `findings`: every finding with its current state. Only `open` counts.
 * - `metrics`: numbers a tool reported on a 0–100 scale (coverage, duplication, Scorecard,
 *   Lighthouse, k6, the QA score).
 * - `failingTests`: from the latest test run on the default branch, `null` when none.
 *
 * ## What it refuses to do
 *
 * It never fills a dimension nobody measured, and it never prints a letter over fewer than
 * two dimensions or without Security: a repository graded `A` on its lint alone has been
 * told something untrue.
 */
export interface FindingObservation extends CanonicalFinding {
  state: FindingState;
}

export interface FindingToolRun {
  tool: HealthTool;
  dimensions: readonly HealthDimension[];
}

export interface HealthInputs {
  findingTools: readonly FindingToolRun[];
  findings: readonly FindingObservation[];
  metrics: readonly DimensionMetric[];
  failingTests: number | null;
  policy?: HealthPolicy | undefined;
}

export const DEFAULT_HEALTH_WEIGHTS: Readonly<Record<HealthDimension, number>> = {
  security: 25,
  tests: 20,
  'code-quality': 15,
  dependencies: 15,
  coverage: 10,
  'supply-chain': 10,
  runtime: 5,
  // Opt-in: shown as scorecards, counted only when a project's policy gives a weight.
  delivery: 0,
  'ai-governance': 0,
  'test-effectiveness': 0,
  'agent-quality': 0,
  accessibility: 0,
};

/**
 * What one open finding costs, before the decay.
 *
 * A dimension's findings score is `100 · e^(−Σpenalty / FINDINGS_DECAY)`: one critical is an
 * F (54), one high a C (78), one medium an A (93). Exponential rather than linear so the
 * hundredth low finding costs less than the first, and the score never goes below zero.
 */
export const SEVERITY_PENALTY: Readonly<Record<FindingSeverity, number>> = {
  critical: 25,
  high: 10,
  medium: 3,
  low: 1,
  info: 0,
};
export const FINDINGS_DECAY = 40;

/** Lowest score for each letter, best first. Below the last is `F`. */
export const LETTER_FLOORS: readonly (readonly [HealthLetter, number])[] = [
  ['A+', 97],
  ['A', 90],
  ['B', 80],
  ['C', 70],
  ['D', 60],
];

/** A tripped gate holds the overall score at or below this: the top of the `D` band. */
export const GATE_CEILING = 69;

/** A metric under this is offered as a fix-next item, and this is what it is raised to. */
export const METRIC_TARGET = 80;

/** At most this many rule groups are re-graded for fix-next, so a huge scan stays bounded. */
const MAX_FIX_CANDIDATES = 50;
const MAX_FIX_NEXT = 5;

export function letterFor(score: number): HealthLetter {
  for (const [letter, floor] of LETTER_FLOORS) {
    if (score >= floor) return letter;
  }
  return 'F';
}

export function findingsScore(findings: readonly FindingObservation[]): number {
  const penalty = findings.reduce(
    (sum, finding) => sum + (finding.state === 'open' ? SEVERITY_PENALTY[finding.severity] : 0),
    0,
  );
  return 100 * Math.exp(-penalty / FINDINGS_DECAY);
}

const GATE_STATEMENTS: Readonly<Record<HealthGateId, (count: number) => string>> = {
  'open-secret': (count) =>
    count === 0 ? 'No open secrets' : `${plural(count, 'open secret')} in the repository`,
  'fixable-critical-vulnerability': (count) =>
    count === 0
      ? 'No critical vulnerability with a fix available'
      : `${plural(count, 'critical vulnerability', 'critical vulnerabilities')} with a fix available`,
  'failing-tests': (count) =>
    count === 0
      ? 'No failing tests on the default branch'
      : `${plural(count, 'failing test')} on the default branch`,
};

function plural(count: number, one: string, many = `${one}s`): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

interface Computed {
  dimensions: DimensionScore[];
  gates: HealthGate[];
  /** The score before the incomplete rule, gate cap applied. What fix-next compares. */
  effective: number;
  incompleteReason: string | null;
  cappedBy: HealthDimension | HealthGateId | null;
  cappingValue: number | null;
}

function compute(inputs: HealthInputs): Computed {
  const open = inputs.findings.filter((finding) => finding.state === 'open');
  const dimensions = HEALTH_DIMENSIONS.map((dimension) => scoreDimension(dimension, inputs, open));
  const gates = evaluateGates(open, inputs);

  const terms = dimensions
    .filter((entry) => entry.measured && entry.weight > 0)
    .map((entry) => ({
      id: entry.dimension,
      value: (entry.score ?? 0) / 100,
      weight: entry.weight,
    }));
  const mean = weightedGeometric(terms);
  const raw = mean?.total ?? 0;
  const capping = gates.find((gate) => gate.enabled && gate.tripped);
  const gated = capping !== undefined && raw > GATE_CEILING;
  const effective = gated ? GATE_CEILING : raw;

  const measured = dimensions.filter((entry) => entry.measured);
  const incompleteReason = !measured.some((entry) => entry.dimension === 'security')
    ? 'Security has not been measured: run a secret scanner and a static analyser.'
    : terms.length < 2
      ? 'Fewer than two dimensions are measured, so there is no repository grade to give.'
      : null;

  return {
    dimensions,
    gates,
    effective,
    incompleteReason,
    cappedBy: gated ? capping.id : (mean?.cappedBy ?? null),
    cappingValue: gated ? GATE_CEILING : mean === null ? null : mean.cappingValue * 100,
  };
}

function scoreDimension(
  dimension: HealthDimension,
  inputs: HealthInputs,
  open: readonly FindingObservation[],
): DimensionScore {
  const findingTools = inputs.findingTools.filter((run) => run.dimensions.includes(dimension));
  const metrics = inputs.metrics.filter((metric) => metric.dimension === dimension);
  const weight = inputs.policy?.weights?.[dimension] ?? DEFAULT_HEALTH_WEIGHTS[dimension];
  const openFindings = Object.fromEntries(
    FINDING_SEVERITIES.map((severity) => [severity, 0]),
  ) as Record<FindingSeverity, number>;
  const mine = open.filter((finding) => finding.dimension === dimension);
  for (const finding of mine) openFindings[finding.severity] += 1;

  if (findingTools.length === 0 && metrics.length === 0) {
    return {
      dimension,
      measured: false,
      score: null,
      letter: null,
      weight,
      tools: [],
      openFindings,
      summary: [],
    };
  }

  const components: { id: string; value: number; weight: number }[] = [];
  const summary: string[] = [];
  if (findingTools.length > 0) {
    components.push({ id: 'findings', value: findingsScore(mine) / 100, weight: 1 });
    summary.push(findingsSentence(openFindings, findingTools));
  }
  for (const metric of metrics) {
    components.push({ id: metric.metric, value: metric.score / 100, weight: 1 });
    summary.push(metric.summary);
  }
  const score = round1(weightedGeometric(components)?.total ?? 0);
  return {
    dimension,
    measured: true,
    score,
    letter: letterFor(score),
    weight,
    tools: uniqueTools([
      ...findingTools.map((run) => run.tool),
      ...metrics.map((metric) => metric.tool),
    ]),
    openFindings,
    summary,
  };
}

function findingsSentence(
  counts: Readonly<Record<FindingSeverity, number>>,
  tools: readonly FindingToolRun[],
): string {
  const names = [...new Set(tools.map((run) => run.tool.name))].join(', ');
  const parts = FINDING_SEVERITIES.filter((severity) => counts[severity] > 0).map(
    (severity) => `${String(counts[severity])} ${severity}`,
  );
  return parts.length === 0
    ? `No open findings from ${names}`
    : `${parts.join(', ')} open from ${names}`;
}

function uniqueTools(tools: readonly HealthTool[]): HealthTool[] {
  const seen = new Map<string, HealthTool>();
  for (const tool of tools) seen.set(`${tool.name}@${tool.version ?? ''}`, tool);
  return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function gateCount(
  id: HealthGateId,
  open: readonly FindingObservation[],
  inputs: HealthInputs,
): number {
  switch (id) {
    case 'open-secret':
      return open.filter((finding) => finding.kind === 'secret').length;
    case 'fixable-critical-vulnerability':
      return open.filter(
        (finding) =>
          finding.kind === 'vulnerability' &&
          finding.severity === 'critical' &&
          finding.fixAvailable === true,
      ).length;
    case 'failing-tests':
      return inputs.failingTests ?? 0;
  }
}

function evaluateGates(open: readonly FindingObservation[], inputs: HealthInputs): HealthGate[] {
  const disabled = new Set(inputs.policy?.disabledGates ?? []);
  return HEALTH_GATES.map((id) => {
    const count = gateCount(id, open, inputs);
    return {
      id,
      tripped: count > 0,
      enabled: !disabled.has(id),
      statement: GATE_STATEMENTS[id](count),
    };
  });
}

function limiterSentence(computed: Computed): string | null {
  const { cappedBy } = computed;
  if (cappedBy === null) return null;
  const gate = computed.gates.find((entry) => entry.id === cappedBy);
  if (gate !== undefined) return `Capped at D — ${gate.statement}`;
  const dimension = computed.dimensions.find((entry) => entry.dimension === cappedBy);
  const label = HEALTH_DIMENSION_LABELS[cappedBy as HealthDimension];
  const reason = dimension?.summary[0];
  return reason === undefined ? `Limited by ${label}` : `Limited by ${label} — ${reason}`;
}

/** Recomputes the grade with a change applied, so every gain is the formula's own answer. */
interface Gains {
  inputs: HealthInputs;
  gain: (changed: HealthInputs) => number;
  closing: (predicate: (finding: FindingObservation) => boolean) => HealthInputs;
}

function gainsOver(inputs: HealthInputs, base: Computed): Gains {
  return {
    inputs,
    gain: (changed) => Math.max(0, round1(compute(changed).effective - base.effective)),
    closing: (predicate) => ({
      ...inputs,
      findings: inputs.findings.map((finding) =>
        finding.state === 'open' && predicate(finding) ? { ...finding, state: 'fixed' } : finding,
      ),
    }),
  };
}

const isSecret = (finding: FindingObservation): boolean => finding.kind === 'secret';
const isFixableCritical = (finding: FindingObservation): boolean =>
  finding.kind === 'vulnerability' &&
  finding.severity === 'critical' &&
  finding.fixAvailable === true;

/** One item per tripped, enabled gate: closing what tripped it. */
function gateItems(gains: Gains, gates: readonly HealthGate[]): FixNext[] {
  const items: FixNext[] = [];
  for (const gate of gates) {
    if (!gate.enabled || !gate.tripped) continue;
    if (gate.id === 'failing-tests') {
      items.push({
        key: 'gate:failing-tests',
        dimension: 'tests',
        title: 'Fix the failing tests on the default branch',
        findings: 0,
        gain: gains.gain({ ...gains.inputs, failingTests: 0 }),
        helpUri: null,
      });
      continue;
    }
    const predicate = gate.id === 'open-secret' ? isSecret : isFixableCritical;
    const closes = gains.inputs.findings.filter(
      (finding) => finding.state === 'open' && predicate(finding),
    );
    items.push({
      key: `gate:${gate.id}`,
      dimension: closes[0]?.dimension ?? 'security',
      title: `Resolve ${gate.statement.charAt(0).toLowerCase()}${gate.statement.slice(1)}`,
      findings: closes.length,
      gain: gains.gain(gains.closing(predicate)),
      helpUri: closes[0]?.helpUri ?? null,
    });
  }
  return items;
}

/** One item per rule, with its open findings grouped, the heaviest groups first. */
function ruleItems(gains: Gains): FixNext[] {
  const groups = new Map<string, FindingObservation[]>();
  for (const finding of gains.inputs.findings) {
    if (finding.state !== 'open') continue;
    const key = `rule:${finding.dimension}:${finding.tool}:${finding.ruleId}`;
    groups.set(key, [...(groups.get(key) ?? []), finding]);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({
      key,
      members,
      penalty: members.reduce((sum, finding) => sum + SEVERITY_PENALTY[finding.severity], 0),
    }))
    .filter((group) => group.penalty > 0)
    .sort((left, right) => right.penalty - left.penalty || left.key.localeCompare(right.key))
    .slice(0, MAX_FIX_CANDIDATES)
    .map((group) => {
      const first = group.members[0] as FindingObservation;
      const places = group.members.length > 1 ? ` (${String(group.members.length)} places)` : '';
      return {
        key: group.key,
        dimension: first.dimension,
        title: `${first.tool}: ${first.ruleId}${places}`,
        findings: group.members.length,
        gain: gains.gain(gains.closing((finding) => group.members.includes(finding))),
        helpUri: first.helpUri,
      };
    });
}

/** One item per metric below the target: raising it to the target. */
function metricItems(gains: Gains): FixNext[] {
  return gains.inputs.metrics
    .filter((metric) => metric.score < METRIC_TARGET)
    .map((metric) => ({
      key: `metric:${metric.dimension}:${metric.metric}`,
      dimension: metric.dimension,
      title: `Raise ${metric.metric} to ${String(METRIC_TARGET)} — now ${metric.summary}`,
      findings: 0,
      gain: gains.gain({
        ...gains.inputs,
        metrics: gains.inputs.metrics.map((entry) =>
          entry === metric ? { ...entry, score: METRIC_TARGET } : entry,
        ),
      }),
      helpUri: null,
    }));
}

/** What closing each candidate is worth, recomputed by `compute` rather than estimated. */
function fixNext(inputs: HealthInputs, base: Computed): FixNext[] {
  const gains = gainsOver(inputs, base);
  return [...gateItems(gains, base.gates), ...ruleItems(gains), ...metricItems(gains)]
    .filter((item) => item.gain > 0)
    .sort((left, right) => right.gain - left.gain || left.key.localeCompare(right.key))
    .slice(0, MAX_FIX_NEXT);
}
export function grade(inputs: HealthInputs): HealthGrade {
  const computed = compute(inputs);
  const incomplete = computed.incompleteReason !== null;
  return {
    score: incomplete ? null : round1(computed.effective),
    letter: incomplete ? null : letterFor(round1(computed.effective)),
    incomplete,
    incompleteReason: computed.incompleteReason,
    cappedBy: incomplete ? null : computed.cappedBy,
    cappingValue:
      incomplete || computed.cappingValue === null ? null : round1(computed.cappingValue),
    limiter: incomplete ? null : limiterSentence(computed),
    dimensions: computed.dimensions,
    gates: computed.gates,
    fixNext: fixNext(inputs, computed),
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
