import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  agentRuntime,
  detectLoops,
  type AgentRuntimeResult,
  type AgentRuntimeSpan,
  type ModelPrice,
} from './agent-runtime.js';

/**
 * Property suite for AGENT-1, AGENT-2 and AGENT-3.
 *
 * Fixed seed and `numRuns`, so a red run reproduces on any host. The generated traces are
 * deliberately awkward: parents that point anywhere (cycles and dangling ids included),
 * invocations nested in invocations, spans outside every invocation, missing token counts,
 * models with no price, and timestamps that tie.
 */
const SEED = 20261102;
const params = { seed: SEED, numRuns: 300 } as const;

const NOW = new Date('2026-10-22T00:00:00.000Z');
const WINDOW_START = NOW.getTime() - 7 * 86_400_000;
const PRICES: ModelPrice[] = [
  { provider: 'openai', model: 'gpt-4o', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
  { provider: null, model: 'small', inputPerMillionUsd: 0.15, outputPerMillionUsd: 0.6 },
];
const options = { prices: PRICES, now: NOW, windowDays: 7 };

const TRACES = ['t0', 't1', 't2', 't3'];

interface Draft {
  traceId: string;
  parent: number | null;
  operation: string;
  agentName: string | null;
  model: string | null;
  toolName: string | null;
  toolArgsHash: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  offsetMs: number;
  durationMs: number;
  status: AgentRuntimeSpan['status'];
}

const tokens = fc.option(fc.integer({ min: 0, max: 200_000 }), { nil: null });
/** Inside the current window, never at its very end, with ties on purpose. */
const offset = fc.integer({ min: 0, max: 6 * 86_400 }).map((seconds) => seconds * 1000);

const draft: fc.Arbitrary<Draft> = fc.record({
  traceId: fc.constantFrom(...TRACES),
  parent: fc.option(fc.integer({ min: 0, max: 30 }), { nil: null }),
  operation: fc.constantFrom('invoke_agent', 'chat', 'execute_tool', 'embeddings'),
  agentName: fc.constantFrom(null, 'A', 'B'),
  model: fc.constantFrom(null, 'gpt-4o', 'small', 'mystery'),
  toolName: fc.constantFrom(null, 'search', 'fetch'),
  toolArgsHash: fc.constantFrom(null, 'h1', 'h2'),
  inputTokens: tokens,
  outputTokens: tokens,
  offsetMs: offset,
  durationMs: fc.integer({ min: 0, max: 60_000 }),
  status: fc.constantFrom('ok', 'error', 'unset'),
});

function materialise(drafts: readonly Draft[], prefix = 's'): AgentRuntimeSpan[] {
  return drafts.map((one, index) => ({
    traceId: one.traceId,
    spanId: `${prefix}${String(index)}`,
    parentSpanId: one.parent === null ? null : `s${String(one.parent)}`,
    operation: one.operation,
    provider: 'openai',
    requestModel: one.model,
    responseModel: null,
    agentName: one.agentName,
    toolName: one.toolName,
    toolArgsHash: one.toolArgsHash,
    inputTokens: one.inputTokens,
    outputTokens: one.outputTokens,
    startedAt: new Date(WINDOW_START + one.offsetMs).toISOString(),
    durationMs: one.durationMs,
    status: one.status,
    errorType: null,
  }));
}

const traces = fc.array(draft, { maxLength: 30 }).map((drafts) => materialise(drafts));

function everyRow(result: AgentRuntimeResult) {
  return [result.overall, ...result.agents, ...result.models];
}

const fixedDraft: Draft = {
  traceId: 't0',
  parent: null,
  operation: 'invoke_agent',
  agentName: 'A',
  model: null,
  toolName: null,
  toolArgsHash: null,
  inputTokens: null,
  outputTokens: null,
  offsetMs: 0,
  durationMs: 1000,
  status: 'ok',
};

describe('AGENT-1: p50 run latency never exceeds p95, for every agent, model and the total', () => {
  it('holds for any set of traces', () => {
    fc.assert(
      fc.property(traces, (spans) => {
        for (const row of everyRow(agentRuntime(spans, options))) {
          const { p50Ms, p95Ms } = row.current.latency;
          expect(p50Ms === null).toBe(p95Ms === null);
          if (p50Ms !== null && p95Ms !== null) expect(p50Ms).toBeLessThanOrEqual(p95Ms);
        }
      }),
      {
        ...params,
        examples: [
          [[]],
          [materialise([fixedDraft])],
          [
            materialise([
              fixedDraft,
              { ...fixedDraft, traceId: 't1', durationMs: 0 },
              { ...fixedDraft, traceId: 't2', durationMs: 60_000 },
            ]),
          ],
        ],
      },
    );
  });
});

describe('AGENT-2: a span with no matching price changes only the unknown count', () => {
  const unpriced = fc.record({
    draft,
    model: fc.constantFrom(null, 'mystery', 'gpt-5-unlisted'),
    traceId: fc.constantFrom(...TRACES, 'fresh'),
  });

  it('holds for any traces and any unpriced span added to them', () => {
    fc.assert(
      fc.property(traces, unpriced, (spans, extra) => {
        const [added] = materialise(
          [{ ...extra.draft, model: extra.model, traceId: extra.traceId }],
          'extra',
        ) as [AgentRuntimeSpan];
        const before = agentRuntime(spans, options).overall.current.cost;
        const after = agentRuntime([...spans, added], options).overall.current.cost;
        const billable =
          added.operation !== 'invoke_agent' &&
          (added.inputTokens !== null || added.outputTokens !== null);
        expect(after.knownUsd).toBe(before.knownUsd);
        expect(after.pricedSpans).toBe(before.pricedSpans);
        expect(after.unknownSpans).toBe(before.unknownSpans + (billable ? 1 : 0));
      }),
      {
        ...params,
        examples: [
          // An unpriced invocation that adopts a trace's spans: they move between runs, the
          // known total does not move at all.
          [
            materialise([
              { ...fixedDraft, operation: 'chat', parent: 0, model: 'gpt-4o', inputTokens: 999 },
            ]),
            {
              draft: { ...fixedDraft, operation: 'invoke_agent', inputTokens: 5 },
              model: 'mystery',
              traceId: 't0',
            },
          ],
          [
            [],
            {
              draft: { ...fixedDraft, operation: 'chat', outputTokens: 1 },
              model: null,
              traceId: 'fresh',
            },
          ],
        ],
      },
    );
  });
});

describe('AGENT-3: every loop is at least `threshold` identical tool calls of one run', () => {
  const threshold = fc.integer({ min: -1, max: 5 });

  it('holds for any traces and threshold', () => {
    fc.assert(
      fc.property(traces, threshold, (spans, limit) => {
        const byId = new Map(spans.map((span) => [`${span.traceId}/${span.spanId}`, span]));
        for (const loop of detectLoops(spans, { threshold: limit })) {
          expect(loop.count).toBeGreaterThanOrEqual(Math.max(2, limit));
          expect(loop.spanIds).toHaveLength(loop.count);
          for (const id of loop.spanIds) {
            const call = byId.get(`${loop.traceId}/${id}`);
            expect(call).toMatchObject({
              operation: 'execute_tool',
              toolName: loop.toolName,
              toolArgsHash: loop.toolArgsHash,
            });
          }
        }
      }),
      {
        ...params,
        examples: [
          [
            materialise([
              fixedDraft,
              ...[1, 2, 3].map((at) => ({
                ...fixedDraft,
                parent: 0,
                operation: 'execute_tool',
                toolName: 'search',
                toolArgsHash: 'h1',
                offsetMs: at,
              })),
            ]),
            3,
          ],
          [[], 0],
        ],
      },
    );
  });

  it('pins the loop examples', () => {
    const call = (index: number, hash: string | null): Draft => ({
      ...fixedDraft,
      parent: 0,
      operation: 'execute_tool',
      toolName: 'search',
      toolArgsHash: hash,
      offsetMs: index,
    });
    const repeated = materialise([fixedDraft, call(1, 'h'), call(2, 'h'), call(3, 'h')]);
    expect(detectLoops(repeated).map((loop) => loop.count)).toEqual([3]);
    const broken = materialise([
      fixedDraft,
      call(1, 'h'),
      call(2, null),
      call(3, 'h'),
      call(4, 'h'),
    ]);
    expect(detectLoops(broken)).toEqual([]);
    expect(detectLoops(broken, { threshold: 2 }).map((loop) => loop.spanIds)).toEqual([
      ['s3', 's4'],
    ]);
  });
});

describe('the property harness can fail', () => {
  it('refutes the wrong claim that adding any span leaves the known cost alone', () => {
    const wrong = fc.check(
      fc.property(traces, draft, (spans, extra) => {
        const [added] = materialise([extra], 'extra') as [AgentRuntimeSpan];
        return (
          agentRuntime([...spans, added], options).overall.current.cost.knownUsd ===
          agentRuntime(spans, options).overall.current.cost.knownUsd
        );
      }),
      {
        ...params,
        examples: [[[], { ...fixedDraft, operation: 'chat', model: 'gpt-4o', inputTokens: 1000 }]],
      },
    );
    expect(wrong.failed).toBe(true);
  });
});
