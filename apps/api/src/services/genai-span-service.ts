import { and, desc, eq, gte, isNull, lt, lte } from 'drizzle-orm';
import { genaiSpans, type GenAiSpanRow } from '@automate/db';
import type { CompletionSpan } from '@automate/automation';
import {
  DEFAULT_MAX_GENAI_SPANS,
  HealthReportError,
  parseOtlpGenAi,
  redactSecrets,
  type GenAiSpan,
} from '@automate/reporter';
import {
  agentRuntime,
  agentRuntimeScorecard,
  type AgentRuntimeSpan,
  type ModelPrice,
} from '@automate/reporting';
import {
  DEFAULT_TRACE_RETENTION_DAYS,
  MAX_TRACE_RETENTION_DAYS,
  type AgentRuntimeReport,
  type AgentsPolicy,
  type DimensionMetric,
  type Scorecard,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { INSERT_CHUNK, projectRow } from './health-findings.js';
import { agentsPolicyOf, type EvalOptions } from './eval-service.js';
import type { AgentRuntimeReading } from './repo-health-service.js';

/**
 * GenAI spans: a project's OTLP exporter writes them, the installation's own chat writes them,
 * and the agent-runtime analytics read them.
 *
 * ## Content is not stored by default
 *
 * A span's prompt and completion are kept only when the project's policy says
 * `agents.storeTraceContent`, and then only after the product's one redactor
 * (`redactSecrets`, `@automate/reporter`) and capped at 8 KB per side by the adapter. The
 * installation's own chat spans never keep content: they are recorded by the gateway
 * decorator, which never sees the messages as a span field at all.
 *
 * ## Retention
 *
 * Every span is written with the instant it expires — the project's `traceRetentionDays`
 * (default 14, at most 90) after it was received — and is deleted on the next write to the
 * workspace and by the hourly sweep in `index.ts`, so a project that stops exporting does not
 * keep its last window forever.
 *
 * ## The installation's own spans
 *
 * `source = 'self'` rows belong to no project: chat is an installation feature, not a
 * project's agent. They are still written under the installation's workspace — the only
 * tenancy boundary — and are read by `GET /api/v1/chat/runtime`, never by a project's route.
 */
export type SpanOptions = EvalOptions;

/** The agent name every installation chat span carries. */
export const SELF_AGENT_NAME = 'automate-chat';
/** The most spans one runtime read loads per window; the newest are kept. */
export const RUNTIME_READ_LIMIT = 20_000;
/** The window the grade and the gate read the runtime scorecard over. */
export const RUNTIME_GRADE_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;
const MAX_TEXT = 300;

const clip = (value: string | null): string | null =>
  value === null ? null : value.slice(0, MAX_TEXT);

function retentionDaysOf(policy: AgentsPolicy): number {
  const days = policy.traceRetentionDays ?? DEFAULT_TRACE_RETENTION_DAYS;
  return Math.min(MAX_TRACE_RETENTION_DAYS, Math.max(1, days));
}

/** A count that is a non-negative safe integer, or `null`. */
const tokens = (value: number | null): number | null =>
  value !== null && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
    ? value
    : null;

function rowOf(
  options: SpanOptions,
  projectId: string,
  span: GenAiSpan,
  receivedAt: Date,
  expiresAt: Date,
) {
  return {
    workspaceId: options.workspaceId,
    projectId,
    source: 'otlp' as const,
    traceId: span.traceId.slice(0, 64),
    spanId: span.spanId.slice(0, 32),
    parentSpanId: span.parentSpanId?.slice(0, 32) ?? null,
    operation: span.operation.slice(0, 100),
    provider: clip(span.provider),
    requestModel: clip(span.requestModel),
    responseModel: clip(span.responseModel),
    agentName: clip(span.agentName),
    toolName: clip(span.toolName),
    toolArgsHash: span.toolArgsHash,
    inputTokens: tokens(span.inputTokens),
    outputTokens: tokens(span.outputTokens),
    startedAt: new Date(span.startedAt),
    durationMs: Math.max(0, span.durationMs),
    status: span.status,
    errorType: clip(span.errorType),
    serviceName: clip(span.serviceName),
    content: span.content,
    receivedAt,
    expiresAt,
  };
}

export interface OtlpIngestResult {
  accepted: number;
  rejectedSpans: number;
  /** Empty when every span was stored, else what was not and why — an OTLP warning. */
  errorMessage: string;
}

function rejectionMessage(dropped: { notGenAi: number; overLimit: number; stale: number }): string {
  const parts = [
    dropped.notGenAi > 0
      ? `${String(dropped.notGenAi)} span(s) carry no gen_ai attributes and are not stored`
      : null,
    dropped.overLimit > 0
      ? `${String(dropped.overLimit)} span(s) over the ${String(DEFAULT_MAX_GENAI_SPANS)}-span request limit`
      : null,
    dropped.stale > 0
      ? `${String(dropped.stale)} span(s) started before the project's retention window`
      : null,
  ].filter((part): part is string => part !== null);
  return parts.join('; ');
}

function parseTraces(bytes: Uint8Array, storeContent: boolean) {
  try {
    return parseOtlpGenAi(bytes, {
      storeContent,
      redact: (text) => redactSecrets(text),
      maxSpans: DEFAULT_MAX_GENAI_SPANS,
    });
  } catch (error) {
    if (error instanceof HealthReportError) {
      throw new DomainError(
        error.code === 'too_large' ? ErrorCode.PAYLOAD_TOO_LARGE : ErrorCode.INVALID_REQUEST_BODY,
        error.message,
      );
    }
    throw error;
  }
}

/**
 * One OTLP/HTTP JSON export into a project's spans. Every span not stored is counted as
 * rejected — not a GenAI span, over the request limit, or older than the retention window —
 * so the exporter's `partialSuccess` tells the truth about what this install kept.
 */
export async function ingestOtlpTraces(
  options: SpanOptions,
  projectId: string,
  bytes: Uint8Array,
): Promise<OtlpIngestResult> {
  const now = options.now?.() ?? new Date();
  const project = await projectRow(options, projectId);
  const policy = agentsPolicyOf(project);
  const parsed = parseTraces(bytes, policy.storeTraceContent === true);
  const retentionMs = retentionDaysOf(policy) * DAY_MS;
  const floor = now.getTime() - retentionMs;
  const kept = parsed.spans.filter((span) => Date.parse(span.startedAt) >= floor);
  const expiresAt = new Date(now.getTime() + retentionMs);
  let accepted = 0;
  for (let start = 0; start < kept.length; start += INSERT_CHUNK) {
    const rows = kept
      .slice(start, start + INSERT_CHUNK)
      .map((span) => rowOf(options, project.id, span, now, expiresAt));
    const inserted = await options.db
      .insert(genaiSpans)
      .values(rows)
      .onConflictDoNothing()
      .returning({ id: genaiSpans.id });
    accepted += inserted.length;
  }
  await pruneExpiredSpans(options, now);
  const dropped = { ...parsed.dropped, stale: parsed.spans.length - kept.length };
  // A span sent twice is stored once and is not a rejection: the exporter did nothing wrong.
  return {
    accepted,
    rejectedSpans: dropped.notGenAi + dropped.overLimit + dropped.stale,
    errorMessage: rejectionMessage(dropped),
  };
}

/** Deletes the workspace's spans past their expiry. Returns how many. */
export async function pruneExpiredSpans(options: SpanOptions, now = new Date()): Promise<number> {
  const deleted = await options.db
    .delete(genaiSpans)
    .where(and(eq(genaiSpans.workspaceId, options.workspaceId), lte(genaiSpans.expiresAt, now)))
    .returning({ id: genaiSpans.id });
  return deleted.length;
}

/** The agent name an installation test-proposal completion's span carries. */
export const TEST_PROPOSAL_AGENT_NAME = 'automate-test-proposals';

/**
 * One installation completion, as a `self` span. Never content. `agentName` tells chat
 * (the default) from the other installation callers of the same gateway.
 */
export async function recordSelfSpan(
  options: SpanOptions,
  span: CompletionSpan,
  agentName: string = SELF_AGENT_NAME,
): Promise<void> {
  const now = options.now?.() ?? new Date();
  await options.db
    .insert(genaiSpans)
    .values({
      workspaceId: options.workspaceId,
      projectId: null,
      source: 'self',
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: null,
      operation: span.operation,
      provider: clip(span.provider),
      requestModel: clip(span.requestModel),
      responseModel: clip(span.responseModel),
      agentName: clip(agentName),
      toolName: null,
      toolArgsHash: null,
      inputTokens: tokens(span.inputTokens),
      outputTokens: tokens(span.outputTokens),
      startedAt: new Date(span.startedAt),
      durationMs: span.durationMs,
      status: span.status,
      errorType: clip(span.errorType),
      serviceName: 'automate-api',
      content: null,
      receivedAt: now,
      expiresAt: new Date(now.getTime() + DEFAULT_TRACE_RETENTION_DAYS * DAY_MS),
    })
    .onConflictDoNothing();
}

// ─── Reading ─────────────────────────────────────────────────────────────────

function runtimeSpanOf(row: GenAiSpanRow): AgentRuntimeSpan {
  return {
    traceId: row.traceId,
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    operation: row.operation,
    provider: row.provider,
    requestModel: row.requestModel,
    responseModel: row.responseModel,
    agentName: row.agentName,
    toolName: row.toolName,
    toolArgsHash: row.toolArgsHash,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    startedAt: row.startedAt.toISOString(),
    durationMs: row.durationMs,
    status: row.status as AgentRuntimeSpan['status'],
    errorType: row.errorType,
  };
}

/** The spans of one window, newest first, at most {@link RUNTIME_READ_LIMIT}. */
async function spansBetween(
  options: SpanOptions,
  projectId: string | null,
  from: Date,
  to: Date,
): Promise<GenAiSpanRow[]> {
  return options.db
    .select()
    .from(genaiSpans)
    .where(
      and(
        eq(genaiSpans.workspaceId, options.workspaceId),
        projectId === null ? isNull(genaiSpans.projectId) : eq(genaiSpans.projectId, projectId),
        gte(genaiSpans.startedAt, from),
        lt(genaiSpans.startedAt, to),
      ),
    )
    .orderBy(desc(genaiSpans.startedAt))
    .limit(RUNTIME_READ_LIMIT + 1);
}

interface RuntimeInputs {
  prices: readonly ModelPrice[];
  budgets: AgentsPolicy['budgets'];
}

async function runtimeOf(
  options: SpanOptions,
  projectId: string | null,
  days: number,
  inputs: RuntimeInputs,
): Promise<AgentRuntimeReport> {
  const now = options.now?.() ?? new Date();
  const from = new Date(now.getTime() - days * DAY_MS);
  const current = await spansBetween(options, projectId, from, new Date(now.getTime() + 1));
  const previous = await spansBetween(
    options,
    projectId,
    new Date(from.getTime() - days * DAY_MS),
    from,
  );
  const truncated = current.length > RUNTIME_READ_LIMIT || previous.length > RUNTIME_READ_LIMIT;
  const runtime = agentRuntime(current.slice(0, RUNTIME_READ_LIMIT).map(runtimeSpanOf), {
    prices: inputs.prices,
    now,
    windowDays: days,
    previous: previous.slice(0, RUNTIME_READ_LIMIT).map(runtimeSpanOf),
  });
  return {
    projectId,
    days,
    evaluatedAt: now.toISOString(),
    truncated,
    runtime,
    scorecard: agentRuntimeScorecard(runtime, { budgets: inputs.budgets, now, windowDays: days }),
  };
}

/** `GET /api/v1/projects/:id/agents/runtime?days=`, priced and budgeted by the project's policy. */
export async function projectAgentRuntime(
  options: SpanOptions,
  projectId: string,
  days: number,
): Promise<AgentRuntimeReport> {
  const project = await projectRow(options, projectId);
  const policy = agentsPolicyOf(project);
  return runtimeOf(options, project.id, days, {
    prices: policy.prices ?? [],
    budgets: policy.budgets,
  });
}

/**
 * `GET /api/v1/chat/runtime?days=`: the installation's own chat completions. No price is
 * configured for them anywhere, so their cost is reported as unknown rather than guessed.
 */
export async function selfAgentRuntime(
  options: SpanOptions,
  days: number,
): Promise<AgentRuntimeReport> {
  return runtimeOf(options, null, days, { prices: [], budgets: undefined });
}

function metricOf(card: Scorecard): DimensionMetric | null {
  if (card.score === null) return null;
  return {
    dimension: 'agent-quality',
    metric: 'agent-runtime',
    tool: { name: 'automate-agent-runtime', version: null },
    score: card.score,
    summary: `Agent runtime ${card.score.toFixed(0)} / 100 over ${String(card.windowDays)} days, limited by ${String(card.cappedBy)}`,
  };
}

/** The runtime scorecard as the `agent-quality` dimension's `agent-runtime` metric. */
export async function agentRuntimeReading(
  options: SpanOptions,
  projectId: string,
): Promise<AgentRuntimeReading> {
  const project = await projectRow(options, projectId);
  const report = await projectAgentRuntime(options, project.id, RUNTIME_GRADE_WINDOW_DAYS);
  return {
    metric: metricOf(report.scorecard),
    scorecard: report.scorecard,
    gateOnRuntime: agentsPolicyOf(project).gateOnRuntime === true,
  };
}
