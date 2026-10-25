import { describe, expect, it } from 'vitest';
import {
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  connectorFailure,
  dispatchEntry,
  type ConnectorManifest,
} from './index.js';

const MANIFEST: ConnectorManifest = {
  name: 'demo',
  version: '1.0.0',
  operations: {
    ping: { sideEffecting: false, idempotent: true, timeoutMs: 1_000 },
    send: { sideEffecting: true, idempotent: false, timeoutMs: 2_000 },
  },
};
const TABLE = { ping: { path: '/ping' }, send: { path: '/send' } };

describe('dispatchEntry', () => {
  it('returns the table entry with the manifest’s claim about it', () => {
    expect(dispatchEntry(MANIFEST, TABLE, 'send')).toEqual({
      entry: { path: '/send' },
      idempotent: false,
      timeoutMs: 2_000,
    });
  });

  it('refuses an undeclared operation by naming the declared ones', () => {
    expect(() => dispatchEntry(MANIFEST, TABLE, 'pong')).toThrow(/declares: ping, send/u);
  });
});

describe('connectorFailure', () => {
  it('does not retry a request that was wrong', () => {
    expect(
      connectorFailure('demo', new ConnectorInputError('invalid_input', 'no text'), 'x'),
    ).toEqual({
      status: 'error',
      error: { code: 'demo_invalid_input', retryable: false, message: 'no text' },
      attempts: 1,
    });
  });

  it('retries a refusal only when its status says "not now", and carries the attempts', () => {
    const limited = new ConnectorRejectionError(429, 'slow down');
    limited.attempts = 3;
    expect(connectorFailure('demo', limited, 'Demo refused')).toEqual({
      status: 'error',
      error: { code: 'demo_rejected_429', retryable: true, message: 'Demo refused' },
      attempts: 3,
    });
    expect(connectorFailure('demo', new ConnectorRejectionError(403, 'no'), 'm').error).toEqual({
      code: 'demo_rejected_403',
      retryable: false,
      message: 'm',
    });
  });

  it('names an error status, and never echoes the remote body', () => {
    const result = connectorFailure(
      'demo',
      new ConnectorHttpError(502, 'token=secret'),
      'Demo failed',
    );
    expect(result.error).toEqual({ code: 'demo_502', retryable: true, message: 'Demo failed' });
  });

  it('reports a transport failure as not retryable by this policy', () => {
    expect(connectorFailure('demo', new TypeError('fetch failed'), 'Demo failed').error).toEqual({
      code: 'demo_transport_failed',
      retryable: false,
      message: 'Demo failed',
    });
  });
});
