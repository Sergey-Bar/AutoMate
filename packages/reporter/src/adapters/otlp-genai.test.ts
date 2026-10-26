import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_GENAI_SPANS,
  GENAI_SEMCONV_URL,
  GENAI_SEMCONV_VERSION,
  MAX_GENAI_CONTENT_BYTES,
  parseOtlpGenAi,
  type GenAiParseOptions,
} from './otlp-genai.js';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES } from './sarif.js';

const TRACE = '5b8efff798038103d269b633813fc60c';
const AGENT = 'eee19b7ec3c1b174';
const CHAT = 'eee19b7ec3c1b175';
const TOOL = 'eee19b7ec3c1b176';
const HTTP = 'eee19b7ec3c1b177';

/** 2026-10-02T10:00:00.000Z in nanoseconds — past 2^53, so only BigInt reads it exactly. */
const T0 = 1_790_935_200_000_000_000n;
const ns = (offsetMs: number): string => (T0 + BigInt(offsetMs) * 1_000_000n).toString();

type Attr = { key: string; value: Record<string, unknown> };
const s = (key: string, value: string): Attr => ({ key, value: { stringValue: value } });
const i = (key: string, value: number | string): Attr => ({ key, value: { intValue: value } });

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

const keep = (text: string): string => text;
const defaults: GenAiParseOptions = { storeContent: false, redact: keep };

/**
 * A realistic export: one agent invocation parenting a chat call and a tool call, and an
 * HTTP client span from the same process that is not GenAI at all. Shaped the way the
 * OpenTelemetry JS exporter writes OTLP/HTTP JSON: hex ids, nanosecond strings, `intValue`
 * as a string (proto3 JSON's int64 encoding), `status.code` as an integer.
 */
function fixture(overrides: { chatAttributes?: Attr[]; toolAttributes?: Attr[] } = {}) {
  return {
    resourceSpans: [
      {
        resource: { attributes: [s('service.name', 'support-bot')] },
        scopeSpans: [
          {
            scope: { name: 'openinference', version: '1.0.0' },
            spans: [
              {
                traceId: TRACE,
                spanId: AGENT,
                parentSpanId: '',
                name: 'invoke_agent Support',
                kind: 1,
                startTimeUnixNano: ns(0),
                endTimeUnixNano: ns(2500),
                attributes: [
                  s('gen_ai.operation.name', 'invoke_agent'),
                  s('gen_ai.provider.name', 'openai'),
                  s('gen_ai.agent.name', 'Support'),
                  s('gen_ai.agent.id', 'asst_5j66UpCpwteGg4YSxUnt7lPY'),
                  s('gen_ai.conversation.id', 'conv_5j66UpCpwteGg4YSxUnt7lPY'),
                ],
                status: { code: 1 },
              },
              {
                traceId: TRACE,
                spanId: CHAT,
                parentSpanId: AGENT,
                name: 'chat gpt-4o',
                kind: 3,
                startTimeUnixNano: ns(10),
                endTimeUnixNano: ns(1210),
                attributes: [
                  s('gen_ai.operation.name', 'chat'),
                  s('gen_ai.provider.name', 'openai'),
                  s('gen_ai.request.model', 'gpt-4o'),
                  s('gen_ai.response.model', 'gpt-4o-2024-08-06'),
                  i('gen_ai.usage.input_tokens', '1200'),
                  i('gen_ai.usage.output_tokens', 85),
                  {
                    key: 'gen_ai.response.finish_reasons',
                    value: { arrayValue: { values: [{ stringValue: 'tool_calls' }] } },
                  },
                  s('gen_ai.system_instructions', 'You are a support agent.'),
                  s('gen_ai.input.messages', '[{"role":"user","content":"my key is sk-123"}]'),
                  {
                    key: 'gen_ai.output.messages',
                    value: {
                      arrayValue: {
                        values: [
                          {
                            kvlistValue: {
                              values: [
                                { key: 'role', value: { stringValue: 'assistant' } },
                                { key: 'finish_reason', value: { stringValue: 'tool_calls' } },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                  ...(overrides.chatAttributes ?? []),
                ],
                status: {},
              },
              {
                traceId: TRACE,
                spanId: TOOL,
                parentSpanId: AGENT,
                name: 'execute_tool lookup_order',
                kind: 1,
                startTimeUnixNano: ns(1220),
                endTimeUnixNano: ns(1420),
                attributes: [
                  s('gen_ai.operation.name', 'execute_tool'),
                  s('gen_ai.tool.name', 'lookup_order'),
                  s('gen_ai.tool.call.id', 'call_mszuSIzqtI65i1wAUOE8w5H4'),
                  s('gen_ai.tool.call.arguments', '{"order":"A-17"}'),
                  s('error.type', 'timeout'),
                  ...(overrides.toolAttributes ?? []),
                ],
                status: { code: 'STATUS_CODE_ERROR', message: 'deadline exceeded' },
              },
            ],
          },
          {
            scope: { name: '@opentelemetry/instrumentation-http' },
            spans: [
              {
                traceId: TRACE,
                spanId: HTTP,
                parentSpanId: CHAT,
                name: 'POST',
                startTimeUnixNano: ns(20),
                endTimeUnixNano: ns(1200),
                attributes: [s('http.request.method', 'POST')],
              },
            ],
          },
        ],
      },
    ],
  };
}

function refusal(run: () => unknown): HealthReportError {
  try {
    run();
  } catch (error) {
    if (error instanceof HealthReportError) return error;
    throw error;
  }
  throw new Error('expected a HealthReportError');
}

describe('parseOtlpGenAi reads an agent trace', () => {
  it('pins the semantic-conventions version it was written against', () => {
    expect(GENAI_SEMCONV_VERSION).toBe('1.44.0');
    expect(GENAI_SEMCONV_URL).toMatch(/^https:\/\/github\.com\/open-telemetry\//u);
  });

  it('keeps the agent, chat and tool spans and drops the HTTP span', () => {
    const result = parseOtlpGenAi(bytes(fixture()), defaults);
    expect(result.dropped).toEqual({ notGenAi: 1, overLimit: 0 });
    expect(result.truncated).toBe(false);
    expect(result.spans.map((span) => span.operation)).toEqual([
      'invoke_agent',
      'chat',
      'execute_tool',
    ]);
  });

  it('reads the invocation and its children with their parentage', () => {
    const [agent, chat, tool] = parseOtlpGenAi(bytes(fixture()), defaults).spans;
    expect(agent).toEqual({
      traceId: TRACE,
      spanId: AGENT,
      parentSpanId: null,
      operation: 'invoke_agent',
      provider: 'openai',
      requestModel: null,
      responseModel: null,
      agentName: 'Support',
      agentId: 'asst_5j66UpCpwteGg4YSxUnt7lPY',
      toolName: null,
      toolCallId: null,
      conversationId: 'conv_5j66UpCpwteGg4YSxUnt7lPY',
      inputTokens: null,
      outputTokens: null,
      finishReasons: [],
      startedAt: '2026-10-02T10:00:00.000Z',
      durationMs: 2500,
      status: 'ok',
      errorType: null,
      serviceName: 'support-bot',
      toolArgsHash: null,
      content: null,
    });
    expect(chat).toMatchObject({
      parentSpanId: AGENT,
      requestModel: 'gpt-4o',
      responseModel: 'gpt-4o-2024-08-06',
      inputTokens: 1200,
      outputTokens: 85,
      finishReasons: ['tool_calls'],
      startedAt: '2026-10-02T10:00:00.010Z',
      durationMs: 1200,
      status: 'unset',
    });
    expect(tool).toMatchObject({
      parentSpanId: AGENT,
      toolName: 'lookup_order',
      toolCallId: 'call_mszuSIzqtI65i1wAUOE8w5H4',
      status: 'error',
      errorType: 'timeout',
      durationMs: 200,
    });
  });

  it('hashes tool arguments and never keeps them', () => {
    const result = parseOtlpGenAi(bytes(fixture()), { storeContent: true, redact: keep });
    const tool = result.spans[2];
    expect(tool?.toolArgsHash).toBe(createHash('sha256').update('{"order":"A-17"}').digest('hex'));
    expect(JSON.stringify(result)).not.toContain('A-17');
  });

  it('hashes structured arguments by content, whatever order the keys arrived in', () => {
    const structured = (values: Attr[]) =>
      parseOtlpGenAi(
        bytes(
          fixture({
            toolAttributes: [
              { key: 'gen_ai.tool.call.arguments', value: { kvlistValue: { values } } },
            ],
          }),
        ),
        defaults,
      ).spans[2]?.toolArgsHash;
    const forward = structured([s('a', '1'), i('b', 2)]);
    expect(forward).toBe(structured([i('b', 2), s('a', '1')]));
    expect(forward).toBe(createHash('sha256').update('{"a":"1","b":2}').digest('hex'));
  });

  it('drops content by default', () => {
    const result = parseOtlpGenAi(bytes(fixture()), defaults);
    expect(result.spans.every((span) => span.content === null)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sk-123');
  });

  it('passes stored content through redact', () => {
    const redact = (text: string) => text.replaceAll(/sk-\d+/gu, '[REDACTED]');
    const chat = parseOtlpGenAi(bytes(fixture()), { storeContent: true, redact }).spans[1];
    expect(chat?.content).toEqual({
      input: 'You are a support agent.\n[{"role":"user","content":"my key is [REDACTED]"}]',
      output: '[{"role":"assistant","finish_reason":"tool_calls"}]',
    });
  });

  it('keeps an empty content record for a span that carried none', () => {
    const agent = parseOtlpGenAi(bytes(fixture()), { storeContent: true, redact: keep }).spans[0];
    expect(agent?.content).toEqual({ input: null, output: null });
  });

  it('caps each stored side at 8 KB after redaction, on a code-point boundary', () => {
    const long = `${'é'.repeat(MAX_GENAI_CONTENT_BYTES)}`;
    const chat = parseOtlpGenAi(
      bytes(
        fixture({
          chatAttributes: [s('gen_ai.input.messages', long), s('gen_ai.output.messages', 'short')],
        }),
      ),
      // One odd byte ahead of the two-byte run puts the 8 KB line inside a code point.
      { storeContent: true, redact: (text) => text.replace('You are', 'SECRETS') },
    ).spans[1];
    const input = chat?.content?.input ?? '';
    expect(new TextEncoder().encode(input).byteLength).toBe(MAX_GENAI_CONTENT_BYTES - 1);
    expect(input.startsWith('SECRETS a support agent.')).toBe(true);
    expect(input).not.toContain('\uFFFD');
    expect(chat?.content?.output).toBe('short');
  });
});

describe('legacy and edge encodings', () => {
  const single = (span: Record<string, unknown>, resource: unknown = undefined) => ({
    resourceSpans: [
      {
        ...(resource === undefined ? {} : { resource }),
        scopeSpans: [
          {
            spans: [
              {
                traceId: TRACE.toUpperCase(),
                spanId: CHAT,
                startTimeUnixNano: ns(0),
                endTimeUnixNano: ns(5),
                ...span,
              },
            ],
          },
        ],
      },
    ],
  });

  it('accepts a legacy gen_ai.system span and its prompt/completion events', () => {
    const [span] = parseOtlpGenAi(
      bytes(
        single({
          name: 'chat gpt-3.5',
          attributes: [s('gen_ai.system', 'openai'), i('gen_ai.usage.input_tokens', 7)],
          events: [
            { name: 'gen_ai.content.prompt', attributes: [s('gen_ai.prompt', 'hello')] },
            { name: 'gen_ai.content.completion', attributes: [s('gen_ai.completion', 'hi')] },
            { name: 'unrelated' },
            'not an event',
          ],
        }),
      ),
      { storeContent: true, redact: keep },
    ).spans;
    expect(span).toMatchObject({
      traceId: TRACE,
      operation: 'chat',
      provider: 'openai',
      inputTokens: 7,
      serviceName: null,
      content: { input: 'hello', output: 'hi' },
    });
  });

  it('reads legacy prompt and completion attributes, and a tool result as output', () => {
    const [legacy] = parseOtlpGenAi(
      bytes(
        single({
          name: 'completion',
          attributes: [
            s('gen_ai.system', 'cohere'),
            s('gen_ai.prompt', 'p'),
            s('gen_ai.completion', 'c'),
          ],
        }),
      ),
      { storeContent: true, redact: keep },
    ).spans;
    expect(legacy).toMatchObject({ operation: 'unknown', content: { input: 'p', output: 'c' } });
    const [tool] = parseOtlpGenAi(
      bytes(
        single({
          attributes: [
            s('gen_ai.operation.name', 'execute_tool'),
            { key: 'gen_ai.tool.call.result', value: { intValue: 3 } },
          ],
        }),
      ),
      { storeContent: true, redact: keep },
    ).spans;
    expect(tool?.content).toEqual({ input: null, output: '3' });
    const [nameless] = parseOtlpGenAi(
      bytes(single({ attributes: [s('gen_ai.system', 'openai')] })),
      defaults,
    ).spans;
    expect(nameless?.operation).toBe('unknown');
  });

  it('skips a content event that carries no text and reads the next one', () => {
    const [span] = parseOtlpGenAi(
      bytes(
        single({
          name: '',
          attributes: [s('gen_ai.system', 'openai')],
          events: [
            { name: 'gen_ai.content.prompt' },
            { name: 'gen_ai.content.prompt', attributes: [s('gen_ai.prompt', 'second')] },
          ],
        }),
      ),
      { storeContent: true, redact: keep },
    ).spans;
    expect(span).toMatchObject({
      operation: 'unknown',
      content: { input: 'second', output: null },
    });
  });

  it('hashes array arguments canonically and keeps an int64 past 2^53 exact as text', () => {
    const [span] = parseOtlpGenAi(
      bytes(
        single({
          attributes: [
            s('gen_ai.operation.name', 'execute_tool'),
            {
              key: 'gen_ai.tool.call.arguments',
              value: {
                arrayValue: {
                  values: [{ kvlistValue: { values: [i('z', 1), s('a', 'x')] } }, 7],
                },
              },
            },
            { key: 'gen_ai.tool.call.result', value: { intValue: '9007199254740993' } },
          ],
        }),
      ),
      { storeContent: true, redact: keep },
    ).spans;
    expect(span?.toolArgsHash).toBe(
      createHash('sha256').update('[{"a":"x","z":1},null]').digest('hex'),
    );
    expect(span?.content?.output).toBe('9007199254740993');
  });

  it('reads every AnyValue variant and ignores the unreadable ones', () => {
    const [span] = parseOtlpGenAi(
      bytes(
        single(
          {
            attributes: [
              s('gen_ai.operation.name', 'chat'),
              { key: 'gen_ai.usage.input_tokens', value: { doubleValue: 12 } },
              { key: 'gen_ai.usage.output_tokens', value: { intValue: '-4' } },
              { key: 'gen_ai.response.finish_reasons', value: { stringValue: 'stop' } },
              { key: 'gen_ai.request.model', value: { boolValue: true } },
              { key: 'gen_ai.response.model', value: { stringValue: '' } },
              {
                key: 'gen_ai.input.messages',
                value: {
                  arrayValue: {
                    values: [
                      { boolValue: false },
                      { doubleValue: 1.5 },
                      { bytesValue: 'AAE=' },
                      { mystery: 1 },
                      { intValue: 'not a number' },
                      { kvlistValue: { values: [null, { key: 'k' }, { key: 'v', value: {} }] } },
                      { arrayValue: {} },
                      { kvlistValue: {} },
                    ],
                  },
                },
              },
              { key: 'gen_ai.output.messages', value: { intValue: 2 ** 53 + 2 } },
              { key: 'gen_ai.agent.name', value: { intValue: 1.5 } },
              { key: 'gen_ai.agent.id' },
              { value: { stringValue: 'keyless' } },
              'not an attribute',
            ],
            status: { code: 2 },
          },
          { attributes: [{ key: 'service.name', value: { stringValue: 'svc' } }] },
        ),
      ),
      { storeContent: true, redact: keep },
    ).spans;
    expect(span).toMatchObject({
      inputTokens: 12,
      outputTokens: null,
      finishReasons: ['stop'],
      requestModel: null,
      responseModel: null,
      agentName: null,
      agentId: null,
      status: 'error',
      serviceName: 'svc',
      content: {
        input: '[false,1.5,"AAE=",null,null,{"v":null},[],{}]',
        output: null,
      },
    });
  });

  it('maps every status code, numeric and named', () => {
    const statusOf = (status: unknown) =>
      parseOtlpGenAi(
        bytes(single({ attributes: [s('gen_ai.operation.name', 'chat')], status })),
        defaults,
      ).spans[0]?.status;
    expect(statusOf({ code: 0 })).toBe('unset');
    expect(statusOf({ code: 'STATUS_CODE_OK' })).toBe('ok');
    expect(statusOf({ code: 'STATUS_CODE_UNSET' })).toBe('unset');
    expect(statusOf({ code: 7 })).toBe('unset');
    expect(statusOf(undefined)).toBe('unset');
  });

  it('accepts numeric nanoseconds and clamps an end before the start to zero', () => {
    const [span] = parseOtlpGenAi(
      bytes(
        single({
          attributes: [s('gen_ai.operation.name', 'embeddings')],
          startTimeUnixNano: 1_000_000,
          endTimeUnixNano: '0',
        }),
      ),
      defaults,
    ).spans;
    expect(span).toMatchObject({ startedAt: '1970-01-01T00:00:00.001Z', durationMs: 0 });
  });

  it('tolerates missing scopeSpans and spans arrays and a non-GenAI span with no attributes', () => {
    const result = parseOtlpGenAi(
      bytes({
        resourceSpans: [{}, { scopeSpans: [{}, { spans: [{ traceId: TRACE }] }] }],
      }),
      defaults,
    );
    expect(result).toEqual({ spans: [], dropped: { notGenAi: 1, overLimit: 0 }, truncated: false });
  });
});

describe('limits and refusals', () => {
  it('truncates past maxSpans and counts what it left out', () => {
    const result = parseOtlpGenAi(bytes(fixture()), { ...defaults, maxSpans: 2 });
    expect(result.spans).toHaveLength(2);
    expect(result.dropped).toEqual({ notGenAi: 1, overLimit: 1 });
    expect(result.truncated).toBe(true);
  });

  it('defaults to 10 000 spans', () => {
    expect(DEFAULT_MAX_GENAI_SPANS).toBe(10_000);
    const spans = Array.from({ length: DEFAULT_MAX_GENAI_SPANS + 1 }, (_, index) => ({
      traceId: TRACE,
      spanId: index.toString(16).padStart(16, '0'),
      startTimeUnixNano: '0',
      endTimeUnixNano: '0',
      attributes: [s('gen_ai.operation.name', 'chat')],
    }));
    const result = parseOtlpGenAi(
      bytes({ resourceSpans: [{ scopeSpans: [{ spans }] }] }),
      defaults,
    );
    expect(result.spans).toHaveLength(DEFAULT_MAX_GENAI_SPANS);
    expect(result.dropped.overLimit).toBe(1);
  });

  it('refuses an oversized batch before parsing it', () => {
    const error = refusal(() =>
      parseOtlpGenAi(new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1), defaults),
    );
    expect(error.code).toBe('too_large');
  });

  it.each([
    ['not JSON', new TextEncoder().encode('{nope')],
    ['an array', bytes([])],
    ['no resourceSpans', bytes({ resourceLogs: [] })],
    ['a non-object resource', bytes({ resourceSpans: [1] })],
    ['a non-array scopeSpans', bytes({ resourceSpans: [{ scopeSpans: {} }] })],
    ['a non-object scope', bytes({ resourceSpans: [{ scopeSpans: ['x'] }] })],
    ['a non-array spans', bytes({ resourceSpans: [{ scopeSpans: [{ spans: 3 }] }] })],
    ['a non-object span', bytes({ resourceSpans: [{ scopeSpans: [{ spans: [null] }] }] })],
  ])('refuses %s as malformed', (_label, input) => {
    expect(refusal(() => parseOtlpGenAi(input, defaults)).code).toBe('malformed');
  });

  it.each([
    ['a base64 trace id', { traceId: 'W47/95gDgQPSabYzgT/GDA==' }],
    ['a short span id', { spanId: 'abc' }],
    ['a bad parent id', { parentSpanId: 'zz' }],
    ['a missing start', { startTimeUnixNano: undefined }],
    ['a fractional end', { endTimeUnixNano: 1.5 }],
    ['a negative end', { endTimeUnixNano: '-1' }],
  ])('refuses a GenAI span with %s', (_label, patch) => {
    const span = {
      traceId: TRACE,
      spanId: CHAT,
      startTimeUnixNano: '0',
      endTimeUnixNano: '0',
      attributes: [s('gen_ai.operation.name', 'chat')],
      ...patch,
    };
    const error = refusal(() =>
      parseOtlpGenAi(bytes({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] }), defaults),
    );
    expect(error.code).toBe('malformed');
  });
});
