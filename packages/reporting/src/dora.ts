import type { Scorecard, ScorecardMetric } from '@automate/shared-contracts';
import { median } from './stats.js';

/**
 * DORA's software delivery metrics, computed from deployments, changes and incidents.
 *
 * DORA's current model has five metrics: three of throughput (change lead time,
 * deployment frequency, failed deployment recovery time) and two of instability (change
 * fail rate and deployment rework rate). See https://dora.dev/guides/dora-metrics/.
 *
 * Everything here is pure: the clock is the injected `now`, and the same input is the
 * same answer on every host.
 */

export const DORA_TIERS = ['elite', 'high', 'medium', 'low'] as const;
export type DoraTier = (typeof DORA_TIERS)[number];

/** The five metrics, by the name the result carries. */
export type DoraMetricKey =
  'deploymentFrequency' | 'changeLeadTime' | 'changeFailureRate' | 'recoveryTime' | 'reworkRate';

/** The four metrics DORA publishes tiers for. Rework rate has none. */
export type DoraBandedMetricKey = Exclude<DoraMetricKey, 'reworkRate'>;

export interface DoraTierBound {
  readonly tier: DoraTier;
  /** The report's own words for the tier. */
  readonly published: string;
  /** That wording as a number in the metric's unit; see `DORA_BANDS` for the conversion. */
  readonly bound: number;
}

export interface DoraBand {
  readonly unit: 'per-week' | 'hours' | 'ratio';
  readonly direction: 'higher-better' | 'lower-better';
  /** Best tier first. */
  readonly tiers: readonly DoraTierBound[];
}

const WEEK_PER_MONTH = 7 / 30;
const WEEK_PER_SIX_MONTHS = 7 / 182;

/**
 * The performance tiers from the most recent DORA report that publishes them.
 *
 * **The 2025 report did not.** "State of AI-assisted Software Development" (DORA, 2025)
 * replaced the elite/high/medium/low clusters with seven team archetypes that combine
 * delivery with product performance, friction and burnout, and it publishes no
 * per-metric cut-offs. The 2024 Accelerate State of DevOps Report is therefore the latest
 * source of tier bands, and these are its four clusters exactly as published. Rework rate
 * entered DORA's model in 2024 with no tier, so it is reported here with no band rather
 * than with one made up for it.
 *
 * The published wording is kept beside each number. The conversions are the only thing
 * this module adds: a month is 30 days, six months 182 days, a week 168 hours, and
 * deployment frequency is counted per week. Every bound is inclusive.
 *
 * Two oddities are DORA's, and kept rather than smoothed:
 * - The 2024 medium cluster has a *lower* change fail rate (10%) than the high cluster
 *   (20%), and the same recovery time (less than one day). A value is placed in the best
 *   tier whose bound it meets, so a change fail rate or recovery time can never land in
 *   medium: anything within medium's bound is already within high's.
 * - The published ranges have gaps (a recovery of two days is in no 2024 cluster). The
 *   last tier is a floor: a value no better tier admits is `low`.
 */
export const DORA_BANDS = {
  source: 'Accelerate State of DevOps Report 2024 (DORA, Google Cloud)',
  url: 'https://dora.dev/research/2024/dora-report/',
  /** A transcription of the report's cluster table, cited for checking the numbers. */
  transcription: 'https://octopus.com/blog/2024-devops-performance-clusters',
  superseded: {
    source: 'State of AI-assisted Software Development 2025 (DORA, Google Cloud)',
    url: 'https://cloud.google.com/resources/content/2025-dora-ai-assisted-software-development-report',
    note: 'Replaced tier clusters with seven team archetypes and publishes no per-metric bands.',
  },
  deploymentFrequency: {
    unit: 'per-week',
    direction: 'higher-better',
    tiers: [
      { tier: 'elite', published: 'On demand (multiple deploys per day)', bound: 7 },
      { tier: 'high', published: 'Between once per day and once per week', bound: 1 },
      {
        tier: 'medium',
        published: 'Between once per week and once per month',
        bound: WEEK_PER_MONTH,
      },
      {
        tier: 'low',
        published: 'Between once per month and once every six months',
        bound: WEEK_PER_SIX_MONTHS,
      },
    ],
  },
  changeLeadTime: {
    unit: 'hours',
    direction: 'lower-better',
    tiers: [
      { tier: 'elite', published: 'Less than one day', bound: 24 },
      { tier: 'high', published: 'Between one day and one week', bound: 168 },
      { tier: 'medium', published: 'Between one week and one month', bound: 720 },
      { tier: 'low', published: 'Between one month and six months', bound: 4368 },
    ],
  },
  changeFailureRate: {
    unit: 'ratio',
    direction: 'lower-better',
    tiers: [
      { tier: 'elite', published: '5%', bound: 0.05 },
      { tier: 'high', published: '20%', bound: 0.2 },
      { tier: 'medium', published: '10%', bound: 0.1 },
      { tier: 'low', published: '40%', bound: 0.4 },
    ],
  },
  recoveryTime: {
    unit: 'hours',
    direction: 'lower-better',
    tiers: [
      { tier: 'elite', published: 'Less than one hour', bound: 1 },
      { tier: 'high', published: 'Less than one day', bound: 24 },
      { tier: 'medium', published: 'Less than one day', bound: 24 },
      { tier: 'low', published: 'Between one week and one month', bound: 720 },
    ],
  },
  reworkRate: null,
} as const satisfies {
  source: string;
  url: string;
  transcription: string;
  superseded: { source: string; url: string; note: string };
} & Record<DoraBandedMetricKey, DoraBand> & { reworkRate: null };

/**
 * The tier a value falls in: the best tier whose published bound it meets, else `low`.
 *
 * Best-first and monotone on purpose. A rule that picked the nearest cluster would follow
 * the 2024 inversion and call a 20% change fail rate better than a 12% one; this rule
 * never rewards a worse number. `null` for rework rate, which has no tiers.
 */
export function classifyDora(metric: DoraMetricKey, value: number): DoraTier | null {
  if (metric === 'reworkRate') return null;
  const band: DoraBand = DORA_BANDS[metric];
  for (const { tier, bound } of band.tiers) {
    const meets = band.direction === 'higher-better' ? value >= bound : value <= bound;
    if (meets) return tier;
  }
  return 'low';
}

// ─── Inputs ─────────────────────────────────────────────────────────────────

export interface DoraDeployment {
  id: string;
  environment: string;
  status: 'success' | 'failure';
  createdAt: string;
  /** The commit deployed. */
  sha: string | null;
  /**
   * Every commit this deployment carried, when known — the commits between the previous
   * deployment and `sha`. A change counts as deployed by the first successful production
   * deployment whose `sha` or `shas` names it. An explicit list rather than "this sha or
   * any later one" because "later" needs the commit graph, and a pure function given
   * timestamps alone would have to guess it from commit times, which rebases rewrite.
   */
  shas?: readonly string[];
  rollback?: boolean;
  hotfix?: boolean;
  unplanned?: boolean;
}

export interface DoraChange {
  sha: string;
  firstCommitAt: string;
  mergedAt: string | null;
}

export interface DoraIncident {
  id: string;
  openedAt: string;
  resolvedAt: string | null;
  /** The deployment that caused it. Incidents with none are outside DORA's definition. */
  deploymentId: string | null;
}

export interface DoraInput {
  deployments: readonly DoraDeployment[];
  changes: readonly DoraChange[];
  incidents: readonly DoraIncident[];
  /** Matched case-insensitively. */
  productionEnvironments: readonly string[];
  now: Date;
  windowDays: number;
  /** Observations a metric needs before it has a value. Default 5, never below 1. */
  minSample?: number;
}

export interface DoraMetric {
  /** `null` exactly when `status` is `insufficient`. */
  value: number | null;
  sampleSize: number;
  band: DoraTier | null;
  status: 'measured' | 'insufficient';
  /** The same metric over the window before this one, under the same sample floor. */
  previous: number | null;
  previousSampleSize: number;
}

export interface DoraResult {
  windowDays: number;
  minSample: number;
  metrics: Record<DoraMetricKey, DoraMetric>;
}

export const DORA_DEFAULT_MIN_SAMPLE = 5;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

interface Placed {
  deployment: DoraDeployment;
  at: number;
  success: boolean;
  remediation: boolean;
  /** Ships at least one commit no earlier successful production deployment shipped. */
  shipsNew: boolean;
  failed: boolean;
  recoveryHours: number | null;
}

interface Raw {
  successes: number;
  deployments: number;
  failures: number;
  rework: number;
  leadTimes: number[];
  recoveries: number[];
}

const shasOf = (deployment: DoraDeployment): string[] => {
  const all = [...(deployment.shas ?? [])];
  if (deployment.sha !== null) all.push(deployment.sha);
  return all;
};

const byIdOrder = (left: string, right: string) => Number(left > right) - Number(left < right);

/**
 * Linked incidents decide the recovery when there are any: from the earliest opening to
 * the last resolution, and no recovery yet while one is open. Otherwise the deployment
 * has recovered at the next successful production deployment.
 */
function recoveryFor(
  index: number,
  placed: readonly Placed[],
  incidents: readonly DoraIncident[],
): number | null {
  const self = placed[index] as Placed;
  if (incidents.length > 0) {
    const opened = Math.min(...incidents.map((incident) => Date.parse(incident.openedAt)));
    const resolved = incidents.map((incident) =>
      incident.resolvedAt === null ? Number.NaN : Date.parse(incident.resolvedAt),
    );
    if (resolved.some((at) => !Number.isFinite(at))) return null;
    const hours = (Math.max(...resolved) - opened) / HOUR_MS;
    return hours >= 0 ? hours : null;
  }
  const next = placed.slice(index + 1).find((entry) => entry.success);
  return next === undefined ? null : (next.at - self.at) / HOUR_MS;
}

/**
 * Whether an environment is one of the production environments: an exact name, compared
 * case-insensitively, never a pattern. The one rule, used by DORA here and by the API's
 * deployment attribution and incident linking.
 */
export function productionMatcher(
  productionEnvironments: readonly string[],
): (environment: string) => boolean {
  const names = new Set(productionEnvironments.map((name) => name.toLowerCase()));
  return (environment) => names.has(environment.toLowerCase());
}

/**
 * Production deployments in time order, each marked failed or not.
 *
 * A deployment is a change failure when it failed, when an incident names it, or when a
 * rollback or hotfix remediated it. A remediation is attributed to the latest earlier
 * production deployment that shipped a commit no successful deployment had shipped
 * before: a redeploy or an empty deployment ships nothing, so it cannot be what was
 * rolled back. Blaming "the deployment immediately before" instead would let an
 * unrelated no-op deployment between a failure and its hotfix be counted as a second
 * failure — the counterexample pinned in DORA-2.
 */
function place(
  input: Pick<DoraInput, 'deployments' | 'incidents' | 'productionEnvironments'>,
): Placed[] {
  const isProduction = productionMatcher(input.productionEnvironments);
  const sorted = input.deployments
    .filter((deployment) => isProduction(deployment.environment))
    .map((deployment) => ({ deployment, at: Date.parse(deployment.createdAt) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort(
      (left, right) => left.at - right.at || byIdOrder(left.deployment.id, right.deployment.id),
    );

  const linked = new Map<string, DoraIncident[]>();
  for (const incident of input.incidents) {
    if (incident.deploymentId === null || !Number.isFinite(Date.parse(incident.openedAt))) {
      continue;
    }
    linked.set(incident.deploymentId, [...(linked.get(incident.deploymentId) ?? []), incident]);
  }

  const shipped = new Set<string>();
  const placed: Placed[] = sorted.map(({ deployment, at }) => {
    const shas = shasOf(deployment);
    const success = deployment.status === 'success';
    const entry: Placed = {
      deployment,
      at,
      success,
      remediation: deployment.rollback === true || deployment.hotfix === true,
      shipsNew: shas.some((sha) => !shipped.has(sha)),
      failed: !success || linked.has(deployment.id),
      recoveryHours: null,
    };
    if (success) for (const sha of shas) shipped.add(sha);
    return entry;
  });

  placed.forEach((entry, index) => {
    if (!entry.remediation) return;
    const target = placed
      .slice(0, index)
      .reverse()
      .find((earlier) => earlier.shipsNew);
    if (target !== undefined) target.failed = true;
  });

  placed.forEach((entry, index) => {
    if (entry.failed) {
      entry.recoveryHours = recoveryFor(index, placed, linked.get(entry.deployment.id) ?? []);
    }
  });
  return placed;
}

export interface ProductionCarrier {
  deploymentId: string;
  /** DORA's change-failure verdict on that deployment, by the rule {@link place} applies. */
  failed: boolean;
  at: string;
}

/**
 * For each commit, the first production deployment that carried it — successful or not — and
 * whether DORA counts that deployment a change failure. The one definition of "this change
 * caused a failure" outside the DORA metrics themselves, so a per-change outcome and the
 * change-failure rate can never disagree about which deployment failed.
 */
export function firstProductionCarriers(
  input: Pick<DoraInput, 'deployments' | 'incidents' | 'productionEnvironments'>,
): Map<string, ProductionCarrier> {
  const carriers = new Map<string, ProductionCarrier>();
  for (const entry of place(input)) {
    for (const sha of shasOf(entry.deployment)) {
      if (carriers.has(sha)) continue;
      carriers.set(sha, {
        deploymentId: entry.deployment.id,
        failed: entry.failed,
        at: new Date(entry.at).toISOString(),
      });
    }
  }
  return carriers;
}

/** Each change's first successful production deployment time, keyed by sha. */
function firstDeployed(placed: readonly Placed[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const entry of placed) {
    if (!entry.success) continue;
    for (const sha of shasOf(entry.deployment)) if (!first.has(sha)) first.set(sha, entry.at);
  }
  return first;
}

function measure(
  placed: readonly Placed[],
  changes: readonly DoraChange[],
  deployedAt: ReadonlyMap<string, number>,
  start: number,
  end: number,
): Raw {
  const inWindow = (at: number) => at >= start && at < end;
  const window = placed.filter((entry) => inWindow(entry.at));
  const leadTimes: number[] = [];
  for (const change of changes) {
    const at = deployedAt.get(change.sha);
    if (at === undefined || !inWindow(at)) continue;
    const hours = (at - Date.parse(change.firstCommitAt)) / HOUR_MS;
    // NaN (an unparseable commit time) fails this too. A negative lead time is clock skew.
    if (hours >= 0) leadTimes.push(hours);
  }
  return {
    successes: window.filter((entry) => entry.success).length,
    deployments: window.length,
    failures: window.filter((entry) => entry.failed).length,
    rework: window.filter((entry) => entry.remediation || entry.deployment.unplanned === true)
      .length,
    leadTimes,
    recoveries: window.flatMap((entry) =>
      entry.recoveryHours === null ? [] : [entry.recoveryHours],
    ),
  };
}

type Reading = { value: number | null; sampleSize: number };

function readings(raw: Raw, weeks: number): Record<DoraMetricKey, Reading> {
  const rate = (count: number) => (raw.deployments === 0 ? null : count / raw.deployments);
  return {
    deploymentFrequency: { value: raw.successes / weeks, sampleSize: raw.successes },
    changeLeadTime: { value: median(raw.leadTimes), sampleSize: raw.leadTimes.length },
    changeFailureRate: { value: rate(raw.failures), sampleSize: raw.deployments },
    recoveryTime: { value: median(raw.recoveries), sampleSize: raw.recoveries.length },
    reworkRate: { value: rate(raw.rework), sampleSize: raw.deployments },
  };
}

/**
 * The five DORA metrics over `[now - windowDays, now)`, and over the window before it.
 *
 * Medians rather than means for the two durations, because lead and recovery times are
 * long-tailed and one stuck change would otherwise be the number. A metric resting on
 * fewer than `minSample` observations is `insufficient` and has no value and no band
 * (DORA-3): five deployments that all went well are not evidence of an elite team. The
 * floor applies to deployment frequency too, so a stalled pipeline reads as "not enough
 * data", never as a tier.
 */
export function computeDora(input: DoraInput): DoraResult {
  if (!Number.isFinite(input.windowDays) || input.windowDays <= 0) {
    throw new RangeError(`windowDays must be a positive number, got ${input.windowDays}`);
  }
  const minSample = Math.max(1, Math.floor(input.minSample ?? DORA_DEFAULT_MIN_SAMPLE));
  const placed = place(input);
  const deployedAt = firstDeployed(placed);
  const end = input.now.getTime();
  const span = input.windowDays * DAY_MS;
  const weeks = input.windowDays / 7;
  const current = readings(measure(placed, input.changes, deployedAt, end - span, end), weeks);
  const previous = readings(
    measure(placed, input.changes, deployedAt, end - 2 * span, end - span),
    weeks,
  );

  const gate = (reading: Reading) => (reading.sampleSize >= minSample ? reading.value : null);
  const metric = (key: DoraMetricKey): DoraMetric => {
    const value = gate(current[key]);
    return {
      value,
      sampleSize: current[key].sampleSize,
      band: value === null ? null : classifyDora(key, value),
      status: value === null ? 'insufficient' : 'measured',
      previous: gate(previous[key]),
      previousSampleSize: previous[key].sampleSize,
    };
  };

  return {
    windowDays: input.windowDays,
    minSample,
    metrics: {
      deploymentFrequency: metric('deploymentFrequency'),
      changeLeadTime: metric('changeLeadTime'),
      changeFailureRate: metric('changeFailureRate'),
      recoveryTime: metric('recoveryTime'),
      reworkRate: metric('reworkRate'),
    },
  };
}

// ─── Scorecard ──────────────────────────────────────────────────────────────

export interface DoraPolicy {
  /** As a ratio, 0–1. */
  maxChangeFailureRate?: number;
  maxLeadTimeHours?: number;
  minDeploysPerWeek?: number;
  maxRecoveryHours?: number;
}

/**
 * Points per tier, for the score only. These are this module's scale, not DORA's: DORA
 * publishes tiers, not scores. Evenly spaced so each tier step costs the same, and never
 * zero so the geometric mean stays defined while still letting a `low` drag the whole
 * card down.
 */
export const DORA_TIER_POINTS: Readonly<Record<DoraTier, number>> = {
  elite: 100,
  high: 75,
  medium: 50,
  low: 25,
};

interface MetricSpec {
  field: DoraMetricKey;
  key: string;
  label: string;
  unit: ScorecardMetric['unit'];
  direction: ScorecardMetric['direction'];
  limit: (policy: DoraPolicy) => { kind: 'max' | 'min'; value: number } | null;
  format: (value: number) => string;
}

const hours = (value: number) => `${round(value, 1)} h`;
const percent = (value: number) => `${round(value * 100, 1)}%`;
const perWeek = (value: number) => `${round(value, 2)} per week`;
const round = (value: number, digits: number) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
const optionalLimit = (kind: 'max' | 'min', value: number | undefined) =>
  value === undefined ? null : { kind, value };

const SPECS: readonly MetricSpec[] = [
  {
    field: 'deploymentFrequency',
    key: 'deployment-frequency',
    label: 'Deployment frequency',
    unit: 'per-week',
    direction: 'higher-better',
    limit: (policy) => optionalLimit('min', policy.minDeploysPerWeek),
    format: perWeek,
  },
  {
    field: 'changeLeadTime',
    key: 'change-lead-time',
    label: 'Change lead time (median)',
    unit: 'hours',
    direction: 'lower-better',
    limit: (policy) => optionalLimit('max', policy.maxLeadTimeHours),
    format: hours,
  },
  {
    field: 'changeFailureRate',
    key: 'change-failure-rate',
    label: 'Change failure rate',
    unit: 'ratio',
    direction: 'lower-better',
    limit: (policy) => optionalLimit('max', policy.maxChangeFailureRate),
    format: percent,
  },
  {
    field: 'recoveryTime',
    key: 'failed-deployment-recovery-time',
    label: 'Failed deployment recovery time (median)',
    unit: 'hours',
    direction: 'lower-better',
    limit: (policy) => optionalLimit('max', policy.maxRecoveryHours),
    format: hours,
  },
  {
    field: 'reworkRate',
    key: 'rework-rate',
    label: 'Deployment rework rate',
    unit: 'ratio',
    direction: 'lower-better',
    limit: () => null,
    format: percent,
  },
];

const TIER_STATUS: Readonly<Record<DoraTier, ScorecardMetric['status']>> = {
  elite: 'good',
  high: 'good',
  medium: 'warn',
  low: 'bad',
};

type PolicyLimit = ReturnType<MetricSpec['limit']>;

/** The reason a measured value breaks its policy limit, or `null` when it does not. */
function limitViolation(spec: MetricSpec, value: number, limit: PolicyLimit): string | null {
  if (limit === null) return null;
  const violated = limit.kind === 'max' ? value > limit.value : value < limit.value;
  if (!violated) return null;
  const side = limit.kind === 'max' ? 'above the policy maximum' : 'below the policy minimum';
  return `${spec.label} is ${spec.format(value)}, ${side} of ${spec.format(limit.value)}.`;
}

/** The tier's status; without a tier, a warning only when the value rose. */
function bandStatus(band: DoraTier | null, trend: number | null): ScorecardMetric['status'] {
  if (band !== null) return TIER_STATUS[band];
  return trend !== null && trend > 0 ? 'warn' : 'good';
}

/**
 * The delivery scorecard.
 *
 * The score is the geometric mean of the tier points of every banded metric that has a
 * value, so one `low` cannot be averaged away by three `elite`s, and `cappedBy` names the
 * worst of them. Rework rate is shown and trended but not scored: it has no published
 * tier, and a score built on a band nobody published would be ours dressed as DORA's.
 * Without a tier, rework is a warning only when it rose against the previous window.
 *
 * A policy limit is checked only against a measured value — an unmeasured metric has no
 * number to exceed — and every exceeded limit is one reason and fails the card. A card on
 * which no banded metric is measured is `insufficient`, with no score.
 */
export function doraScorecard(
  result: DoraResult,
  options: { now: Date; windowDays: number; policy?: DoraPolicy },
): Scorecard {
  const policy = options.policy ?? {};
  const reasons: string[] = [];
  const scored: { key: string; points: number }[] = [];

  const metrics: ScorecardMetric[] = SPECS.map((spec) => {
    const reading = result.metrics[spec.field];
    const limit = spec.limit(policy);
    const base = {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      direction: spec.direction,
      target: limit === null ? null : limit.value,
      sampleSize: reading.sampleSize,
      band: reading.band,
    };
    if (reading.value === null) {
      return {
        ...base,
        value: null,
        trend: null,
        status: 'insufficient',
        summary: `${reading.sampleSize} of the ${result.minSample} observations needed.`,
      };
    }
    const value = reading.value;
    const trend = reading.previous === null ? null : value - reading.previous;
    const violation = limitViolation(spec, value, limit);
    if (violation !== null) reasons.push(violation);
    if (reading.band !== null)
      scored.push({ key: spec.key, points: DORA_TIER_POINTS[reading.band] });
    const tier = reading.band === null ? 'no published tier' : `${reading.band} (DORA 2024)`;
    return {
      ...base,
      value,
      trend,
      status: violation !== null ? 'bad' : bandStatus(reading.band, trend),
      summary: `${spec.format(value)} over ${reading.sampleSize} observations — ${tier}.`,
    };
  });

  const evaluatedAt = options.now.toISOString();
  const common = {
    id: 'delivery' as const,
    title: 'Software delivery (DORA)',
    dimension: 'delivery' as const,
    evaluatedAt,
    windowDays: options.windowDays,
    metrics,
  };
  if (scored.length === 0) {
    return { ...common, status: 'insufficient', score: null, cappedBy: null, reasons: [] };
  }
  const logMean = scored.reduce((sum, entry) => sum + Math.log(entry.points), 0) / scored.length;
  const worst = scored.reduce((low, entry) => (entry.points < low.points ? entry : low));
  return {
    ...common,
    status: reasons.length > 0 ? 'fail' : 'pass',
    score: round(Math.exp(logMean), 1),
    cappedBy: worst.key,
    reasons,
  };
}
