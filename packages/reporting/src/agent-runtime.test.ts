import { ScorecardSchema } from '@automate/shared-contracts';
import { describe, expect, it } from 'vitest';

import {
  agentRuntime,
  agentRuntimeScorecard,
  costOf,
  detectLoops,
  MIN_AGENT_RUNS,
  type AgentRuntimeSpan,
  type ModelPrice,
} from './agent-runtime.js';

const NOW = new Date('2026-10-22T00:00:00.000Z');
const BASE = Date.parse('2026-10-20T10:00:00.000Z');
const WEEK = 7 * 86_400_000;
const at = (ms: number): string => new Date(BASE + ms).toISOString();

function span(
  fields: Partial<AgentRuntimeSpan> & { traceId: string; spanId: string },
): AgentRuntimeSpan {
  return {
    parentSpanId: null,
    operation: 'chat',
    provider: 'openai',
    requestModel: null,
    responseModel: null,
    agentName: null,
    toolName: null,
    toolArgsHash: null,
    inputTokens: null,
    outputTokens: null,
    startedAt: at(0),
    durationMs: 100,
    status: 'unset',
    errorType: null,
    ...fields,
  };
}

interface RunShape {
  startMs?: number;
  latencyMs?: number;
  failed?: boolean;
  model?: string;
  input?: number;
  output?: number;
  tools?: { name: string; hash?: string | null; failed?: boolean }[];
}

/** One agent invocation: the invoke_agent span, one chat call, and its tool calls in order. */
function run(trace: string, agent: string | null, shape: RunShape = {}): AgentRuntimeSpan[] {
  const start = shape.startMs ?? 0;
  const root = span({
    traceId: trace,
    spanId: `${trace}-a`,
    operation: 'invoke_agent',
    agentName: agent,
    startedAt: at(start),
    durationMs: shape.latencyMs ?? 1000,
    status: shape.failed === true ? 'error' : 'ok',
  });
  const chat = span({
    traceId: trace,
    spanId: `${trace}-c`,
    parentSpanId: root.spanId,
    requestModel: shape.model ?? 'gpt-4o',
    inputTokens: shape.input ?? 1000,
    outputTokens: shape.output ?? 100,
    startedAt: at(start + 1),
  });
  const tools = (shape.tools ?? []).map((tool, index) =>
    span({
      traceId: trace,
      spanId: `${trace}-t${String(index)}`,
      parentSpanId: root.spanId,
      operation: 'execute_tool',
      provider: null,
      toolName: tool.name,
      toolArgsHash: tool.hash === undefined ? 'h1' : tool.hash,
      startedAt: at(start + 2 + index),
      status: tool.failed === true ? 'error' : 'ok',
    }),
  );
  return [root, chat, ...tools];
}

const PRICES: ModelPrice[] = [
  { provider: 'openai', model: 'gpt-4o', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
];

const options = { prices: PRICES, now: NOW, windowDays: 7 };

describe('costOf', () => {
  const chat = span({
    traceId: 't',
    spanId: 's',
    requestModel: 'gpt-4o',
    responseModel: 'gpt-4o-2024-08-06',
    inputTokens: 1_000_000,
    outputTokens: 500_000,
  });

  it('prices the response model first, and an exact provider over a wildcard', () => {
    const prices: ModelPrice[] = [
      { provider: null, model: 'gpt-4o-2024-08-06', inputPerMillionUsd: 9, outputPerMillionUsd: 9 },
      {
        provider: 'openai',
        model: 'gpt-4o-2024-08-06',
        inputPerMillionUsd: 2,
        outputPerMillionUsd: 8,
      },
      { provider: 'openai', model: 'gpt-4o', inputPerMillionUsd: 100, outputPerMillionUsd: 100 },
    ];
    expect(costOf(chat, prices)).toBe(6);
    expect(costOf({ ...chat, provider: 'azure.ai.openai' }, prices)).toBe(13.5);
  });

  it('falls back to the request model and counts a missing side as zero tokens', () => {
    expect(costOf({ ...chat, responseModel: null, outputTokens: null }, PRICES)).toBe(2.5);
    expect(costOf({ ...chat, inputTokens: null }, PRICES)).toBe(5);
  });

  it('is null with no model, no matching price, or only unusable prices', () => {
    expect(costOf({ ...chat, requestModel: null, responseModel: null }, PRICES)).toBeNull();
    expect(costOf(chat, [])).toBeNull();
    expect(costOf({ ...chat, provider: 'anthropic' }, PRICES)).toBeNull();
    const broken: ModelPrice[] = [
      { provider: null, model: 'gpt-4o', inputPerMillionUsd: -1, outputPerMillionUsd: 1 },
      { provider: null, model: 'gpt-4o', inputPerMillionUsd: 1, outputPerMillionUsd: Number.NaN },
    ];
    expect(costOf({ ...chat, responseModel: null }, broken)).toBeNull();
  });
});

describe('detectLoops', () => {
  it('finds a tool called with the same arguments three times running', () => {
    const spans = run('t1', 'Support', {
      tools: [{ name: 'search' }, { name: 'search' }, { name: 'search' }],
    });
    expect(detectLoops(spans)).toEqual([
      {
        traceId: 't1',
        runSpanId: 't1-a',
        agent: 'Support',
        toolName: 'search',
        toolArgsHash: 'h1',
        count: 3,
        spanIds: ['t1-t0', 't1-t1', 't1-t2'],
      },
    ]);
  });

  it('is not fooled by order of arrival: calls are walked by start time', () => {
    const spans = run('t1', 'Support', {
      tools: [{ name: 'search' }, { name: 'search' }, { name: 'search' }],
    }).reverse();
    expect(detectLoops(spans)).toHaveLength(1);
  });

  it('does not count calls with different arguments, or arguments nobody hashed', () => {
    expect(
      detectLoops(
        run('t1', 'A', {
          tools: [{ name: 'search' }, { name: 'search', hash: 'h2' }, { name: 'search' }],
        }),
      ),
    ).toEqual([]);
    expect(
      detectLoops(
        run('t1', 'A', {
          tools: [
            { name: 'search', hash: null },
            { name: 'search', hash: null },
            { name: 'search', hash: null },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('reports each streak once, and two streaks separately', () => {
    const tools = [
      ...Array.from({ length: 4 }, () => ({ name: 'search' })),
      { name: 'fetch' },
      ...Array.from({ length: 3 }, () => ({ name: 'search' })),
    ];
    expect(detectLoops(run('t1', 'A', { tools })).map((loop) => loop.count)).toEqual([4, 3]);
  });

  it('honours a threshold, clamped to at least two', () => {
    const spans = run('t1', 'A', { tools: [{ name: 'search' }, { name: 'search' }] });
    expect(detectLoops(spans, { threshold: 2 })).toHaveLength(1);
    expect(detectLoops(spans, { threshold: 1 })).toHaveLength(1);
    expect(detectLoops(run('t1', 'A', { tools: [{ name: 'search' }] }), { threshold: 1 })).toEqual(
      [],
    );
    expect(detectLoops(spans)).toEqual([]);
  });

  it('keeps invocations apart: two runs of two calls each are not a loop of four', () => {
    const first = run('t1', 'A', { tools: [{ name: 'search' }, { name: 'search' }] });
    const second = run('t1', 'A', {
      startMs: 10,
      tools: [{ name: 'search' }, { name: 'search' }],
    }).map((one) => ({
      ...one,
      spanId: one.spanId.replace('t1-', 't1-second-'),
      parentSpanId: one.parentSpanId === null ? null : 't1-second-a',
    }));
    expect(detectLoops([...first, ...second])).toEqual([]);
  });

  it("attributes a sub-agent's calls to the sub-agent, not its parent", () => {
    const parent = run('t1', 'Planner', { tools: [{ name: 'search' }] });
    const child = span({
      traceId: 't1',
      spanId: 'sub',
      parentSpanId: 't1-a',
      operation: 'invoke_agent',
      agentName: 'Researcher',
      startedAt: at(5),
    });
    const calls = [6, 7].map((offset) =>
      span({
        traceId: 't1',
        spanId: `sub-${String(offset)}`,
        parentSpanId: 'sub',
        operation: 'execute_tool',
        toolName: 'search',
        toolArgsHash: 'h1',
        startedAt: at(offset),
      }),
    );
    const loops = detectLoops([...parent, child, ...calls], { threshold: 2 });
    expect(loops).toEqual([expect.objectContaining({ runSpanId: 'sub', agent: 'Researcher' })]);
  });

  it('treats a trace with no invoke_agent span as one run', () => {
    const calls = [0, 1, 2].map((offset) =>
      span({
        traceId: 'bare',
        spanId: `c${String(offset)}`,
        operation: 'execute_tool',
        toolName: 'lookup',
        toolArgsHash: 'x',
        agentName: offset === 1 ? 'Named' : null,
        startedAt: at(offset),
      }),
    );
    expect(detectLoops(calls)).toEqual([
      expect.objectContaining({ runSpanId: null, agent: 'Named', count: 3 }),
    ]);
  });
});

describe('agentRuntime', () => {
  const support = [
    ...run('s1', 'Support', {
      latencyMs: 1000,
      tools: [{ name: 'lookup_order', failed: true }, { name: 'refund' }],
    }),
    ...run('s2', 'Support', {
      startMs: 100,
      latencyMs: 3000,
      failed: true,
      tools: [
        { name: 'lookup_order', failed: true },
        { name: 'refund', failed: true },
      ],
    }),
    ...run('s3', 'Support', {
      startMs: 200,
      latencyMs: 2000,
      model: 'claude-x',
      tools: [{ name: 'search' }, { name: 'search' }, { name: 'search' }],
    }),
  ];
  const triage = run('r1', 'Triage', { latencyMs: 500, input: 2000, output: 0 });

  it('summarises each agent', () => {
    const result = agentRuntime([...support, ...triage], options);
    expect(result.agents.map((row) => row.key)).toEqual(['Support', 'Triage']);
    const current = result.agents[0]?.current;
    expect(current).toMatchObject({
      runs: 3,
      inputTokens: 3000,
      outputTokens: 300,
      cost: { knownUsd: 0.007, unknownSpans: 1 },
      latency: { p50Ms: 2000, p95Ms: 2900 },
      errors: { failed: 1 },
      toolCalls: { total: 7, failed: 3, topFailingTool: { name: 'lookup_order', failures: 2 } },
      meanTrajectoryLength: 13 / 3,
      loops: 1,
    });
    expect(current?.costPerRunUsd).toBeCloseTo(0.007 / 3, 12);
    expect(current?.tokensPerRun).toBe(1100);
    expect(current?.errors.rate?.estimate).toBeCloseTo(1 / 3, 12);
    expect(current?.toolCalls.rate?.estimate).toBeCloseTo(3 / 7, 12);
    expect(result.loops).toHaveLength(1);
    expect(result.previous).toBe(false);
    expect(result.agents[0]?.previous).toBeNull();
    expect(result.agents[0]?.change).toBeNull();
  });

  it('summarises each model over the runs that used it', () => {
    const result = agentRuntime([...support, ...triage], options);
    expect(result.models.map((row) => row.key)).toEqual(['claude-x', 'gpt-4o']);
    expect(result.models[0]?.current).toMatchObject({
      runs: 1,
      inputTokens: 1000,
      cost: { knownUsd: 0, unknownSpans: 1 },
      costPerRunUsd: 0,
      toolCalls: { total: 3, failed: 0, topFailingTool: null },
      loops: 1,
    });
    expect(result.models[1]?.current).toMatchObject({ runs: 3, inputTokens: 4000 });
    expect(result.overall.key).toBe('all');
    expect(result.overall.current.runs).toBe(4);
  });

  it('names the top failing tool by failures, then by name', () => {
    const tied = run('t', 'A', {
      tools: [
        { name: 'zeta', failed: true },
        { name: 'alpha', failed: true },
      ],
    });
    expect(agentRuntime(tied, options).overall.current.toolCalls.topFailingTool).toEqual({
      name: 'alpha',
      failures: 1,
    });
    const errorTyped = tied.map((one) =>
      one.operation === 'execute_tool'
        ? { ...one, status: 'unset' as const, errorType: 'timeout' }
        : one,
    );
    expect(agentRuntime(errorTyped, options).overall.current.toolCalls.failed).toBe(2);
  });

  it('never counts an invocation span’s rolled-up usage on top of its children', () => {
    const spans = run('t', 'A').map((one) =>
      one.operation === 'invoke_agent'
        ? { ...one, requestModel: 'gpt-4o', inputTokens: 1000, outputTokens: 100 }
        : one,
    );
    expect(agentRuntime(spans, options).overall.current).toMatchObject({
      inputTokens: 1000,
      cost: { knownUsd: 0.0035, unknownSpans: 0 },
    });
  });

  it('treats a trace without an invocation as one run, timed from first start to last end', () => {
    const spans = [
      span({ traceId: 'b', spanId: 'root', startedAt: at(0), durationMs: 50, inputTokens: 10 }),
      span({
        traceId: 'b',
        spanId: 'child',
        parentSpanId: 'root',
        startedAt: at(40),
        durationMs: 200,
        status: 'error',
        operation: 'execute_tool',
        toolName: 'x',
      }),
    ];
    const current = agentRuntime(spans, options).agents[0];
    expect(current?.key).toBe('unattributed');
    expect(current?.current).toMatchObject({
      runs: 1,
      latency: { p50Ms: 240, p95Ms: 240 },
      errors: { failed: 0 },
      toolCalls: { failed: 1 },
      meanTrajectoryLength: 2,
    });
    const failedRoot = spans.map((one) =>
      one.spanId === 'root' ? { ...one, errorType: 'boom' } : one,
    );
    expect(agentRuntime(failedRoot, options).overall.current.errors.failed).toBe(1);
  });

  it('survives a parent cycle and counts every span of a rootless trace as its root', () => {
    const spans = [
      span({ traceId: 'c', spanId: 'x', parentSpanId: 'y', status: 'error' }),
      span({ traceId: 'c', spanId: 'y', parentSpanId: 'x' }),
    ];
    expect(agentRuntime(spans, options).overall.current).toMatchObject({
      runs: 1,
      errors: { failed: 1 },
    });
    const withAgent = [
      span({ traceId: 'd', spanId: 'a', operation: 'invoke_agent', agentName: 'A' }),
      span({ traceId: 'd', spanId: 'x', parentSpanId: 'y', inputTokens: 5 }),
      span({ traceId: 'd', spanId: 'y', parentSpanId: 'x' }),
    ];
    const result = agentRuntime(withAgent, options);
    expect(
      result.agents.map((row) => [row.key, row.current.runs, row.current.inputTokens]),
    ).toEqual([
      ['A', 1, 0],
      ['unattributed', 0, 5],
    ]);
  });

  it('keeps spans outside every invocation as unattributed usage with no run', () => {
    const spans = [
      ...run('t', 'A'),
      span({
        traceId: 't',
        spanId: 'stray',
        requestModel: 'gpt-4o',
        inputTokens: 1_000_000,
        startedAt: at(5),
      }),
    ];
    const stray = agentRuntime(spans, options).agents.find((row) => row.key === 'unattributed');
    expect(stray?.current).toMatchObject({
      runs: 0,
      inputTokens: 1_000_000,
      cost: { knownUsd: 2.5 },
      costPerRunUsd: null,
      tokensPerRun: null,
      latency: { p50Ms: null, p95Ms: null },
      errors: { failed: 0, rate: null },
      toolCalls: { total: 0, rate: null },
      meanTrajectoryLength: null,
    });
  });

  it('keeps whole traces in the window their first span started in', () => {
    const late = run('late', 'A', { startMs: -2 * 86_400_000 + 1 });
    const early = run('old', 'A', { startMs: -6 * 86_400_000 });
    const broken = [span({ traceId: 'bad', spanId: 'b', startedAt: 'not a date' })];
    const future = run('future', 'A', { startMs: 3 * 86_400_000 });
    const result = agentRuntime([...late, ...early, ...broken, ...future], options);
    expect(result.window).toEqual({
      from: '2026-10-15T00:00:00.000Z',
      to: '2026-10-22T00:00:00.000Z',
      days: 7,
    });
    expect(result.overall.current.runs).toBe(1);
    expect(result.outsideWindow).toBe(early.length + broken.length + future.length);
  });

  it('compares with the previous window', () => {
    const previous = [
      ...run('p1', 'Support', { startMs: -WEEK, latencyMs: 500 }),
      ...run('p2', 'Support', { startMs: -WEEK + 1, latencyMs: 700, failed: true }),
      ...run('p3', 'Gone', { startMs: -WEEK + 2 }),
    ];
    const result = agentRuntime(support, { ...options, previous });
    expect(result.previous).toBe(true);
    const row = result.agents.find((one) => one.key === 'Support');
    expect(row?.previous?.runs).toBe(2);
    expect(row?.change?.runs).toBe(1);
    expect(row?.change?.p95LatencyMs).toBeCloseTo(2900 - 690, 9);
    expect(row?.change?.errorRate).toBeCloseTo(1 / 3 - 1 / 2, 12);
    expect(row?.change?.toolFailureRate).toBeNull();
    const gone = result.agents.find((one) => one.key === 'Gone');
    expect(gone?.current.runs).toBe(0);
    expect(gone?.change).toMatchObject({ runs: -1, costPerRunUsd: null, p95LatencyMs: null });
  });

  it('reads the edges: a nameless invocation, output-only usage, an unnamed failing tool', () => {
    const spans = run('t', null, { tools: [{ name: 'x', failed: true }] }).map((one) => {
      if (one.operation === 'execute_tool') return { ...one, toolName: null };
      return one.operation === 'chat' ? { ...one, inputTokens: null, outputTokens: 50 } : one;
    });
    const result = agentRuntime(spans, { ...options, loopThreshold: Number.NaN });
    expect(result.agents.map((row) => row.key)).toEqual(['unattributed']);
    expect(result.overall.current).toMatchObject({
      inputTokens: 0,
      outputTokens: 50,
      toolCalls: { failed: 1, topFailingTool: { name: '(unnamed)', failures: 1 } },
    });
  });

  it('carries a loop in a trace with no invocation onto the model that ran in it', () => {
    const spans = [
      span({ traceId: 'bare', spanId: 'chat', requestModel: 'gpt-4o', inputTokens: 1 }),
      ...[1, 2, 3].map((offset) =>
        span({
          traceId: 'bare',
          spanId: `tool-${String(offset)}`,
          parentSpanId: 'chat',
          operation: 'execute_tool',
          toolName: 'poll',
          toolArgsHash: 'same',
          startedAt: at(offset),
        }),
      ),
    ];
    expect(agentRuntime(spans, options).models[0]?.current.loops).toBe(1);
  });

  it('clamps an unusable window to one day', () => {
    expect(agentRuntime([], { ...options, windowDays: Number.NaN }).window.days).toBe(1);
    expect(agentRuntime([], { ...options, windowDays: 9000 }).window.days).toBe(366);
  });
});

describe('agentRuntimeScorecard', () => {
  const card = { now: NOW, windowDays: 7 };
  const many = (agent: string, count: number, shape: RunShape = {}) =>
    Array.from({ length: count }, (_, index) =>
      run(`${agent}-${String(index)}`, agent, { ...shape, startMs: index }),
    ).flat();

  it('is not configured with no runs', () => {
    const scorecard = agentRuntimeScorecard(agentRuntime([], options), card);
    expect(ScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard).toMatchObject({
      id: 'agent-quality',
      dimension: 'agent-quality',
      status: 'not_configured',
      score: null,
      cappedBy: null,
    });
    expect(scorecard.metrics.every((metric) => metric.status === 'not_configured')).toBe(true);
  });

  it('passes when every budget holds over enough runs', () => {
    const result = agentRuntime(
      many('Support', MIN_AGENT_RUNS, { tools: [{ name: 'a' }] }),
      options,
    );
    const scorecard = agentRuntimeScorecard(result, {
      ...card,
      budgets: {
        maxCostPerRunUsd: 1,
        maxTokensPerRun: 5000,
        maxToolFailureRate: 0.5,
        maxP95LatencyMs: 2000,
        maxErrorRate: 0.5,
      },
    });
    expect(ScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard).toMatchObject({ status: 'pass', score: 100, cappedBy: 'error-rate' });
    expect(scorecard.reasons).toEqual([]);
    expect(scorecard.metrics.map((metric) => [metric.key, metric.status])).toEqual([
      ['error-rate', 'good'],
      ['cost-per-run', 'good'],
      ['tokens-per-run', 'good'],
      ['tool-failure-rate', 'good'],
      ['p95-latency', 'good'],
      ['loops', 'good'],
    ]);
  });

  it('fails on a cost budget with the agent named', () => {
    const result = agentRuntime(
      many('Support agent', MIN_AGENT_RUNS, { input: 100_000, output: 6_000 }),
      options,
    );
    const scorecard = agentRuntimeScorecard(result, {
      ...card,
      budgets: { maxCostPerRunUsd: 0.2 },
    });
    expect(ScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard.status).toBe('fail');
    expect(scorecard.reasons).toEqual(['Support agent: cost per run $0.31 over the $0.20 budget.']);
    expect(scorecard.cappedBy).toBe('cost-per-run');
    expect(scorecard.score).toBeCloseTo((0.2 / 0.31) * 100, 9);
  });

  it('fails on every other budget with a sentence each', () => {
    const spans = [
      ...many('Slow', MIN_AGENT_RUNS, {
        latencyMs: 4200,
        input: 12_000,
        failed: true,
        tools: [{ name: 'a', failed: true }],
      }),
      ...many('Fine', MIN_AGENT_RUNS),
    ];
    const scorecard = agentRuntimeScorecard(agentRuntime(spans, options), {
      ...card,
      budgets: {
        maxTokensPerRun: 10_000,
        maxToolFailureRate: 0.2,
        maxP95LatencyMs: 3000,
        maxErrorRate: 0.2,
        maxCostPerRunUsd: 0,
      },
    });
    expect(ScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard.reasons).toEqual([
      'Fine: cost per run $0.0035 over the $0.00 budget.',
      'Slow: error rate 100.0% over the 20.0% budget (95% interval 72.2–100.0%).',
      'Slow: cost per run $0.031 over the $0.00 budget.',
      'Slow: 12,100 tokens per run over the 10,000 budget.',
      'Slow: tool-call failure rate 100.0% over the 20.0% budget (95% interval 72.2–100.0%).',
      'Slow: p95 latency 4,200 ms over the 3,000 ms budget.',
    ]);
    expect(scorecard.score).toBe(0);
    expect(scorecard.metrics.find((metric) => metric.key === 'error-rate')?.status).toBe('bad');
  });

  it('does not fail a rate whose interval still reaches the budget', () => {
    const spans = [
      ...many('A', MIN_AGENT_RUNS - 7),
      ...many('A', 7, { failed: true }).map((one) => ({ ...one, traceId: `f-${one.traceId}` })),
    ];
    const scorecard = agentRuntimeScorecard(agentRuntime(spans, options), {
      ...card,
      budgets: { maxErrorRate: 0.5 },
    });
    expect(scorecard.status).toBe('pass');
    expect(scorecard.score).toBeCloseTo(30, 9);
    expect(scorecard.cappedBy).toBe('error-rate');
  });

  it('withholds a pass below the minimum number of runs', () => {
    const scorecard = agentRuntimeScorecard(agentRuntime(many('A', 2), options), card);
    expect(ScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard.status).toBe('insufficient');
    expect(scorecard.reasons).toEqual([
      `Only 2 agent runs in the window; at least ${String(MIN_AGENT_RUNS)} are needed to pass.`,
    ]);
    expect(scorecard.metrics.find((metric) => metric.key === 'tool-failure-rate')?.status).toBe(
      'insufficient',
    );
  });

  it('marks cost unmeasured without prices, and a lower bound when some spans are unpriced', () => {
    const unpriced = agentRuntimeScorecard(
      agentRuntime(many('A', MIN_AGENT_RUNS), { ...options, prices: [] }),
      card,
    );
    expect(unpriced.metrics.find((metric) => metric.key === 'cost-per-run')).toMatchObject({
      status: 'not_configured',
      value: null,
    });
    const partial = agentRuntimeScorecard(
      agentRuntime(
        [...many('A', MIN_AGENT_RUNS - 1), ...run('z', 'A', { model: 'other' })],
        options,
      ),
      card,
    );
    const cost = partial.metrics.find((metric) => metric.key === 'cost-per-run');
    expect(cost?.status).toBe('good');
    expect(cost?.summary).toContain('At least');
    expect(cost?.summary).toContain('1 span had no price');
    const twoUnpriced = agentRuntimeScorecard(
      agentRuntime(
        [
          ...many('A', MIN_AGENT_RUNS - 2),
          ...run('y', 'A', { model: 'other' }),
          ...run('z', 'A', { model: 'other' }),
        ],
        options,
      ),
      card,
    );
    expect(twoUnpriced.metrics.find((metric) => metric.key === 'cost-per-run')?.summary).toContain(
      '2 spans had no price',
    );
  });

  it('skips budgets for usage that belongs to no run', () => {
    const spans = [
      ...many('A', MIN_AGENT_RUNS),
      span({
        traceId: 'A-0',
        spanId: 'stray',
        requestModel: 'gpt-4o',
        inputTokens: 10_000_000,
        startedAt: at(1),
      }),
    ];
    const result = agentRuntime(spans, options);
    expect(result.agents.map((row) => [row.key, row.current.runs])).toEqual([
      ['A', MIN_AGENT_RUNS],
      ['unattributed', 0],
    ]);
    const scorecard = agentRuntimeScorecard(result, { ...card, budgets: { maxCostPerRunUsd: 1 } });
    expect(scorecard.reasons).toEqual([]);
    expect(scorecard.status).toBe('pass');
    // The overall number still carries the stray usage, so the score shows the overrun.
    expect(scorecard.cappedBy).toBe('cost-per-run');
  });

  it('reports a producer’s impossible negative latency as written rather than hiding it', () => {
    const scorecard = agentRuntimeScorecard(
      agentRuntime(many('A', 1, { latencyMs: -1500 }), options),
      card,
    );
    expect(scorecard.metrics.find((metric) => metric.key === 'p95-latency')?.summary).toBe(
      'p95 run latency -1,500 ms over 1 runs.',
    );
  });

  it('warns on loops and carries the trend from the previous window', () => {
    const looping = many('A', MIN_AGENT_RUNS, {
      tools: [{ name: 's' }, { name: 's' }, { name: 's' }],
    });
    const previous = many('A', MIN_AGENT_RUNS, { latencyMs: 500 }).map((one) => ({
      ...one,
      startedAt: new Date(Date.parse(one.startedAt) - WEEK).toISOString(),
    }));
    const scorecard = agentRuntimeScorecard(agentRuntime(looping, { ...options, previous }), {
      now: NOW,
      windowDays: 0,
    });
    expect(ScorecardSchema.parse(scorecard)).toEqual(scorecard);
    expect(scorecard.windowDays).toBe(1);
    const loops = scorecard.metrics.find((metric) => metric.key === 'loops');
    expect(loops).toMatchObject({ value: 10, status: 'warn', trend: 10 });
    expect(scorecard.metrics.find((metric) => metric.key === 'p95-latency')?.trend).toBe(500);
    expect(
      scorecard.metrics.find((metric) => metric.key === 'tool-failure-rate')?.trend,
    ).toBeNull();
  });
});
