import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  createOtlpExporter,
  encodeTraces,
  otlpRequestSpans,
  parseTraceparent,
  readOtlpSettings,
  type ServerSpan,
} from './otlp-traces.js';

/**
 * The API's own request traces, exported over OTLP/HTTP JSON to the operator's collector
 * (ADR-014, enterprise). Off unless an endpoint is set; bounded in memory; never blocks or
 * fails a request; and a span carries the route pattern, never a path with ids or a query.
 */
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';

function span(overrides: Partial<ServerSpan> = {}): ServerSpan {
  return {
    traceId: TRACE,
    spanId: '1'.repeat(16),
    name: 'GET /api/v1/runs/:runId',
    startNs: 1_000_000_000n,
    endNs: 1_250_000_000n,
    attributes: { 'http.request.method': 'GET', 'http.response.status_code': 200 },
    error: false,
    ...overrides,
  };
}

describe('the OTLP settings', () => {
  it('are off with no endpoint, so a fresh install makes no outbound call', () => {
    expect(readOtlpSettings({})).toBeUndefined();
    expect(readOtlpSettings({ OTEL_EXPORTER_OTLP_ENDPOINT: '  ' })).toBeUndefined();
  });

  it('send traces to <endpoint>/v1/traces, or to the traces endpoint exactly as given', () => {
    expect(readOtlpSettings({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/' })).toEqual({
      settings: {
        url: 'http://collector:4318/v1/traces',
        headers: {},
        serviceName: 'automate-api',
      },
    });
    expect(
      readOtlpSettings({
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://ignored:4318',
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://otlp.example.com/ingest',
        OTEL_SERVICE_NAME: 'automate-prod',
      }),
    ).toEqual({
      settings: {
        url: 'https://otlp.example.com/ingest',
        headers: {},
        serviceName: 'automate-prod',
      },
    });
  });

  it('read headers as the specification writes them, percent-decoded', () => {
    const read = readOtlpSettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization=Basic%20abc, x-team = qa',
    });
    expect(read).toMatchObject({
      settings: { headers: { authorization: 'Basic abc', 'x-team': 'qa' } },
    });
  });

  it('name the setting that is wrong, without echoing a header value', () => {
    expect(readOtlpSettings({ OTEL_EXPORTER_OTLP_ENDPOINT: 'collector:4318' })).toEqual({
      problem: 'OTEL_EXPORTER_OTLP_ENDPOINT must be an http:// or https:// URL',
    });
    expect(readOtlpSettings({ OTEL_EXPORTER_OTLP_ENDPOINT: 'file:///etc/passwd' })).toEqual({
      problem: 'OTEL_EXPORTER_OTLP_ENDPOINT must be an http:// or https:// URL',
    });
    const bad = readOtlpSettings({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
      OTEL_EXPORTER_OTLP_HEADERS: 'authorization',
    });
    expect(bad).toEqual({ problem: 'OTEL_EXPORTER_OTLP_HEADERS must be name=value pairs' });
  });
});

describe('a W3C traceparent', () => {
  it('joins the caller’s trace when it is well formed', () => {
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-01`)).toEqual({
      traceId: TRACE,
      parentSpanId: PARENT,
    });
  });

  it('is ignored when it is malformed or all zeros, rather than trusted', () => {
    for (const value of [
      undefined,
      '',
      `ff-${TRACE}-${PARENT}-01`,
      `00-${'0'.repeat(32)}-${PARENT}-01`,
      `00-${TRACE}-${'0'.repeat(16)}-01`,
      `00-${TRACE.toUpperCase()}-${PARENT}-01`,
      `00-${TRACE}-${PARENT}`,
    ]) {
      expect(parseTraceparent(value), String(value)).toBeUndefined();
    }
  });
});

describe('the OTLP/HTTP JSON body', () => {
  it('is one resource with the service name, one scope, and each span as the protocol writes it', () => {
    const body = encodeTraces([span({ parentSpanId: PARENT, error: true })], {
      serviceName: 'automate-api',
      serviceVersion: '3.2.0',
    });
    expect(body).toEqual({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'automate-api' } },
              { key: 'service.version', value: { stringValue: '3.2.0' } },
            ],
          },
          scopeSpans: [
            {
              scope: { name: '@automate/api' },
              spans: [
                {
                  traceId: TRACE,
                  spanId: '1'.repeat(16),
                  parentSpanId: PARENT,
                  name: 'GET /api/v1/runs/:runId',
                  kind: 2,
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '1250000000',
                  attributes: [
                    { key: 'http.request.method', value: { stringValue: 'GET' } },
                    { key: 'http.response.status_code', value: { intValue: '200' } },
                  ],
                  status: { code: 2 },
                },
              ],
            },
          ],
        },
      ],
    });
  });
});

describe('the exporter', () => {
  const settings = {
    url: 'https://otlp.example.com/v1/traces',
    headers: { authorization: 'Basic abc' },
    serviceName: 'automate-api',
  };

  it('posts the queued spans as JSON with the configured headers, in batches', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const exporter = createOtlpExporter(settings, { fetch: fetchImpl, maxBatch: 2 });
    for (let index = 0; index < 5; index++) exporter.record(span());
    await exporter.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(settings.url);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(new Headers(init.headers).get('authorization')).toBe('Basic abc');
    const sent = JSON.parse(String(init.body)) as ReturnType<typeof encodeTraces>;
    expect(sent.resourceSpans[0]?.scopeSpans[0]?.spans).toHaveLength(2);
    expect(exporter.stats()).toEqual({ queued: 0, exported: 5, dropped: 0, failed: 0 });
  });

  it('drops spans past its queue rather than growing, and counts them', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const exporter = createOtlpExporter(settings, { fetch: fetchImpl, maxQueue: 3 });
    for (let index = 0; index < 5; index++) exporter.record(span());
    expect(exporter.stats()).toMatchObject({ queued: 3, dropped: 2 });
  });

  it('counts a refused or failed export, warns without the headers, and keeps going', async () => {
    const warn = vi.fn();
    const fetchImpl = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response('nope', { status: 401 }))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const exporter = createOtlpExporter(settings, { fetch: fetchImpl, maxBatch: 1, warn });
    exporter.record(span());
    exporter.record(span());
    exporter.record(span());
    await exporter.flush();
    expect(exporter.stats()).toEqual({ queued: 0, exported: 1, dropped: 0, failed: 2 });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('Basic abc');
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/401/u);
  });

  it('does not overlap two flushes, and sends what is left when it stops', async () => {
    let release: () => void = () => undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = () => resolve(new Response('{}', { status: 200 }));
        }),
    );
    const exporter = createOtlpExporter(settings, { fetch: fetchImpl });
    exporter.record(span());
    const first = exporter.flush();
    const second = exporter.flush();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release();
    await Promise.all([first, second]);
    exporter.record(span());
    const stopping = exporter.stop();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    release();
    await stopping;
    expect(exporter.stats()).toMatchObject({ exported: 2, queued: 0 });
  });

  it('flushes on its interval once started, and not after it stops', async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
      const exporter = createOtlpExporter(settings, { fetch: fetchImpl });
      exporter.start(1_000);
      exporter.record(span());
      await vi.advanceTimersByTimeAsync(1_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await exporter.stop();
      exporter.record(span());
      await vi.advanceTimersByTimeAsync(5_000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a request span', () => {
  function harness() {
    const recorded: ServerSpan[] = [];
    const app = new Hono();
    app.use('*', otlpRequestSpans({ record: (value) => recorded.push(value) }));
    app.get('/api/v1/runs/:runId', (context) => context.json({ id: context.req.param('runId') }));
    app.get('/api/v1/boom', () => {
      throw new Error('boom');
    });
    app.onError((_error, context) => context.json({ error: 'internal' }, 500));
    return { app, recorded };
  }

  it('is named by the route pattern, never by the path with its ids or its query', async () => {
    const { app, recorded } = harness();
    await app.request('/api/v1/runs/7f0e2c1a-0000-4000-8000-000000000001?token=secret');
    expect(recorded).toHaveLength(1);
    const [only] = recorded;
    expect(only?.name).toBe('GET /api/v1/runs/:runId');
    expect(only?.attributes).toMatchObject({
      'http.request.method': 'GET',
      'http.route': '/api/v1/runs/:runId',
      'http.response.status_code': 200,
    });
    expect(JSON.stringify(encodeTraces(recorded, { serviceName: 'x' }))).not.toMatch(
      /7f0e2c1a|secret/u,
    );
    expect(only?.traceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(only?.spanId).toMatch(/^[0-9a-f]{16}$/u);
    expect(only!.endNs >= only!.startNs).toBe(true);
    expect(only?.error).toBe(false);
  });

  it('joins the caller’s trace, and marks a 5xx as an error', async () => {
    const { app, recorded } = harness();
    await app.request('/api/v1/boom', { headers: { traceparent: `00-${TRACE}-${PARENT}-01` } });
    expect(recorded[0]).toMatchObject({ traceId: TRACE, parentSpanId: PARENT, error: true });
  });

  it('names an unmatched request by its method alone, so a scan cannot mint span names', async () => {
    const { app, recorded } = harness();
    await app.request('/wp-admin/../../etc/passwd');
    expect(recorded[0]?.name).toBe('GET');
    expect(recorded[0]?.attributes['http.route']).toBeUndefined();
  });
});
