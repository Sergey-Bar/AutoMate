import { afterEach, describe, expect, it } from 'vitest';
import * as schema from '@automate/db';
import { AgentRuntimeReportSchema } from '@automate/shared-contracts';
import { REDACTED } from '@automate/reporter';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { agentProject, encode, otlpExport, type SpanSpec } from '../test-support/agent-fixtures.js';
import {
  SELF_AGENT_NAME,
  agentRuntimeReading,
  ingestOtlpTraces,
  projectAgentRuntime,
  pruneExpiredSpans,
  recordSelfSpan,
  selfAgentRuntime,
} from './genai-span-service.js';
import { healthGate } from './repo-health-service.js';

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-26T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => NOW.getTime() + offsetMs;

async function setup(agents: Record<string, unknown> = {}) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const projectId = await agentProject(db, { agents });
  let now = NOW;
  const options = { db: db as never, workspaceId: 'ws-1', now: () => now };
  return {
    db,
    projectId,
    options,
    setNow: (next: Date) => {
      now = next;
    },
  };
}

/** One agent run per trace: an `invoke_agent` span with a chat span beneath it. */
function runs(count: number, agent: string, extra: Partial<SpanSpec> = {}): SpanSpec[] {
  return Array.from({ length: count }, (_, index) => {
    const traceId = index.toString(16).padStart(32, '0');
    const start = at(-HOUR - index * 1000);
    return [
      {
        traceId,
        spanId: `${index.toString(16).padStart(12, '0')}aaaa`,
        operation: 'invoke_agent',
        agent,
        startMs: start,
        durationMs: 900,
      },
      {
        traceId,
        spanId: `${index.toString(16).padStart(12, '0')}bbbb`,
        parentSpanId: `${index.toString(16).padStart(12, '0')}aaaa`,
        operation: 'chat',
        agent,
        model: 'gpt-4o',
        inputTokens: 1000,
        outputTokens: 100,
        startMs: start + 10,
        durationMs: 800,
        ...extra,
      },
    ];
  }).flat();
}

const PRICES = [
  { provider: 'openai', model: 'gpt-4o', inputPerMillionUsd: 2.5, outputPerMillionUsd: 10 },
];

describe('OTLP ingestion', () => {
  it('stores the GenAI spans, counts the rest as rejected, and keeps no content by default', async () => {
    const { db, projectId, options } = await setup();
    const result = await ingestOtlpTraces(
      options,
      projectId,
      encode(otlpExport(runs(1, 'planner', { content: 'hello' }))),
    );
    expect(result).toEqual({
      accepted: 2,
      rejectedSpans: 1,
      errorMessage: '1 span(s) carry no gen_ai attributes and are not stored',
    });
    const rows = await db.select().from(schema.genaiSpans);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.source === 'otlp' && row.content === null)).toBe(true);
    expect(rows[0]?.expiresAt.getTime()).toBe(NOW.getTime() + 14 * DAY);
  });

  it('keeps content only under storeTraceContent, redacted', async () => {
    const { db, projectId, options } = await setup({ storeTraceContent: true });
    const token = ['gh', 'p_', 'Z9y8X7w6'.repeat(5)].join('');
    await ingestOtlpTraces(
      options,
      projectId,
      encode(otlpExport(runs(1, 'planner', { content: `use ${token} please` }), false)),
    );
    const chat = (await db.select().from(schema.genaiSpans)).find(
      (row) => row.operation === 'chat',
    );
    expect(JSON.stringify(chat?.content)).toContain(REDACTED);
    expect(JSON.stringify(chat?.content)).not.toContain(token);
  });

  it('stores a span sent twice once, without calling the second a rejection', async () => {
    const { db, projectId, options } = await setup();
    const body = encode(otlpExport(runs(1, 'planner'), false));
    await ingestOtlpTraces(options, projectId, body);
    const again = await ingestOtlpTraces(options, projectId, body);
    expect(again).toEqual({ accepted: 0, rejectedSpans: 0, errorMessage: '' });
    expect(await db.select().from(schema.genaiSpans)).toHaveLength(2);
  });

  it('rejects a span older than the retention window and prunes expired spans', async () => {
    const { db, projectId, options, setNow } = await setup({ traceRetentionDays: 2 });
    const stale = {
      traceId: 'c'.repeat(32),
      spanId: 'c'.repeat(16),
      operation: 'chat',
      startMs: at(-3 * DAY),
    };
    const result = await ingestOtlpTraces(
      options,
      projectId,
      encode(otlpExport([...runs(1, 'planner'), stale], false)),
    );
    expect(result.rejectedSpans).toBe(1);
    expect(result.errorMessage).toContain('retention window');
    const [row] = await db.select().from(schema.genaiSpans);
    expect(row?.expiresAt.getTime()).toBe(NOW.getTime() + 2 * DAY);
    setNow(new Date(NOW.getTime() + 2 * DAY));
    expect(await pruneExpiredSpans(options, new Date(NOW.getTime() + 2 * DAY))).toBe(2);
    expect(await db.select().from(schema.genaiSpans)).toEqual([]);
  });

  it('refuses a body that is not an OTLP JSON export', async () => {
    const { projectId, options } = await setup();
    await expect(ingestOtlpTraces(options, projectId, encode({ spans: [] }))).rejects.toMatchObject(
      {
        code: 'INVALID_REQUEST_BODY',
      },
    );
  });
});

describe('agent runtime', () => {
  it('prices from the policy, budgets per agent, and gates only under gateOnRuntime', async () => {
    for (const gateOnRuntime of [true, false]) {
      const { projectId, options } = await setup({
        prices: PRICES,
        budgets: { maxCostPerRunUsd: 0.001 },
        gateOnRuntime,
      });
      await ingestOtlpTraces(options, projectId, encode(otlpExport(runs(12, 'planner'), false)));
      const report = AgentRuntimeReportSchema.parse(
        await projectAgentRuntime(options, projectId, 7),
      );
      expect(report.runtime.overall.current.runs).toBe(12);
      expect(report.runtime.overall.current.cost.knownUsd).toBeCloseTo(12 * 0.0035, 6);
      expect(report.scorecard.status).toBe('fail');
      expect(report.scorecard.reasons.some((reason) => reason.startsWith('planner'))).toBe(true);
      const reading = await agentRuntimeReading(options, projectId);
      expect(reading.gateOnRuntime).toBe(gateOnRuntime);
      expect(reading.metric?.dimension).toBe('agent-quality');
      const gate = await healthGate(
        { ...options, agentRuntimeReading: (id) => agentRuntimeReading(options, id) },
        projectId,
        'main',
      );
      expect(gate.agentRuntime?.status).toBe('fail');
      const gated = gate.verdict.reasons.some((reason) => reason.startsWith('Agent runtime:'));
      expect(gated).toBe(gateOnRuntime);
    }
  });

  it('reports cost as unknown when no price is configured', async () => {
    const { projectId, options } = await setup();
    await ingestOtlpTraces(options, projectId, encode(otlpExport(runs(2, 'planner'), false)));
    const report = await projectAgentRuntime(options, projectId, 7);
    expect(report.runtime.overall.current.cost).toEqual({
      knownUsd: 0,
      unknownSpans: 2,
      pricedSpans: 0,
    });
    expect(report.truncated).toBe(false);
  });

  it('reads the installation chat spans apart from every project', async () => {
    const { db, projectId, options } = await setup();
    await recordSelfSpan(options, {
      traceId: 'd'.repeat(32),
      spanId: 'd'.repeat(16),
      operation: 'chat',
      provider: 'ollama',
      requestModel: 'llama3',
      responseModel: null,
      inputTokens: 12,
      outputTokens: 3,
      finishReasons: ['stop'],
      startedAt: new Date(at(-HOUR)).toISOString(),
      durationMs: 400,
      status: 'ok',
      errorType: null,
    });
    const [row] = await db.select().from(schema.genaiSpans);
    expect(row).toMatchObject({
      source: 'self',
      projectId: null,
      agentName: SELF_AGENT_NAME,
      content: null,
    });
    const self = AgentRuntimeReportSchema.parse(await selfAgentRuntime(options, 7));
    expect(self.projectId).toBeNull();
    expect(self.runtime.overall.current.runs).toBe(1);
    expect(self.runtime.agents.map((agent) => agent.key)).toEqual([SELF_AGENT_NAME]);
    expect((await projectAgentRuntime(options, projectId, 7)).runtime.overall.current.runs).toBe(0);
  });
});

describe('workspace isolation', () => {
  it('is another workspace\u2019s project, as far as another workspace can tell, not found', async () => {
    const { db, projectId, options } = await setup();
    await ingestOtlpTraces(options, projectId, encode(otlpExport(runs(1, 'planner'), false)));
    await recordSelfSpan(options, {
      traceId: 'e'.repeat(32),
      spanId: 'e'.repeat(16),
      operation: 'chat',
      provider: 'kilo',
      requestModel: 'm',
      responseModel: null,
      inputTokens: null,
      outputTokens: null,
      finishReasons: [],
      startedAt: new Date(at(-HOUR)).toISOString(),
      durationMs: 1,
      status: 'error',
      errorType: 'TypeError',
    });
    const other = { db: db as never, workspaceId: 'ws-2', now: () => NOW };
    const body = encode(otlpExport(runs(1, 'planner'), false));
    await expect(ingestOtlpTraces(other, projectId, body)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(projectAgentRuntime(other, projectId, 7)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect((await selfAgentRuntime(other, 7)).runtime.overall.current.runs).toBe(0);
    expect(await pruneExpiredSpans(other, new Date(NOW.getTime() + 100 * DAY))).toBe(0);
    expect(await db.select().from(schema.genaiSpans)).toHaveLength(3);
  });
});
