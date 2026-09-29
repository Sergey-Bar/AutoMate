import { describe, expect, it } from 'vitest';
import { createErrorBoundary } from './boundary.js';
import { createLogger, type LogRecord } from '../observability/logger.js';
import { DomainError } from './domain-error.js';

/**
 * The boundary's `log` seam, asserted to be the one the application uses.
 *
 * `ErrorBoundaryOptions.log` was declared, documented as "Injected so tests can
 * assert what was logged", and **never passed by a single caller in production** —
 * `apps/api/src/index.ts` constructed the boundary with `requestId` and
 * `reportError` and nothing else. So every failure in the API reached
 * `console.error(message, context)`: a message string and a loose object side by
 * side, unparseable, unqueryable, and filterable only by a human reading lines.
 *
 * The defect is not "logging is missing". It is that a seam designed to be the one
 * place this decision is made had a default nobody could see, and a test could not
 * have caught it — every test passes a collector, so the test path was always
 * populated and the production path never was.
 */
describe('the error boundary logs where the application says it does', () => {
  it('writes a structured record for an unhandled failure, not a console.error pair', async () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      service: 'automate-api',
      sink: (record) => records.push(record),
    });
    const { onError } = createErrorBoundary({
      requestId: () => 'r-1',
      log: logger.error,
      reportError: () => undefined,
    });

    const thrown = new TypeError('unexpected');
    // A minimal Hono context is all the boundary reads: `req.path`, `req.method`,
    // and `json`.
    await onError(thrown, contextFor('/api/v1/runs', 'GET'));

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.level).toBe('error');
    expect(record?.service).toBe('automate-api');
    expect(record?.requestId).toBe('r-1');
    expect(record?.path).toBe('/api/v1/runs');
    // The cause survives the line, which `JSON.stringify(new Error(...))` alone
    // would have reduced to `{}`.
    expect(JSON.stringify(record)).toContain('unexpected');
  });

  it('keeps the response the caller receives unchanged by the logger', async () => {
    // The logger is an observation, not part of the request path. A change to it
    // must not be able to change a status code or a body — that is the property
    // that makes it safe to put in the error boundary at all.
    const records: LogRecord[] = [];
    const logger = createLogger({ service: 'automate-api', sink: (r) => records.push(r) });
    const { onError } = createErrorBoundary({
      requestId: () => 'r-1',
      log: logger.error,
      reportError: () => undefined,
    });

    const response = await onError(
      new DomainError('VALIDATION_FAILED', 'nope'),
      contextFor('/api/v1/runs', 'POST'),
    );
    const body = (await response?.json()) as { error: { code: string; requestId: string } };

    // 422 is what `VALIDATION_FAILED` maps to in the taxonomy — asserted against
    // the code's own mapping rather than a number picked here, so a re-band shows
    // up as this test failing rather than as a silent mismatch.
    expect(response?.status).toBe(422);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.requestId).toBe('r-1');
    // A 4xx refusal is a normal answer, not a defect: it is not logged and not
    // reported, because reporting it would bury the defects in the noise.
    expect(records).toHaveLength(0);
  });

  it('a failing logger cannot change the error response', async () => {
    // The logger's own contract says a sink that throws is swallowed. Asserted
    // here because the caller is the error boundary: the moment a destination
    // hiccup could replace a coded 500 with a crash, the logger would be the most
    // dangerous thing in the request path.
    const { onError } = createErrorBoundary({
      requestId: () => 'r-1',
      log: createLogger({
        service: 'automate-api',
        sink: () => {
          throw new Error('destination down');
        },
      }).error,
      reportError: () => undefined,
    });

    const response = await onError(new TypeError('boom'), contextFor('/api/v1/runs', 'GET'));
    expect(response?.status).toBe(500);
    const body = (await response?.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL');
  });
});

/**
 * The two request properties the boundary reads, and nothing else.
 *
 * Typed as the narrow shape rather than a full `Context`, because the boundary's
 * dependence on the request is the thing being pinned: it reads `path` and
 * `method` and nothing more, and a test that built a whole Hono app to observe two
 * fields would hide a new dependency rather than reveal one.
 */
function contextFor(path: string, method: string) {
  return {
    req: { path, method, header: (): string | undefined => undefined },
    json: (body: unknown, status?: number): Response =>
      new Response(JSON.stringify(body), {
        status: status ?? 200,
        headers: { 'content-type': 'application/json' },
      }),
  } as never;
}
