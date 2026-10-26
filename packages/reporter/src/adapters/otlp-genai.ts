import { createHash } from 'node:crypto';

import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';
import { type Json, record } from './json-fields.js';

/**
 * OTLP/HTTP JSON traces → the GenAI spans an agent runtime is judged on.
 *
 * ## Which conventions, pinned
 *
 * The GenAI semantic conventions left the main semantic-conventions repository and now live
 * in `open-telemetry/semantic-conventions-genai`, still at **Development** status, so the
 * attribute names can move. The page this adapter was written against references
 * semantic-conventions **v1.44.0** for its stable attributes (`error.type`), and that is the
 * version pinned here. The older names that instrumentations still emit are read as
 * fallbacks rather than refused — `gen_ai.system` before `gen_ai.provider.name`, the
 * `gen_ai.prompt` / `gen_ai.completion` attributes and their `gen_ai.content.*` span events
 * before `gen_ai.input.messages` / `gen_ai.output.messages` — because a trace store full of
 * last year's spans is still evidence.
 *
 * ## What is kept, and what never is
 *
 * Only spans that say they are GenAI (`gen_ai.operation.name`, or the legacy `gen_ai.system`)
 * are kept; an HTTP span under a chat call is the transport, not the agent. Message content
 * is opt-in twice over: the producer must have recorded it and the caller must ask for it
 * with `storeContent`. When kept it is redacted **before** it is capped, so a secret that
 * straddles the cap cannot survive as an unredacted half. Tool-call arguments are never
 * kept at all, only their sha256: loop detection needs to know two calls had the same
 * arguments, not what the arguments were.
 *
 * ## Refused versus truncated
 *
 * A document that is not OTLP JSON is refused (`malformed`), and so is a GenAI span whose
 * identity or timing cannot be read — a span with no trace id cannot be placed in a run, and
 * guessing would invent one. A batch with more GenAI spans than `maxSpans` is truncated and
 * says so (`truncated`, `dropped.overLimit`): unlike a SARIF scan, where a partial result reads
 * as clean, a partial trace batch only reads as less traffic, and the count says how much less.
 */
export const OTLP_GENAI_ADAPTER_VERSION = '1';

/** The semantic-conventions release the GenAI page referenced when this adapter was written. */
export const GENAI_SEMCONV_VERSION = '1.44.0';
export const GENAI_SEMCONV_URL =
  'https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md';
export const OTLP_JSON_SPEC_URL =
  'https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding';

export const DEFAULT_MAX_GENAI_SPANS = 10_000;
/** Each stored content side is capped at this many UTF-8 bytes, after redaction. */
export const MAX_GENAI_CONTENT_BYTES = 8 * 1024;

/** The well-known `gen_ai.operation.name` values, used to read a legacy span's name. */
const WELL_KNOWN_OPERATIONS = new Set([
  'chat',
  'create_agent',
  'embeddings',
  'execute_tool',
  'generate_content',
  'invoke_agent',
  'invoke_workflow',
  'retrieval',
  'text_completion',
]);

export interface GenAiSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  operation: string;
  provider: string | null;
  requestModel: string | null;
  responseModel: string | null;
  agentName: string | null;
  agentId: string | null;
  toolName: string | null;
  toolCallId: string | null;
  conversationId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReasons: string[];
  /** ISO 8601, millisecond precision. */
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'error' | 'unset';
  errorType: string | null;
  serviceName: string | null;
  /** sha256 (hex) of `gen_ai.tool.call.arguments`; the raw arguments are never kept. */
  toolArgsHash: string | null;
  /** `null` unless `storeContent`; when kept, redacted and capped at 8 KB per side. */
  content: { input: string | null; output: string | null } | null;
}

export interface GenAiParseOptions {
  storeContent: boolean;
  redact: (text: string) => string;
  maxSpans?: number | undefined;
}

export interface GenAiParseResult {
  spans: GenAiSpan[];
  dropped: { notGenAi: number; overLimit: number };
  truncated: boolean;
}

/** An OTLP `AnyValue`, decoded to plain JSON. */
type Plain = string | number | boolean | null | Plain[] | { [key: string]: Plain };

function malformed(message: string): HealthReportError {
  return new HealthReportError('malformed', `OTLP trace export ${message}`);
}

/** An optional array field: absent is empty, present-but-not-an-array is a wrong shape. */
function arrayField(owner: Json, key: string): unknown[] {
  const value = owner[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw malformed(`has a ${key} that is not an array`);
  return value;
}

/** An array whose every element must be an object. */
function objects(owner: Json, key: string): Json[] {
  return arrayField(owner, key).map((item) => {
    const value = record(item);
    if (value === null) throw malformed(`has a ${key} entry that is not an object`);
    return value;
  });
}

function decode(input: Uint8Array): Json {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `OTLP trace export is larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw malformed('is not valid JSON');
  }
  const document = record(parsed);
  if (document === null || !Array.isArray(document['resourceSpans'])) {
    throw malformed('has no resourceSpans array');
  }
  return document;
}

/**
 * proto3 JSON writes int64 as a string, and some exporters write a number. A string is
 * exact; a number past 2^53 already lost its precision on the way in, so it is unreadable
 * rather than silently off by one.
 */
function intOf(value: unknown): number | string | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : undefined;
  if (typeof value !== 'string' || !/^-?\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : value;
}

function plain(value: unknown): Plain | undefined {
  const any = record(value);
  if (any === null) return undefined;
  if (typeof any['stringValue'] === 'string') return any['stringValue'];
  if (typeof any['boolValue'] === 'boolean') return any['boolValue'];
  if ('intValue' in any) return intOf(any['intValue']);
  if (typeof any['doubleValue'] === 'number') return any['doubleValue'];
  if (typeof any['bytesValue'] === 'string') return any['bytesValue'];
  const array = record(any['arrayValue']);
  if (array !== null) {
    return (Array.isArray(array['values']) ? array['values'] : []).map(
      (item) => plain(item) ?? null,
    );
  }
  const kvlist = record(any['kvlistValue']);
  if (kvlist !== null) return Object.fromEntries(keyValues(kvlist['values']));
  return undefined;
}

/** `KeyValue[]` → pairs. An entry with no key, or no value object, carries nothing and is skipped. */
function keyValues(list: unknown): [string, Plain][] {
  const pairs: [string, Plain][] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const entry = record(item);
    if (entry === null || typeof entry['key'] !== 'string') continue;
    if (record(entry['value']) === null) continue;
    pairs.push([entry['key'], plain(entry['value']) ?? null]);
  }
  return pairs;
}

type Attributes = Map<string, Plain>;

function attributesOf(owner: Json | null): Attributes {
  return new Map(keyValues(owner?.['attributes']));
}

function text(attributes: Attributes, key: string): string | null {
  const value = attributes.get(key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** A token count is a non-negative integer, whatever encoding carried it. */
function count(attributes: Attributes, key: string): number | null {
  const value = attributes.get(key);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function strings(attributes: Attributes, key: string): string[] {
  const value = attributes.get(key);
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

/** Content stays as the producer wrote it: a string verbatim, anything structured as JSON. */
function contentText(value: Plain | undefined): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Key-sorted JSON, so the same arguments hash the same whatever order the keys arrived in. */
function canonical(value: Plain): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key] as Plain)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function argsHash(attributes: Attributes): string | null {
  const value = attributes.get('gen_ai.tool.call.arguments');
  if (value === undefined || value === null) return null;
  const source = typeof value === 'string' ? value : canonical(value);
  return createHash('sha256').update(source).digest('hex');
}

/** The UTF-8 prefix of at most `MAX_GENAI_CONTENT_BYTES`, never ending inside a code point. */
function cap(value: string): string {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= MAX_GENAI_CONTENT_BYTES) return value;
  let end = MAX_GENAI_CONTENT_BYTES;
  while (((encoded[end] as number) & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(encoded.subarray(0, end));
}

function eventText(span: Json, eventName: string, key: string): string | null {
  for (const item of Array.isArray(span['events']) ? span['events'] : []) {
    const event = record(item);
    if (event?.['name'] !== eventName) continue;
    const value = contentText(attributesOf(event).get(key));
    if (value !== null) return value;
  }
  return null;
}

function contentOf(
  span: Json,
  attributes: Attributes,
  redact: (value: string) => string,
): { input: string | null; output: string | null } {
  const current = [
    contentText(attributes.get('gen_ai.system_instructions')),
    contentText(attributes.get('gen_ai.input.messages')),
  ].filter((part) => part !== null);
  const input =
    current.length > 0
      ? current.join('\n')
      : (contentText(attributes.get('gen_ai.prompt')) ??
        eventText(span, 'gen_ai.content.prompt', 'gen_ai.prompt'));
  const output =
    contentText(attributes.get('gen_ai.output.messages')) ??
    contentText(attributes.get('gen_ai.tool.call.result')) ??
    contentText(attributes.get('gen_ai.completion')) ??
    eventText(span, 'gen_ai.content.completion', 'gen_ai.completion');
  return {
    input: input === null ? null : cap(redact(input)),
    output: output === null ? null : cap(redact(output)),
  };
}

/** OTLP JSON ids are hex, case-insensitive; base64 (proto3's default for bytes) is refused. */
function hexId(value: unknown, length: number, field: string): string {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^[0-9a-fA-F]{${String(length)}}$`, 'u').test(value)
  ) {
    throw malformed(`has a GenAI span whose ${field} is not ${String(length)} hex characters`);
  }
  return value.toLowerCase();
}

function nanos(value: unknown, field: string): bigint {
  if (typeof value === 'string' && /^\d+$/u.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  throw malformed(`has a GenAI span whose ${field} is not unsigned nanoseconds`);
}

function statusOf(span: Json): GenAiSpan['status'] {
  const code = record(span['status'])?.['code'];
  if (code === 2 || code === 'STATUS_CODE_ERROR') return 'error';
  if (code === 1 || code === 'STATUS_CODE_OK') return 'ok';
  return 'unset';
}

/** A legacy span has no operation name; its span name usually starts with one. */
function legacyOperation(span: Json): string {
  const name = typeof span['name'] === 'string' ? span['name'] : '';
  const first = /^\S+/u.exec(name)?.[0];
  return first !== undefined && WELL_KNOWN_OPERATIONS.has(first) ? first : 'unknown';
}

function readSpan(
  span: Json,
  attributes: Attributes,
  serviceName: string | null,
  options: GenAiParseOptions,
): GenAiSpan {
  const traceId = hexId(span['traceId'], 32, 'traceId');
  const spanId = hexId(span['spanId'], 16, 'spanId');
  const parent = span['parentSpanId'];
  const parentSpanId =
    parent === undefined || parent === '' ? null : hexId(parent, 16, 'parentSpanId');
  const start = nanos(span['startTimeUnixNano'], 'startTimeUnixNano');
  const end = nanos(span['endTimeUnixNano'], 'endTimeUnixNano');
  return {
    traceId,
    spanId,
    parentSpanId,
    operation: text(attributes, 'gen_ai.operation.name') ?? legacyOperation(span),
    provider: text(attributes, 'gen_ai.provider.name') ?? text(attributes, 'gen_ai.system'),
    requestModel: text(attributes, 'gen_ai.request.model'),
    responseModel: text(attributes, 'gen_ai.response.model'),
    agentName: text(attributes, 'gen_ai.agent.name'),
    agentId: text(attributes, 'gen_ai.agent.id'),
    toolName: text(attributes, 'gen_ai.tool.name'),
    toolCallId: text(attributes, 'gen_ai.tool.call.id'),
    conversationId: text(attributes, 'gen_ai.conversation.id'),
    inputTokens: count(attributes, 'gen_ai.usage.input_tokens'),
    outputTokens: count(attributes, 'gen_ai.usage.output_tokens'),
    finishReasons: strings(attributes, 'gen_ai.response.finish_reasons'),
    startedAt: new Date(Number(start / 1_000_000n)).toISOString(),
    // Integer microseconds first, so the division to milliseconds is exact for any sane span.
    durationMs: end > start ? Number((end - start) / 1_000n) / 1_000 : 0,
    status: statusOf(span),
    errorType: text(attributes, 'error.type'),
    serviceName,
    toolArgsHash: argsHash(attributes),
    content: options.storeContent ? contentOf(span, attributes, options.redact) : null,
  };
}

/**
 * Parse one OTLP/HTTP JSON `ExportTraceServiceRequest` into its GenAI spans.
 *
 * Spans keep document order, which is the exporter's batch order; analytics that need time
 * order sort by `startedAt` themselves rather than trusting a batch boundary.
 */
export function parseOtlpGenAi(input: Uint8Array, options: GenAiParseOptions): GenAiParseResult {
  const document = decode(input);
  const collected: Collected = {
    maxSpans: Math.max(0, Math.floor(options.maxSpans ?? DEFAULT_MAX_GENAI_SPANS)),
    spans: [],
    dropped: { notGenAi: 0, overLimit: 0 },
  };
  for (const resourceSpans of objects(document, 'resourceSpans')) {
    const serviceName = text(attributesOf(record(resourceSpans['resource'])), 'service.name');
    for (const scopeSpans of objects(resourceSpans, 'scopeSpans')) {
      for (const span of objects(scopeSpans, 'spans')) {
        collectSpan(collected, span, serviceName, options);
      }
    }
  }
  const { spans, dropped } = collected;
  return { spans, dropped, truncated: dropped.overLimit > 0 };
}

/** The spans kept so far, and the count of each reason a span was not. */
interface Collected {
  maxSpans: number;
  spans: GenAiSpan[];
  dropped: { notGenAi: number; overLimit: number };
}

/** Keep one span, or count why not: it is not a GenAI span, or the limit is reached. */
function collectSpan(
  collected: Collected,
  span: Json,
  serviceName: string | null,
  options: GenAiParseOptions,
): void {
  const attributes = attributesOf(span);
  if (!attributes.has('gen_ai.operation.name') && !attributes.has('gen_ai.system')) {
    collected.dropped.notGenAi += 1;
  } else if (collected.spans.length >= collected.maxSpans) {
    collected.dropped.overLimit += 1;
  } else {
    collected.spans.push(readSpan(span, attributes, serviceName, options));
  }
}
