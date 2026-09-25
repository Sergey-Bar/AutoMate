import { describe, it, expect } from 'vitest';
import { ConnectorError, classifyHttpError, classifyResponseStatus } from './errors.js';

describe('ConnectorError', () => {
  it('creates a ConnectorError with the given message and kind', () => {
    const err = new ConnectorError('oops', 'transient');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.message).toBe('oops');
    expect(err.kind).toBe('transient');
    expect(err.name).toBe('ConnectorError');
  });

  it('stores statusCode when provided', () => {
    const err = new ConnectorError('server error', 'transient', 503);
    expect(err.statusCode).toBe(503);
  });

  it('statusCode is undefined when not provided', () => {
    const err = new ConnectorError('unknown', 'unknown');
    expect(err.statusCode).toBeUndefined();
  });

  it('supports permanent kind', () => {
    const err = new ConnectorError('not found', 'permanent', 404);
    expect(err.kind).toBe('permanent');
  });

  it('supports cause via ErrorOptions', () => {
    const cause = new Error('root cause');
    const err = new ConnectorError('wrapper', 'unknown', undefined, { cause });
    expect((err as Error & { cause: Error }).cause).toBe(cause);
  });
});

describe('classifyHttpError', () => {
  it('classifies status 429 as transient', () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('transient');
    expect(result.statusCode).toBe(429);
    expect(result.message).toBe('rate limited');
  });

  it('classifies status 500 as transient', () => {
    const err = Object.assign(new Error('server error'), { status: 500 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('transient');
    expect(result.statusCode).toBe(500);
  });

  it('classifies status 503 as transient', () => {
    const err = Object.assign(new Error('unavailable'), { status: 503 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('transient');
    expect(result.statusCode).toBe(503);
  });

  it('classifies status 599 as transient', () => {
    const err = Object.assign(new Error('gateway timeout'), { status: 599 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('transient');
    expect(result.statusCode).toBe(599);
  });

  it('does NOT classify status 501 as transient (permanent)', () => {
    const err = Object.assign(new Error('not implemented'), { status: 501 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('permanent');
    expect(result.statusCode).toBe(501);
  });

  it('classifies status 401 as permanent', () => {
    const err = Object.assign(new Error('unauthorized'), { status: 401 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('permanent');
    expect(result.statusCode).toBe(401);
  });

  it('classifies status 403 as permanent', () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('permanent');
    expect(result.statusCode).toBe(403);
  });

  it('classifies status 404 as permanent', () => {
    const err = Object.assign(new Error('not found'), { status: 404 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('permanent');
    expect(result.statusCode).toBe(404);
  });

  it('classifies status 400 as permanent', () => {
    const err = Object.assign(new Error('bad request'), { status: 400 });
    const result = classifyHttpError(err);
    expect(result.kind).toBe('permanent');
    expect(result.statusCode).toBe(400);
  });

  it('classifies errors with no status as unknown', () => {
    const err = new Error('connect ECONNREFUSED');
    const result = classifyHttpError(err);
    expect(result.kind).toBe('unknown');
    expect(result.statusCode).toBeUndefined();
    expect(result.message).toBe('connect ECONNREFUSED');
  });

  it('wraps non-Error thrown values into ConnectorError', () => {
    const result = classifyHttpError('something went wrong');
    expect(result).toBeInstanceOf(ConnectorError);
    expect(result.message).toBe('something went wrong');
    expect(result.kind).toBe('unknown');
  });

  it('preserves the original error as cause', () => {
    const original = new Error('original');
    const result = classifyHttpError(original);
    expect((result as Error & { cause: Error }).cause).toBe(original);
  });
});

describe('classifyResponseStatus', () => {
  it('classifies 429 as transient', () => {
    expect(classifyResponseStatus(429)).toBe('transient');
  });

  it('classifies 500 as transient', () => {
    expect(classifyResponseStatus(500)).toBe('transient');
  });

  it('classifies 503 as transient', () => {
    expect(classifyResponseStatus(503)).toBe('transient');
  });

  it('classifies 599 as transient', () => {
    expect(classifyResponseStatus(599)).toBe('transient');
  });

  it('does NOT classify 501 as transient', () => {
    expect(classifyResponseStatus(501)).toBe('permanent');
  });

  it('classifies 400 as permanent', () => {
    expect(classifyResponseStatus(400)).toBe('permanent');
  });

  it('classifies 401 as permanent', () => {
    expect(classifyResponseStatus(401)).toBe('permanent');
  });

  it('classifies 403 as permanent', () => {
    expect(classifyResponseStatus(403)).toBe('permanent');
  });

  it('classifies 404 as permanent', () => {
    expect(classifyResponseStatus(404)).toBe('permanent');
  });

  it('classifies 499 as permanent', () => {
    expect(classifyResponseStatus(499)).toBe('permanent');
  });

  it('classifies 200 as unknown', () => {
    expect(classifyResponseStatus(200)).toBe('unknown');
  });

  it('classifies 301 as unknown', () => {
    expect(classifyResponseStatus(301)).toBe('unknown');
  });
});
