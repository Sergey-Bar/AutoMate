import type { Scorecard, ScorecardMetric } from '@automate/shared-contracts';
import { percentile, wilson, type Interval } from './stats.js';

/**
 * What an agent costs and how it behaves at runtime, read from its GenAI spans.
 *
 * ## The input is structural
 *
 * The span shape is stated here rather than imported from `@automate/reporter`, so the
 * analytics depend on the fields they read and not on the adapter that produced them. The
 * OTLP GenAI adapter's spans have this shape; so would any other producer's.
 *
 * ## What a run is
 *
 * A run is one `invoke_agent` span and every span beneath it, down to the next nested
 * `invoke_agent` — a sub-agent's calls are the sub-agent's run, not its parent's. A trace with
 * no `invoke_agent` span at all is one run, because plenty of instrumentations emit the chat
 * and tool spans and never the agent span, and dropping them would make an agent invisible.
 * A span in a trace that has invocations but sits outside all of them is usage with no run: it
 * is counted for `unattributed` tokens and cost, and never as a run of its own.
 *
 * ## Usage is counted where it happens
 *
 * The conventions let an `invoke_agent` span carry `gen_ai.usage.*` too, as a rollup of the
 * calls beneath it, so counting it beside its children would bill a run twice. Rollup spans
 * (`invoke_agent`, `invoke_workflow`) are therefore never billed. The price is that an
 * instrumentation that reports usage *only* on the agent span reads as zero tokens; that is
 * visible, while a double count is not. It is also what keeps AGENT-2 true: each span's cost
 * depends on that span alone.
 *
 * ## Windows keep traces whole
 *
 * A trace belongs to the window its first span started in. Filtering span by span would cut
 * a run that crossed midnight into two half-runs with the wrong latency.
 */

export interface AgentRuntimeSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operation: string;
  provider: string | null;
  requestModel: string | null;
  responseModel: string | null;
  agentName: string | null;
  toolName: string | null;
  toolArgsHash: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** ISO 8601. */
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error' | 'unset';
  errorType: string | null;
}

/**
 * A price the caller supplies. `provider: null` matches any provider.
 *
 * There is deliberately no built-in price table. List prices change without notice, and what a
 * team actually pays depends on its contract, its region, its batch and cache discounts — a
 * table shipped in code would be wrong for most readers on the day it shipped and for everyone
 * a quarter later, and a wrong cost is worse than a missing one because it gets believed.
 */
export interface ModelPrice {
  provider: string | null;
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

export const UNATTRIBUTED_AGENT = 'unattributed';
export const DEFAULT_LOOP_THRESHOLD = 3;
/** Fewer runs than this in the window and a pass is not claimed. */
export const MIN_AGENT_RUNS = 10;

const ROLLUP_OPERATIONS = new Set(['invoke_agent', 'invoke_workflow']);

function usablePrice(price: ModelPrice): boolean {
  return [price.inputPerMillionUsd, price.outputPerMillionUsd].every(
    (value) => Number.isFinite(value) && value >= 0,
  );
}

function priceFor(
  model: string,
  provider: string | null,
  prices: readonly ModelPrice[],
): ModelPrice | null {
  const candidates = prices.filter((price) => price.model === model && usablePrice(price));
  return (
    candidates.find((price) => price.provider !== null && price.provider === provider) ??
    candidates.find((price) => price.provider === null) ??
    null
  );
}

/**
 * The span's cost in USD, or `null` when no supplied price matches.
 *
 * The response model is tried before the request model because it is what actually ran —
 * `gpt-4o` is requested and `gpt-4o-2024-08-06` answers — and a price for the dated snapshot is
 * the more specific one. A missing token count is zero tokens on that side, not an unknown
 * cost: the price is known, the producer only reported one direction.
 */
export function costOf(
  span: Pick<
    AgentRuntimeSpan,
    'provider' | 'requestModel' | 'responseModel' | 'inputTokens' | 'outputTokens'
  >,
  prices: readonly ModelPrice[],
): number | null {
  for (const model of [span.responseModel, span.requestModel]) {
    if (model === null) continue;
    const price = priceFor(model, span.provider, prices);
    if (price === null) continue;
    return (
      ((span.inputTokens ?? 0) * price.inputPerMillionUsd +
        (span.outputTokens ?? 0) * price.outputPerMillionUsd) /
      1_000_000
    );
  }
  return null;
}

interface TimedSpan {
  span: AgentRuntimeSpan;
  startMs: number;
}

interface Run {
  traceId: string;
  /** The `invoke_agent` span, or `null` for a trace that had none. */
  spanId: string | null;
  agent: string;
  /** The run's own spans, in start order. */
  spans: AgentRuntimeSpan[];
  latencyMs: number;
  failed: boolean;
}

interface Assembly {
  runs: Run[];
  /** Spans outside every invocation of a trace that has invocations. */
  loose: AgentRuntimeSpan[];
}

const failed = (span: AgentRuntimeSpan): boolean =>
  span.status === 'error' || span.errorType !== null;

/** Code-unit order, never locale order, so lists read the same on every host. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Start order, then span id, so equal timestamps order the same on every host. */
function byStart(left: TimedSpan, right: TimedSpan): number {
  if (left.startMs !== right.startMs) return left.startMs - right.startMs;
  return compareText(left.span.spanId, right.span.spanId);
}

function timed(spans: readonly AgentRuntimeSpan[]): TimedSpan[] {
  return spans.map((span) => ({ span, startMs: Date.parse(span.startedAt) })).sort(byStart);
}

function groupByTrace(spans: readonly AgentRuntimeSpan[]): Map<string, TimedSpan[]> {
  const traces = new Map<string, TimedSpan[]>();
  for (const entry of timed(spans)) {
    const list = traces.get(entry.span.traceId) ?? [];
    list.push(entry);
    traces.set(entry.span.traceId, list);
  }
  return traces;
}

/** The nearest `invoke_agent` at or above the span; a parent cycle ends the walk. */
function owningInvocation(
  span: AgentRuntimeSpan,
  byId: ReadonlyMap<string, AgentRuntimeSpan>,
): string | null {
  const seen = new Set<string>();
  let current: AgentRuntimeSpan | undefined = span;
  while (current !== undefined && !seen.has(current.spanId)) {
    if (current.operation === 'invoke_agent') return current.spanId;
    seen.add(current.spanId);
    current = current.parentSpanId === null ? undefined : byId.get(current.parentSpanId);
  }
  return null;
}

/** A trace with no invocation is one run, failed when a root span failed. */
function traceRun(traceId: string, entries: readonly TimedSpan[]): Run {
  const spans = entries.map((entry) => entry.span);
  const ids = new Set(spans.map((span) => span.spanId));
  const roots = spans.filter((span) => span.parentSpanId === null || !ids.has(span.parentSpanId));
  const first = entries[0] as TimedSpan;
  const end = Math.max(...entries.map((entry) => entry.startMs + entry.span.durationMs));
  return {
    traceId,
    spanId: null,
    agent: spans.find((span) => span.agentName !== null)?.agentName ?? UNATTRIBUTED_AGENT,
    spans,
    latencyMs: end - first.startMs,
    // A trace whose every span has a parent in the trace is a cycle; all of it is the root.
    failed: (roots.length > 0 ? roots : spans).some(failed),
  };
}

function assemble(spans: readonly AgentRuntimeSpan[]): Assembly {
  const runs: Run[] = [];
  const loose: AgentRuntimeSpan[] = [];
  for (const [traceId, entries] of groupByTrace(spans)) {
    const invocations = entries.filter((entry) => entry.span.operation === 'invoke_agent');
    if (invocations.length === 0) {
      runs.push(traceRun(traceId, entries));
      continue;
    }
    const byId = new Map(entries.map((entry) => [entry.span.spanId, entry.span]));
    const owned = new Map<string, AgentRuntimeSpan[]>();
    for (const { span } of entries) {
      const owner = owningInvocation(span, byId);
      if (owner === null) loose.push(span);
      else owned.set(owner, [...(owned.get(owner) ?? []), span]);
    }
    for (const { span } of invocations) {
      runs.push({
        traceId,
        spanId: span.spanId,
        agent: span.agentName ?? UNATTRIBUTED_AGENT,
        // The invocation always owns itself (`owningInvocation` starts at the span), so the
        // entry exists.
        spans: owned.get(span.spanId) as AgentRuntimeSpan[],
        latencyMs: span.durationMs,
        failed: failed(span),
      });
    }
  }
  return { runs, loose };
}

export interface AgentLoop {
  traceId: string;
  /** The invocation the loop happened in; `null` for a trace with no `invoke_agent` span. */
  runSpanId: string | null;
  agent: string;
  toolName: string;
  toolArgsHash: string;
  count: number;
  spanIds: string[];
}

/**
 * Consecutive identical tool calls in each run.
 *
 * "Identical" needs both the tool name and the argument hash: a call whose arguments nobody
 * hashed ends a streak rather than joining one, because calling `search` three times with three
 * different queries is work, not a loop, and an unknown argument cannot be claimed to repeat.
 */
function loopsIn(run: Run, threshold: number): AgentLoop[] {
  const loops: AgentLoop[] = [];
  let streak: AgentRuntimeSpan[] = [];
  const close = () => {
    const head = streak[0];
    if (head !== undefined && streak.length >= threshold) {
      loops.push({
        traceId: run.traceId,
        runSpanId: run.spanId,
        agent: run.agent,
        toolName: head.toolName as string,
        toolArgsHash: head.toolArgsHash as string,
        count: streak.length,
        spanIds: streak.map((span) => span.spanId),
      });
    }
    streak = [];
  };
  for (const span of run.spans) {
    if (span.operation !== 'execute_tool') continue;
    if (span.toolName === null || span.toolArgsHash === null) {
      close();
      continue;
    }
    const head = streak[0];
    if (
      head !== undefined &&
      (head.toolName !== span.toolName || head.toolArgsHash !== span.toolArgsHash)
    ) {
      close();
    }
    streak.push(span);
  }
  close();
  return loops;
}

function loopThreshold(threshold: number | undefined): number {
  const value = threshold ?? DEFAULT_LOOP_THRESHOLD;
  return Number.isFinite(value) ? Math.max(2, Math.floor(value)) : DEFAULT_LOOP_THRESHOLD;
}

/** Per trace and invocation, tool calls repeated with the same arguments `threshold`+ times running. */
export function detectLoops(
  spans: readonly AgentRuntimeSpan[],
  options: { threshold?: number | undefined } = {},
): AgentLoop[] {
  const threshold = loopThreshold(options.threshold);
  return assemble(spans).runs.flatMap((run) => loopsIn(run, threshold));
}

export interface RuntimeStats {
  runs: number;
  inputTokens: number;
  outputTokens: number;
  /**
   * `knownUsd` sums the billable spans a price matched; `unknownSpans` counts the billable spans
   * none did. Kept apart, never estimated, so a missing price reads as a gap and not a saving.
   */
  cost: { knownUsd: number; unknownSpans: number; pricedSpans: number };
  /** Known cost over runs — a lower bound whenever `unknownSpans` is above zero. */
  costPerRunUsd: number | null;
  tokensPerRun: number | null;
  latency: { p50Ms: number | null; p95Ms: number | null };
  errors: { failed: number; rate: Interval | null };
  toolCalls: {
    total: number;
    failed: number;
    rate: Interval | null;
    topFailingTool: { name: string; failures: number } | null;
  };
  /** Mean spans per run, the run's own spans only. */
  meanTrajectoryLength: number | null;
  loops: number;
}

/** Current minus previous. `null` where either side has no number. */
export interface RuntimeChange {
  runs: number;
  costPerRunUsd: number | null;
  tokensPerRun: number | null;
  p95LatencyMs: number | null;
  errorRate: number | null;
  toolFailureRate: number | null;
}

export interface RuntimeRow {
  key: string;
  current: RuntimeStats;
  /** `null` when no previous window was supplied. */
  previous: RuntimeStats | null;
  change: RuntimeChange | null;
}

export interface AgentRuntimeResult {
  window: { from: string; to: string; days: number };
  /** Whether a previous window was supplied. */
  previous: boolean;
  overall: RuntimeRow;
  /** One row per agent, by name in code-unit order. */
  agents: RuntimeRow[];
  /** One row per model that ran, by name. */
  models: RuntimeRow[];
  loops: AgentLoop[];
  /** Spans dropped because their trace started outside its window, or at no readable time. */
  outsideWindow: number;
}

export interface AgentRuntimeOptions {
  prices: readonly ModelPrice[];
  now: Date;
  windowDays: number;
  /** Spans of the window before this one, for the change. */
  previous?: readonly AgentRuntimeSpan[] | undefined;
  loopThreshold?: number | undefined;
}

/** The set of runs and spans one row's numbers are read from. */
interface Slice {
  runs: readonly Run[];
  /** Spans whose tokens and cost count for the row. */
  usage: readonly AgentRuntimeSpan[];
  /** Spans whose tool calls count for the row. */
  tools: readonly AgentRuntimeSpan[];
  loops: readonly AgentLoop[];
}

const isBillable = (span: AgentRuntimeSpan): boolean =>
  !ROLLUP_OPERATIONS.has(span.operation) &&
  (span.inputTokens !== null || span.outputTokens !== null);

function usageOf(spans: readonly AgentRuntimeSpan[], prices: readonly ModelPrice[]) {
  const usage = { inputTokens: 0, outputTokens: 0, knownUsd: 0, unknownSpans: 0, pricedSpans: 0 };
  for (const span of spans) {
    if (!isBillable(span)) continue;
    usage.inputTokens += span.inputTokens ?? 0;
    usage.outputTokens += span.outputTokens ?? 0;
    const cost = costOf(span, prices);
    if (cost === null) usage.unknownSpans += 1;
    else {
      usage.knownUsd += cost;
      usage.pricedSpans += 1;
    }
  }
  return usage;
}

function toolCallsOf(spans: readonly AgentRuntimeSpan[]): RuntimeStats['toolCalls'] {
  const calls = spans.filter((span) => span.operation === 'execute_tool');
  const failures = new Map<string, number>();
  for (const call of calls.filter(failed)) {
    const name = call.toolName ?? '(unnamed)';
    failures.set(name, (failures.get(name) ?? 0) + 1);
  }
  const [top] = [...failures].sort(([leftName, left], [rightName, right]) =>
    right !== left ? right - left : compareText(leftName, rightName),
  );
  const failedCount = calls.filter(failed).length;
  return {
    total: calls.length,
    failed: failedCount,
    rate: wilson(failedCount, calls.length),
    topFailingTool: top === undefined ? null : { name: top[0], failures: top[1] },
  };
}

function statsOf(slice: Slice, prices: readonly ModelPrice[]): RuntimeStats {
  const runs = slice.runs.length;
  const usage = usageOf(slice.usage, prices);
  const latencies = slice.runs.map((run) => run.latencyMs);
  const failedRuns = slice.runs.filter((run) => run.failed).length;
  const perRun = (total: number) => (runs === 0 ? null : total / runs);
  return {
    runs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cost: {
      knownUsd: usage.knownUsd,
      unknownSpans: usage.unknownSpans,
      pricedSpans: usage.pricedSpans,
    },
    costPerRunUsd: perRun(usage.knownUsd),
    tokensPerRun: perRun(usage.inputTokens + usage.outputTokens),
    latency: { p50Ms: percentile(latencies, 50), p95Ms: percentile(latencies, 95) },
    errors: { failed: failedRuns, rate: wilson(failedRuns, runs) },
    toolCalls: toolCallsOf(slice.tools),
    meanTrajectoryLength: perRun(slice.runs.reduce((sum, run) => sum + run.spans.length, 0)),
    loops: slice.loops.length,
  };
}

const modelOf = (span: AgentRuntimeSpan): string | null => span.responseModel ?? span.requestModel;

interface Analysed {
  assembly: Assembly;
  loops: AgentLoop[];
  /** Every span, in trace then start order, so sums run in one order whatever arrived first. */
  spans: AgentRuntimeSpan[];
}

function analyse(spans: readonly AgentRuntimeSpan[], threshold: number): Analysed {
  const assembly = assemble(spans);
  return {
    assembly,
    loops: assembly.runs.flatMap((run) => loopsIn(run, threshold)),
    spans: timed([...assembly.runs.flatMap((run) => run.spans), ...assembly.loose])
      .sort(
        (left, right) => compareText(left.span.traceId, right.span.traceId) || byStart(left, right),
      )
      .map((entry) => entry.span),
  };
}

function runKey(run: { traceId: string; spanId: string | null }): string {
  return `${run.traceId}\u0000${run.spanId ?? ''}`;
}

function agentSlice(analysed: Analysed, agent: string): Slice {
  const runs = analysed.assembly.runs.filter((run) => run.agent === agent);
  const usage = [
    ...runs.flatMap((run) => run.spans),
    ...(agent === UNATTRIBUTED_AGENT ? analysed.assembly.loose : []),
  ];
  return {
    runs,
    usage,
    tools: usage,
    loops: analysed.loops.filter((loop) => loop.agent === agent),
  };
}

function modelSlice(analysed: Analysed, model: string): Slice {
  const runs = analysed.assembly.runs.filter((run) =>
    run.spans.some((span) => modelOf(span) === model),
  );
  const keys = new Set(runs.map(runKey));
  return {
    runs,
    usage: analysed.spans.filter((span) => modelOf(span) === model),
    tools: runs.flatMap((run) => run.spans),
    loops: analysed.loops.filter((loop) =>
      keys.has(runKey({ traceId: loop.traceId, spanId: loop.runSpanId })),
    ),
  };
}

function difference(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}

function changeOf(current: RuntimeStats, previous: RuntimeStats): RuntimeChange {
  return {
    runs: current.runs - previous.runs,
    costPerRunUsd: difference(current.costPerRunUsd, previous.costPerRunUsd),
    tokensPerRun: difference(current.tokensPerRun, previous.tokensPerRun),
    p95LatencyMs: difference(current.latency.p95Ms, previous.latency.p95Ms),
    errorRate: difference(
      current.errors.rate?.estimate ?? null,
      previous.errors.rate?.estimate ?? null,
    ),
    toolFailureRate: difference(
      current.toolCalls.rate?.estimate ?? null,
      previous.toolCalls.rate?.estimate ?? null,
    ),
  };
}

function rows(
  keys: Iterable<string>,
  current: (key: string) => RuntimeStats,
  previous: ((key: string) => RuntimeStats) | null,
): RuntimeRow[] {
  return [...new Set(keys)].sort().map((key) => {
    const now = current(key);
    const before = previous === null ? null : previous(key);
    return {
      key,
      current: now,
      previous: before,
      change: before === null ? null : changeOf(now, before),
    };
  });
}

function clampDays(days: number): number {
  return Number.isFinite(days) ? Math.min(366, Math.max(1, Math.round(days))) : 1;
}

/** The spans of traces whose first span started in `[from, to]`, and how many were left out. */
function inWindow(
  spans: readonly AgentRuntimeSpan[],
  from: number,
  to: number,
  inclusiveEnd: boolean,
): { kept: AgentRuntimeSpan[]; outside: number } {
  const kept: AgentRuntimeSpan[] = [];
  let outside = 0;
  for (const entries of groupByTrace(spans).values()) {
    const first = Math.min(...entries.map((entry) => entry.startMs));
    const inside = first >= from && (inclusiveEnd ? first <= to : first < to);
    if (inside) kept.push(...entries.map((entry) => entry.span));
    else outside += entries.length;
  }
  return { kept, outside };
}

/** Runtime analytics per agent and per model over one window, against the one before it. */
export function agentRuntime(
  spans: readonly AgentRuntimeSpan[],
  options: AgentRuntimeOptions,
): AgentRuntimeResult {
  const days = clampDays(options.windowDays);
  const to = options.now.getTime();
  const from = to - days * 86_400_000;
  const threshold = loopThreshold(options.loopThreshold);
  const current = inWindow(spans, from, to, true);
  const before =
    options.previous === undefined
      ? null
      : inWindow(options.previous, from - days * 86_400_000, from, false);
  const now = analyse(current.kept, threshold);
  const then = before === null ? null : analyse(before.kept, threshold);
  const { prices } = options;

  const agentKeys = (analysed: Analysed | null) =>
    analysed === null
      ? []
      : [
          ...analysed.assembly.runs.map((run) => run.agent),
          ...(analysed.assembly.loose.length > 0 ? [UNATTRIBUTED_AGENT] : []),
        ];
  const modelKeys = (analysed: Analysed | null) =>
    (analysed?.spans ?? []).flatMap((span) => {
      const model = modelOf(span);
      return model === null ? [] : [model];
    });
  const whole = (analysed: Analysed): Slice => ({
    runs: analysed.assembly.runs,
    usage: analysed.spans,
    tools: analysed.spans,
    loops: analysed.loops,
  });

  return {
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString(), days },
    previous: then !== null,
    overall: rows(
      ['all'],
      () => statsOf(whole(now), prices),
      then === null ? null : () => statsOf(whole(then), prices),
    )[0] as RuntimeRow,
    agents: rows(
      [...agentKeys(now), ...agentKeys(then)],
      (key) => statsOf(agentSlice(now, key), prices),
      then === null ? null : (key) => statsOf(agentSlice(then, key), prices),
    ),
    models: rows(
      [...modelKeys(now), ...modelKeys(then)],
      (key) => statsOf(modelSlice(now, key), prices),
      then === null ? null : (key) => statsOf(modelSlice(then, key), prices),
    ),
    loops: now.loops,
    outsideWindow: current.outside + (before?.outside ?? 0),
  };
}

export interface AgentRuntimeBudgets {
  maxCostPerRunUsd?: number | undefined;
  maxTokensPerRun?: number | undefined;
  /** 0..1. */
  maxToolFailureRate?: number | undefined;
  maxP95LatencyMs?: number | undefined;
  /** 0..1. */
  maxErrorRate?: number | undefined;
}

function usd(value: number): string {
  if (value === 0) return '0.00';
  return value >= 0.1 ? value.toFixed(2) : value.toPrecision(2);
}

/** Thousands separators without the host's locale, so a reason reads the same everywhere. */
function grouped(value: number): string {
  const digits = String(Math.abs(Math.round(value)));
  const groups: string[] = [];
  for (let end = digits.length; end > 0; end -= 3)
    groups.unshift(digits.slice(Math.max(0, end - 3), end));
  return `${value < 0 ? '-' : ''}${groups.join(',')}`;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

/** One budget: how to read it off a row, and the sentence a breach is. */
interface BudgetRule {
  key: string;
  budget: keyof AgentRuntimeBudgets;
  /** The number compared, or `null` when the row did not measure it. */
  read: (stats: RuntimeStats) => number | null;
  /**
   * Whether the row breaches. Rates breach only when the whole Wilson interval is above the
   * budget — one rate against a fixed number, so a one-sample interval; comparing two rates
   * uses Newcombe's difference interval (`compareRates`, `stats.ts`) instead — so seven
   * failures in ten runs is not called over a 50% budget on that evidence alone.
   */
  breaches: (stats: RuntimeStats, budget: number) => boolean;
  sentence: (stats: RuntimeStats, budget: number) => string;
}

const over = (value: number | null, budget: number): boolean => value !== null && value > budget;

function rateRule(
  key: string,
  budget: 'maxErrorRate' | 'maxToolFailureRate',
  label: string,
  rate: (stats: RuntimeStats) => Interval | null,
): BudgetRule {
  return {
    key,
    budget,
    read: (stats) => rate(stats)?.estimate ?? null,
    breaches: (stats, limit) => (rate(stats)?.low ?? 0) > limit,
    sentence: (stats, limit) => {
      const interval = rate(stats) as Interval;
      return `${label} ${pct(interval.estimate)} over the ${pct(limit)} budget (95% interval ${(interval.low * 100).toFixed(1)}–${pct(interval.high)}).`;
    },
  };
}

/** A priced cost: with no span priced the number is not a cost, it is an absence of prices. */
const pricedCost = (stats: RuntimeStats): number | null =>
  stats.cost.pricedSpans === 0 ? null : stats.costPerRunUsd;

const RULES: readonly BudgetRule[] = [
  rateRule('error-rate', 'maxErrorRate', 'error rate', (stats) => stats.errors.rate),
  {
    key: 'cost-per-run',
    budget: 'maxCostPerRunUsd',
    read: pricedCost,
    breaches: (stats, limit) => over(pricedCost(stats), limit),
    sentence: (stats, limit) =>
      `cost per run $${usd(pricedCost(stats) as number)} over the $${usd(limit)} budget.`,
  },
  {
    key: 'tokens-per-run',
    budget: 'maxTokensPerRun',
    read: (stats) => stats.tokensPerRun,
    breaches: (stats, limit) => over(stats.tokensPerRun, limit),
    sentence: (stats, limit) =>
      `${grouped(stats.tokensPerRun as number)} tokens per run over the ${grouped(limit)} budget.`,
  },
  rateRule(
    'tool-failure-rate',
    'maxToolFailureRate',
    'tool-call failure rate',
    (stats) => stats.toolCalls.rate,
  ),
  {
    key: 'p95-latency',
    budget: 'maxP95LatencyMs',
    read: (stats) => stats.latency.p95Ms,
    breaches: (stats, limit) => over(stats.latency.p95Ms, limit),
    sentence: (stats, limit) =>
      `p95 latency ${grouped(stats.latency.p95Ms as number)} ms over the ${grouped(limit)} ms budget.`,
  },
];

function budgetOf(budgets: AgentRuntimeBudgets, key: keyof AgentRuntimeBudgets): number | null {
  const value = budgets[key];
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : null;
}

const METRIC_SHAPES: Record<
  string,
  { label: string; unit: ScorecardMetric['unit']; scale: number }
> = {
  'error-rate': { label: 'Agent run error rate', unit: 'percent', scale: 100 },
  'cost-per-run': { label: 'Cost per agent run', unit: 'usd', scale: 1 },
  'tokens-per-run': { label: 'Tokens per agent run', unit: 'tokens', scale: 1 },
  'tool-failure-rate': { label: 'Tool-call failure rate', unit: 'percent', scale: 100 },
  'p95-latency': { label: 'p95 agent run latency', unit: 'ms', scale: 1 },
};

function unmeasured(
  key: string,
  label: string,
  unit: ScorecardMetric['unit'],
  status: 'insufficient' | 'not_configured',
  summary: string,
): ScorecardMetric {
  return {
    key,
    label,
    value: null,
    unit,
    direction: 'lower-better',
    target: null,
    trend: null,
    sampleSize: null,
    band: null,
    status,
    summary,
  };
}

function sampleOf(rule: BudgetRule, stats: RuntimeStats): number {
  return rule.key === 'tool-failure-rate' ? stats.toolCalls.total : stats.runs;
}

function summaryOf(rule: BudgetRule, stats: RuntimeStats, value: number): string {
  switch (rule.key) {
    case 'error-rate':
      return `${String(stats.errors.failed)} of ${String(stats.runs)} agent runs failed.`;
    case 'cost-per-run':
      return stats.cost.unknownSpans > 0
        ? `At least $${usd(value)} per run; ${String(stats.cost.unknownSpans)} span${stats.cost.unknownSpans === 1 ? '' : 's'} had no price.`
        : `$${usd(value)} per run over ${String(stats.runs)} runs.`;
    case 'tokens-per-run':
      return `${grouped(value)} tokens per run over ${String(stats.runs)} runs.`;
    case 'tool-failure-rate':
      return `${String(stats.toolCalls.failed)} of ${String(stats.toolCalls.total)} tool calls failed.`;
    default:
      return `p95 run latency ${grouped(value)} ms over ${String(stats.runs)} runs.`;
  }
}

function ruleMetric(
  rule: BudgetRule,
  result: AgentRuntimeResult,
  budget: number | null,
  breached: boolean,
): ScorecardMetric {
  const shape = METRIC_SHAPES[rule.key] as (typeof METRIC_SHAPES)[string];
  const stats = result.overall.current;
  const value = rule.read(stats);
  if (stats.runs === 0) {
    return unmeasured(
      rule.key,
      shape.label,
      shape.unit,
      'not_configured',
      'No agent runs in the window.',
    );
  }
  if (value === null) {
    return rule.key === 'cost-per-run'
      ? unmeasured(
          rule.key,
          shape.label,
          shape.unit,
          'not_configured',
          'No supplied price matches a model that ran.',
        )
      : unmeasured(
          rule.key,
          shape.label,
          shape.unit,
          'insufficient',
          'No tool calls in the window.',
        );
  }
  const previous = result.overall.previous === null ? null : rule.read(result.overall.previous);
  return {
    key: rule.key,
    label: shape.label,
    value: value * shape.scale,
    unit: shape.unit,
    direction: 'lower-better',
    target: budget === null ? null : budget * shape.scale,
    trend: previous === null ? null : (value - previous) * shape.scale,
    sampleSize: sampleOf(rule, stats),
    band: null,
    status: breached ? 'bad' : 'good',
    summary: summaryOf(rule, stats, value),
  };
}

function loopsMetric(result: AgentRuntimeResult): ScorecardMetric {
  const stats = result.overall.current;
  if (stats.runs === 0) {
    return unmeasured(
      'loops',
      'Tool-call loops',
      'count',
      'not_configured',
      'No agent runs in the window.',
    );
  }
  const previous = result.overall.previous;
  return {
    key: 'loops',
    label: 'Tool-call loops',
    value: stats.loops,
    unit: 'count',
    direction: 'lower-better',
    target: 0,
    trend: previous === null ? null : stats.loops - previous.loops,
    sampleSize: stats.runs,
    band: null,
    // A loop is a smell worth reading, not a verdict: some agents poll on purpose.
    status: stats.loops === 0 ? 'good' : 'warn',
    summary: `${String(stats.loops)} runs of an identical tool call repeated back to back.`,
  };
}

/** How far within budget a value is, 0–100; 100 while at or under it. */
function budgetScore(value: number, budget: number): number {
  if (value <= budget) return 100;
  return budget === 0 ? 0 : (100 * budget) / value;
}

/** Every per-agent budget breach, as a reason naming the agent, and the rules breached. */
function budgetBreaches(
  result: AgentRuntimeResult,
  budgets: AgentRuntimeBudgets,
): { reasons: string[]; breached: Set<string> } {
  const reasons: string[] = [];
  const breached = new Set<string>();
  for (const row of result.agents) {
    if (row.current.runs === 0) continue;
    for (const rule of RULES) {
      const budget = budgetOf(budgets, rule.budget);
      if (budget === null || !rule.breaches(row.current, budget)) continue;
      breached.add(rule.key);
      reasons.push(`${row.key}: ${rule.sentence(row.current, budget)}`);
    }
  }
  return { reasons, breached };
}

/**
 * The success rate of runs, lowered to the lowest budget component, with the key that set
 * it. `null` with no run.
 */
function runtimeScore(
  overall: RuntimeStats,
  budgets: AgentRuntimeBudgets,
): { score: number | null; cappedBy: string | null } {
  if (overall.runs === 0) return { score: null, cappedBy: null };
  let score = (1 - (overall.errors.rate as Interval).estimate) * 100;
  let cappedBy = 'error-rate';
  for (const rule of RULES) {
    const budget = budgetOf(budgets, rule.budget);
    const value = rule.read(overall);
    if (budget === null || value === null) continue;
    const component = budgetScore(value, budget);
    if (component < score) {
      score = component;
      cappedBy = rule.key;
    }
  }
  return { score, cappedBy };
}

/** The card status. An insufficient sample adds its own reason to `reasons`. */
function runtimeStatus(overall: RuntimeStats, reasons: string[]): Scorecard['status'] {
  if (overall.runs === 0) return 'not_configured';
  if (reasons.length > 0) return 'fail';
  if (overall.runs < MIN_AGENT_RUNS) {
    reasons.push(
      `Only ${String(overall.runs)} agent runs in the window; at least ${String(MIN_AGENT_RUNS)} are needed to pass.`,
    );
    return 'insufficient';
  }
  return 'pass';
}

/**
 * The agent-quality scorecard from runtime analytics.
 *
 * Budgets are checked per agent, because "the fleet averages under budget" is how one expensive
 * agent hides behind three cheap ones; every breach is a reason naming the agent. The score is
 * the success rate of runs, lowered by how far the overall numbers sit over each budget, and
 * `cappedBy` names whichever was lowest. With no run it is `not_configured`; with fewer than
 * `MIN_AGENT_RUNS` and nothing breached it is `insufficient` — a breach fails whatever the
 * sample, because insufficiency withholds a pass and never excuses a failure.
 */
export function agentRuntimeScorecard(
  result: AgentRuntimeResult,
  options: { budgets?: AgentRuntimeBudgets | undefined; now: Date; windowDays: number },
): Scorecard {
  const budgets = options.budgets ?? {};
  const overall = result.overall.current;
  const { reasons, breached } = budgetBreaches(result, budgets);
  const metrics = [
    ...RULES.map((rule) =>
      ruleMetric(rule, result, budgetOf(budgets, rule.budget), breached.has(rule.key)),
    ),
    loopsMetric(result),
  ];

  const { score, cappedBy } = runtimeScore(overall, budgets);
  const status = runtimeStatus(overall, reasons);

  return {
    id: 'agent-quality',
    title: 'Agent quality',
    dimension: 'agent-quality',
    evaluatedAt: options.now.toISOString(),
    windowDays: clampDays(options.windowDays),
    status,
    score: score === null ? null : Math.min(100, Math.max(0, score)),
    cappedBy,
    metrics,
    reasons,
  };
}
