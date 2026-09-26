import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DomainError, ErrorCode, statusForCode } from './domain-error.js';
import { classifyDatabaseError, hasSqlState, sqlStateRules } from './db-errors.js';
import { createErrorBoundary } from './boundary.js';

/** A `pg`/`DrizzlePostgresError`, structurally. */
function driverError(sqlState: string, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(`driver message for ${sqlState}`), { code: sqlState, ...extra });
}

function app() {
  const logged: Array<{ message: string; context: Record<string, unknown> }> = [];
  const boundary = createErrorBoundary({
    log: (message, context) => logged.push({ message, context }),
    requestId: () => 'req-test',
  });
  const instance = new Hono();
  instance.onError(boundary.onError);
  instance.notFound(boundary.notFound);
  return { instance, logged };
}

describe('error code to status mapping', () => {
  it('maps every code to a status, with 4xx for caller errors and 5xx for ours', () => {
    const table = Object.entries(sqlStateRules());
    expect(table.length).toBeGreaterThan(20);

    for (const code of [
      ErrorCode.INVALID_REQUEST,
      ErrorCode.UNAUTHENTICATED,
      ErrorCode.FORBIDDEN,
      ErrorCode.NOT_FOUND,
      ErrorCode.CONFLICT,
      ErrorCode.PAYLOAD_TOO_LARGE,
      ErrorCode.VALIDATION_FAILED,
    ] as const) {
      const status = statusForCode(code);
      expect(status, code).toBeGreaterThanOrEqual(400);
      expect(status, code).toBeLessThan(500);
    }
    for (const code of [ErrorCode.INTERNAL, ErrorCode.DEPENDENCY_UNAVAILABLE] as const) {
      expect(statusForCode(code), code).toBeGreaterThanOrEqual(500);
    }
  });

  it('has a status for every code in the taxonomy', () => {
    for (const code of Object.values(ErrorCode)) {
      expect(typeof statusForCode(code), code).toBe('number');
    }
  });
});

describe('database error classification', () => {
  it('maps a CHECK violation to 422, not 500', () => {
    // The case the plan names: a state transition the schema rejects used to be
    // an unclassified 500, so a caller retried a request that could never work.
    const error = classifyDatabaseError(
      driverError('23514', { constraint: 'artifacts_evidence_check' }),
    );
    expect(error.code).toBe(ErrorCode.CHECK_CONSTRAINT_VIOLATED);
    expect(error.status).toBe(422);
    expect(error.logMessage()).toContain('artifacts_evidence_check');
  });

  it.each([
    ['23505', ErrorCode.DUPLICATE, 409],
    ['23503', ErrorCode.VALIDATION_FAILED, 422],
    ['23502', ErrorCode.MISSING_REQUIRED_FIELD, 400],
    ['23000', ErrorCode.VALIDATION_FAILED, 422],
    ['22P02', ErrorCode.INVALID_REQUEST, 400],
    ['22003', ErrorCode.INVALID_REQUEST, 400],
    ['40001', ErrorCode.SERIALIZATION_FAILED, 409],
    ['40P01', ErrorCode.SERIALIZATION_FAILED, 409],
    ['08006', ErrorCode.DEPENDENCY_UNAVAILABLE, 503],
    ['53300', ErrorCode.DEPENDENCY_UNAVAILABLE, 503],
    ['57014', ErrorCode.DEPENDENCY_UNAVAILABLE, 503],
  ])('maps SQLSTATE %s to %s (%i)', (sqlState, code, status) => {
    const error = classifyDatabaseError(driverError(sqlState));
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('makes a serialization failure retryable with a distinct code', () => {
    // A caller can act on SERIALIZATION_FAILED by retrying; on a bare 500 it
    // could not, so it either gave up or hammered the API.
    const error = classifyDatabaseError(driverError('40001'));
    expect(error.code).toBe(ErrorCode.SERIALIZATION_FAILED);
    expect(error.status).toBe(409);
    expect(error.message).toContain('retry');
  });

  it('leaves an already-classified error alone', () => {
    const original = new DomainError(ErrorCode.LEASE_NOT_OWNED, 'lease is not yours');
    expect(classifyDatabaseError(original)).toBe(original);
  });

  it('becomes INTERNAL for anything without a recognised SQLSTATE', () => {
    for (const value of [new Error('boom'), null, undefined, 'a string', 42, {}]) {
      const error = classifyDatabaseError(value);
      expect(error.code).toBe(ErrorCode.INTERNAL);
      expect(error.status).toBe(500);
    }
  });

  it('keeps the original as the cause so the log can name it', () => {
    const original = new Error('the real failure');
    const error = classifyDatabaseError(original);
    expect(error.cause).toBe(original);
  });

  it('does not put a constraint name in the caller-visible message or details', () => {
    const error = classifyDatabaseError(
      driverError('23514', { constraint: 'quarantine_ttf_resolution_check' }),
    );
    // It goes in the log only: it names an internal object.
    expect(error.logMessage()).toContain('quarantine_ttf_resolution_check');
    expect(error.message).not.toContain('quarantine_ttf');
    expect(JSON.stringify(error.details)).not.toContain('quarantine_ttf');
  });

  it('finds a SQLSTATE through a Drizzle-style cause chain', () => {
    // Drizzle does not rethrow the `pg` error: it throws its own Error whose
    // `cause` carries the code. A classifier reading only the top level
    // classifies every Drizzle error as INTERNAL — a bare 500, silently.
    const wrapped = Object.assign(new Error('Failed query: insert into "quarantine" …'), {
      query: 'insert into "quarantine" …',
      params: [],
      cause: driverError('23514', { constraint: 'artifacts_evidence_check' }),
    });
    const error = classifyDatabaseError(wrapped);
    expect(error.code).toBe(ErrorCode.CHECK_CONSTRAINT_VIOLATED);
    expect(error.status).toBe(422);
    expect(hasSqlState(wrapped)).toBe(true);
  });

  it('finds a SQLSTATE two levels down', () => {
    const double = Object.assign(new Error('outer'), {
      cause: Object.assign(new Error('inner'), { cause: driverError('40001') }),
    });
    expect(classifyDatabaseError(double).code).toBe(ErrorCode.SERIALIZATION_FAILED);
  });

  it('does not loop forever on a cyclic cause chain', () => {
    const first: Record<string, unknown> = {};
    const second: Record<string, unknown> = { cause: first };
    first['cause'] = second;
    expect(() => classifyDatabaseError(first)).not.toThrow();
    expect(classifyDatabaseError(first).code).toBe(ErrorCode.INTERNAL);
  });

  it('recognises a driver error by its five-character SQLSTATE', () => {
    expect(hasSqlState(driverError('23514'))).toBe(true);
    expect(hasSqlState(new Error('no code'))).toBe(false);
    expect(hasSqlState({ code: 'X' })).toBe(false);
    expect(hasSqlState(null)).toBe(false);
  });
});

describe('error boundary', () => {
  it('renders a DomainError with its code and status', async () => {
    const { instance } = app();
    instance.get('/boom', () => {
      throw new DomainError(ErrorCode.LEASE_NOT_OWNED, 'the job lease belongs to another runner');
    });
    const response = await instance.request('/boom');
    expect(response.status).toBe(409);
    const body = (await response.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe(ErrorCode.LEASE_NOT_OWNED);
    expect(body.error.message).toContain('another runner');
    expect(body.error.requestId).toBe('req-test');
  });

  it('classifies a thrown database error at the boundary', async () => {
    const { instance } = app();
    instance.get('/check', () => {
      throw driverError('23514', { constraint: 'artifacts_evidence_check' });
    });
    const response = await instance.request('/check');
    // 422, not the 500 this used to produce.
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCode.CHECK_CONSTRAINT_VIOLATED);
  });

  it('keeps a constraint name out of the response and in the log', async () => {
    const { instance, logged } = app();
    instance.get('/check', () => {
      throw driverError('23514', { constraint: 'quarantine_ttf_resolution_check' });
    });
    const response = await instance.request('/check');
    expect(response.status).toBe(422);
    // A 422 is a caller-facing answer, so the constraint name must not be in it.
    expect(await response.text()).not.toContain('quarantine_ttf_resolution_check');
    // The log is where the detail belongs.
    expect(logged.some((entry) => JSON.stringify(entry).includes('quarantine_ttf'))).toBe(true);
  });

  it('returns a generic 500 and logs the cause for an unrecognised error', async () => {
    const { instance, logged } = app();
    instance.get('/oops', () => {
      throw new Error('connection string postgres://user:pw@host/db blew up at line 42');
    });
    const response = await instance.request('/oops');
    expect(response.status).toBe(500);
    const body = (await response.json()) as {
      error: { code: string; message: string; details: unknown };
    };
    expect(body.error.code).toBe(ErrorCode.INTERNAL);
    expect(body.error.message).toBe('internal error');
    // Nothing about the cause reaches the caller.
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(JSON.stringify(body)).not.toContain('line 42');
    expect(body.error.details).toEqual({});
    // The log is where the detail belongs.
    expect(logged.some((entry) => JSON.stringify(entry.context).includes('postgres://'))).toBe(
      true,
    );
  });

  it('does not return a 5xx DomainError message to the caller', async () => {
    const { instance } = app();
    instance.get('/secret', () => {
      throw new DomainError(
        ErrorCode.DEPENDENCY_UNAVAILABLE,
        'vault at s3://bucket/key unreachable',
      );
    });
    const response = await instance.request('/secret');
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain('s3://');
  });

  it('answers an unknown route with a classified 404', async () => {
    const { instance } = app();
    const response = await instance.request('/nope');
    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe(ErrorCode.NOT_FOUND);
  });
});
