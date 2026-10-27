import { randomBytes } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { currentRequestId } from './request-context.js';

/**
 * The API's own request traces, exported over OTLP/HTTP JSON to the operator's collector
 * (ADR-014, enterprise): one server span per request, joined to the caller's trace when a
 * W3C `traceparent` arrives.
 *
 * **Why not the OpenTelemetry SDK.** What is exported is one span per request with five
 * attributes, and the wire format is a JSON document. The SDK brings a dependency tree, a
 * global provider (process-wide state, the thing `metrics.ts` declines for the same
 * reason), and auto-instrumentation that patches `http` and `pg` and would put SQL and
 * URLs with ids into spans. A hand-written exporter is the boring version of the small thing.
 *
 * **What a span carries, and what it never does.** The route *pattern* (`/api/v1/runs/:runId`),
 * the method, the status, the request id and timing. Never the path with its ids, the query,
 * a header, a body, or a user: a trace backend is a different audience from an authenticated
 * API read, the same line `/metrics` draws.
 *
 * **It cannot hurt a request.** Recording is a push onto a bounded queue; the queue drops and
 * counts past its size; export happens on a timer, one flush at a time, and a refused or
 * failed export is counted and logged without its headers, and never retried into a backlog.
 * Off entirely unless an endpoint is set, so an install makes no outbound call by default.
 */
export const OTLP_VARIABLES = {
  endpoint: 'OTEL_EXPORTER_OTLP_ENDPOINT',
  tracesEndpoint: 'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  headers: 'OTEL_EXPORTER_OTLP_HEADERS',
  serviceName: 'OTEL_SERVICE_NAME',
} as const;

export interface OtlpSettings {
  /** Where spans are posted: the traces endpoint, or `<endpoint>/v1/traces`. */
  url: string;
  headers: Record<string, string>;
  serviceName: string;
}

const DEFAULT_SERVICE_NAME = 'automate-api';

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** `name=value,name2=value2`, values percent-decoded, as the OTLP exporter spec writes them. */
function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  for (const pair of (raw ?? '').split(',')) {
    if (pair.trim() === '') continue;
    const at = pair.indexOf('=');
    if (at <= 0) return undefined;
    const name = pair.slice(0, at).trim();
    try {
      headers[name] = decodeURIComponent(pair.slice(at + 1).trim());
    } catch {
      return undefined;
    }
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/u.test(name)) return undefined;
  }
  return headers;
}

/**
 * The exporter's settings, `undefined` when no endpoint is set, or the one setting that is
 * wrong. A wrong setting does not stop the API — a misconfigured telemetry sink must not take
 * down the service it watches — but the caller logs it, so it is not silently off.
 */
export function readOtlpSettings(
  env: NodeJS.ProcessEnv = process.env,
): { settings: OtlpSettings } | { problem: string } | undefined {
  const traces = env[OTLP_VARIABLES.tracesEndpoint]?.trim();
  const base = env[OTLP_VARIABLES.endpoint]?.trim();
  if (!traces && !base) return undefined;
  const variable = traces ? OTLP_VARIABLES.tracesEndpoint : OTLP_VARIABLES.endpoint;
  const parsed = httpUrl(traces || (base as string));
  if (parsed === undefined) return { problem: `${variable} must be an http:// or https:// URL` };
  const url = traces ? parsed : `${parsed.replace(/\/+$/u, '')}/v1/traces`;
  const headers = parseHeaders(env[OTLP_VARIABLES.headers]);
  if (headers === undefined) {
    return { problem: `${OTLP_VARIABLES.headers} must be name=value pairs` };
  }
  const serviceName = env[OTLP_VARIABLES.serviceName]?.trim() || DEFAULT_SERVICE_NAME;
  return { settings: { url, headers, serviceName } };
}

/** One finished server span, before encoding. Ids are lowercase hex, times nanoseconds. */
export interface ServerSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startNs: bigint;
  endNs: bigint;
  attributes: Record<string, string | number>;
  /** A 5xx: the span's status is ERROR. A 4xx is the client's, and stays unset. */
  error: boolean;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/u;

/** The caller's trace and span from a W3C `traceparent`, or `undefined` if it is not one. */
export function parseTraceparent(
  header: string | undefined,
): { traceId: string; parentSpanId: string } | undefined {
  const match = TRACEPARENT.exec(header?.trim() ?? '');
  if (match === null) return undefined;
  const [, traceId = '', parentSpanId = ''] = match;
  if (/^0+$/u.test(traceId) || /^0+$/u.test(parentSpanId)) return undefined;
  return { traceId, parentSpanId };
}

type AnyValue = { stringValue: string } | { intValue: string };

function attribute(key: string, value: string | number): { key: string; value: AnyValue } {
  return {
    key,
    value:
      typeof value === 'number' && Number.isInteger(value)
        ? { intValue: String(value) }
        : { stringValue: String(value) },
  };
}

/** The OTLP/HTTP JSON request body for these spans: one resource, one scope. */
export function encodeTraces(
  spans: readonly ServerSpan[],
  resource: { serviceName: string; serviceVersion?: string },
) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attribute('service.name', resource.serviceName),
            ...(resource.serviceVersion === undefined
              ? []
              : [attribute('service.version', resource.serviceVersion)]),
          ],
        },
        scopeSpans: [
          {
            scope: { name: '@automate/api' },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
              name: span.name,
              // SPAN_KIND_SERVER.
              kind: 2,
              startTimeUnixNano: span.startNs.toString(),
              endTimeUnixNano: span.endNs.toString(),
              attributes: Object.entries(span.attributes).map(([key, value]) =>
                attribute(key, value),
              ),
              // STATUS_CODE_ERROR, or unset.
              ...(span.error ? { status: { code: 2 } } : {}),
            })),
          },
        ],
      },
    ],
  };
}

export interface OtlpExporterOptions {
  fetch?: typeof fetch;
  /** Spans held between flushes; past it a span is dropped and counted. */
  maxQueue?: number;
  /** Spans per request to the collector. */
  maxBatch?: number;
  timeoutMs?: number;
  serviceVersion?: string;
  warn?: (message: string) => void;
}

export interface OtlpExporter {
  record: (span: ServerSpan) => void;
  /** Sends everything queued, one batch at a time. Concurrent calls share one flush. */
  flush: () => Promise<void>;
  start: (intervalMs: number) => void;
  /** Stops the timer and sends what is left. */
  stop: () => Promise<void>;
  stats: () => { queued: number; exported: number; dropped: number; failed: number };
}

export function createOtlpExporter(
  settings: OtlpSettings,
  options: OtlpExporterOptions = {},
): OtlpExporter {
  const fetchImpl = options.fetch ?? fetch;
  const maxQueue = options.maxQueue ?? 2048;
  const maxBatch = options.maxBatch ?? 512;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const resource = {
    serviceName: settings.serviceName,
    ...(options.serviceVersion === undefined ? {} : { serviceVersion: options.serviceVersion }),
  };
  const queue: ServerSpan[] = [];
  const counts = { exported: 0, dropped: 0, failed: 0 };
  let inFlight: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const send = async (batch: ServerSpan[]): Promise<void> => {
    try {
      const response = await fetchImpl(settings.url, {
        method: 'POST',
        headers: { ...settings.headers, 'content-type': 'application/json' },
        body: JSON.stringify(encodeTraces(batch, resource)),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        counts.failed += batch.length;
        warn(
          `otlp: the collector answered ${String(response.status)}; ${batch.length} span(s) dropped`,
        );
        return;
      }
      counts.exported += batch.length;
    } catch (error) {
      counts.failed += batch.length;
      warn(
        `otlp: could not reach the collector (${error instanceof Error ? error.message : String(error)}); ${batch.length} span(s) dropped`,
      );
    }
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0) await send(queue.splice(0, maxBatch));
  };

  const flush = (): Promise<void> => {
    inFlight ??= drain().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  };

  return {
    record: (span) => {
      if (queue.length >= maxQueue) {
        counts.dropped += 1;
        return;
      }
      queue.push(span);
    },
    flush,
    start: (intervalMs) => {
      if (timer !== undefined) return;
      timer = setInterval(() => void flush(), intervalMs);
      timer.unref?.();
    },
    stop: async () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await inFlight;
      await flush();
    },
    stats: () => ({ queued: queue.length, ...counts }),
  };
}

const hex = (bytes: number): string => randomBytes(bytes).toString('hex');

/** A route that names nothing: the catch-all middleware patterns a request falls through to. */
const UNNAMED_ROUTES = new Set(['*', '/*', '']);

/**
 * One server span per request. Registered first, so the span covers everything after it;
 * reads the matched route after the response, so a 404 is named by its method alone and a
 * scanner sending random paths cannot mint span names.
 */
export function otlpRequestSpans(exporter: Pick<OtlpExporter, 'record'>): MiddlewareHandler {
  return async (context, next) => {
    const parent = parseTraceparent(context.req.header('traceparent'));
    const startNs = BigInt(Date.now()) * 1_000_000n;
    const began = process.hrtime.bigint();
    try {
      await next();
    } finally {
      const endNs = startNs + (process.hrtime.bigint() - began);
      const route = routePath(context, -1);
      const named = !UNNAMED_ROUTES.has(route);
      const status = context.res.status;
      const requestId = currentRequestId();
      exporter.record({
        traceId: parent?.traceId ?? hex(16),
        spanId: hex(8),
        ...(parent === undefined ? {} : { parentSpanId: parent.parentSpanId }),
        name: named ? `${context.req.method} ${route}` : context.req.method,
        startNs,
        endNs,
        attributes: {
          'http.request.method': context.req.method,
          ...(named ? { 'http.route': route } : {}),
          'http.response.status_code': status,
          ...(requestId === undefined ? {} : { 'automate.request_id': requestId }),
        },
        error: status >= 500,
      });
    }
  };
}
