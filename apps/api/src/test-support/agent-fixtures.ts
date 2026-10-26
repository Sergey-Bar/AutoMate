import * as schema from '@automate/db';
import type { AiGateway, CompletionChunk, CompletionInput } from '@automate/automation';
import type { AutomateEvalRun } from '@automate/shared-contracts';
import type { MigratedDb } from './migrated-database.js';

/** A project in `ws-1` with a health policy, and its id. */
export async function agentProject(
  db: MigratedDb,
  health: Record<string, unknown> = {},
  extra: Partial<typeof schema.projects.$inferInsert> = {},
): Promise<string> {
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId: 'ws-1',
      name: 'Agent service',
      slug: `agents-${String(Math.random()).slice(2, 10)}`,
      defaultBranch: 'main',
      profile: { health },
      ...extra,
    })
    .returning({ id: schema.projects.id });
  return (project as { id: string }).id;
}

/** One attempt in Automate's eval shape. */
export function attempt(epoch: number, passed: boolean | null, score?: number) {
  return {
    epoch,
    passed,
    error: passed === null ? 'provider error' : null,
    scores: score === undefined ? [] : [{ metric: 'faithfulness', score, threshold: 0.5, passed }],
    latencyMs: 100,
    tokensInput: 10,
    tokensOutput: 5,
    costUsd: 0.001,
  };
}

/**
 * An `automate-eval-json` run: `cases` maps a case id to how many of `attempts` pass. The
 * prompt is set so a test can prove it is dropped without `storePrompts`.
 */
export function evalRun(
  suite: string,
  cases: Record<string, number>,
  attempts = 10,
): AutomateEvalRun {
  const rows = Object.entries(cases).map(([caseId, passes]) => ({
    caseId,
    label: caseId,
    promptHash: `hash-${caseId}`,
    prompt: `the prompt for ${caseId}`,
    attempts: Array.from({ length: attempts }, (_, index) => attempt(index + 1, index < passes)),
  }));
  const all = rows.flatMap((row) => row.attempts);
  return {
    tool: { name: 'promptfoo', version: '0.100.0' },
    suite,
    model: 'gpt-4o',
    provider: 'openai',
    configHash: `config-${suite}`,
    cases: rows,
    totals: {
      cases: rows.length,
      attempts: all.length,
      passed: all.filter((row) => row.passed === true).length,
      failed: all.filter((row) => row.passed === false).length,
      errors: 0,
      tokensInput: all.length * 10,
      tokensOutput: all.length * 5,
      costUsd: all.length * 0.001,
      meanLatencyMs: 100,
    },
    truncated: false,
  };
}

export const encode = (value: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(value));

type Attr = { key: string; value: Record<string, unknown> };
const s = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });
const n = (key: string, value: number): Attr => ({ key, value: { intValue: String(value) } });

export interface SpanSpec {
  traceId?: string;
  spanId: string;
  parentSpanId?: string;
  operation: string;
  agent?: string;
  model?: string;
  tool?: string;
  inputTokens?: number;
  outputTokens?: number;
  startMs: number;
  durationMs?: number;
  error?: boolean;
  content?: string;
}

const NS = 1_000_000n;

/** An OTLP/HTTP JSON export: one resource, one scope, the given spans and one HTTP span. */
export function otlpExport(specs: readonly SpanSpec[], withHttpSpan = true) {
  const spans = specs.map((spec) => ({
    traceId: spec.traceId ?? 'a'.repeat(32),
    spanId: spec.spanId,
    parentSpanId: spec.parentSpanId ?? '',
    name: spec.operation,
    kind: 3,
    startTimeUnixNano: (BigInt(spec.startMs) * NS).toString(),
    endTimeUnixNano: (BigInt(spec.startMs + (spec.durationMs ?? 100)) * NS).toString(),
    attributes: [
      s('gen_ai.operation.name', spec.operation),
      s('gen_ai.provider.name', 'openai'),
      ...(spec.agent === undefined ? [] : [s('gen_ai.agent.name', spec.agent)]),
      ...(spec.model === undefined ? [] : [s('gen_ai.request.model', spec.model)]),
      ...(spec.tool === undefined ? [] : [s('gen_ai.tool.name', spec.tool)]),
      ...(spec.inputTokens === undefined ? [] : [n('gen_ai.usage.input_tokens', spec.inputTokens)]),
      ...(spec.outputTokens === undefined
        ? []
        : [n('gen_ai.usage.output_tokens', spec.outputTokens)]),
      ...(spec.content === undefined ? [] : [s('gen_ai.input.messages', spec.content)]),
    ],
    status: { code: spec.error === true ? 2 : 1 },
  }));
  const http = {
    traceId: 'f'.repeat(32),
    spanId: 'f'.repeat(16),
    parentSpanId: '',
    name: 'GET /',
    kind: 3,
    startTimeUnixNano: (BigInt(specs[0]?.startMs ?? 0) * NS).toString(),
    endTimeUnixNano: (BigInt((specs[0]?.startMs ?? 0) + 5) * NS).toString(),
    attributes: [s('http.request.method', 'GET')],
    status: { code: 1 },
  };
  return {
    resourceSpans: [
      {
        resource: { attributes: [s('service.name', 'support-bot')] },
        scopeSpans: [{ scope: { name: 'test' }, spans: withHttpSpan ? [...spans, http] : spans }],
      },
    ],
  };
}

/** A gateway that answers each prompt from `answers`, by the last user message. */
export function stubGateway(
  answers: (input: CompletionInput) => string | Error,
  calls: CompletionInput[] = [],
): AiGateway {
  return {
    listModels: async () => [{ id: 'model-a', gateway: 'stub' }],
    streamCompletion: (input) => ({
      async *[Symbol.asyncIterator]() {
        calls.push(input);
        const answer = answers(input);
        if (answer instanceof Error) throw answer;
        const chunks: CompletionChunk[] = [
          { type: 'text', text: answer },
          { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
          { type: 'done', finishReason: 'stop' },
        ];
        yield* chunks;
      },
    }),
  };
}
