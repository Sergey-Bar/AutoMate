import {
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  connectorFailure,
  dispatchEntry,
  executeWithRetry,
  requireString,
  type ConnectorAdapter,
  type ConnectorRequest,
  type ConnectorResult,
} from '@automate/connectors-sdk';

/**
 * Signal, through a self-hosted `signal-cli-rest-api` bridge.
 *
 * Signal has no official API for bots or businesses. The established way to send from a
 * server is `bbernhard/signal-cli-rest-api`: a container linked to a Signal account
 * (a spare number, or this install as a linked device), answering `POST /v2/send`. The
 * bridge usually runs beside Automate on the same machine or LAN, so — unlike every other
 * connector here — a private `http:` address is expected. The secret is the bridge's base
 * URL, set by an admin; the account number and the recipients arrive in the input.
 *
 * The bridge answers 201 for a sent message and a 4xx JSON `{ error }` for one it refused;
 * a 5xx after a send may have reached Signal, so it is not retried for a send.
 */

interface SignalOperation {
  readonly path: string;
  readonly method: 'GET' | 'POST';
}

const OPERATIONS: Record<string, SignalOperation> = {
  about: { path: '/v1/about', method: 'GET' },
  send: { path: '/v2/send', method: 'POST' },
};

function bridgeBase(secret: string): string {
  let url: URL;
  try {
    url = new URL(secret);
  } catch {
    throw new ConnectorInputError('invalid_bridge', 'The Signal bridge is not a URL');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '') {
    throw new ConnectorInputError('invalid_bridge', 'The Signal bridge must be an http(s) URL');
  }
  return url.origin;
}

/** A 4xx is the bridge refusing (nothing sent); a 5xx may have reached Signal. */
function bridgeError(status: number): ConnectorHttpError {
  return status < 500
    ? new ConnectorRejectionError(status, 'The Signal bridge refused the request')
    : new ConnectorHttpError(status, 'The Signal bridge failed');
}

function sendBody(input: unknown): Record<string, unknown> {
  const recipients = requireString(input, 'recipients')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return {
    number: requireString(input, 'number'),
    recipients,
    message: requireString(input, 'message'),
  };
}

export const signalAdapter: ConnectorAdapter = {
  manifest: {
    name: 'signal',
    version: '1.0.0',
    operations: {
      about: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      send: { sideEffecting: true, idempotent: false, timeoutMs: 20_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      const { entry, idempotent, timeoutMs } = dispatchEntry(
        signalAdapter.manifest,
        OPERATIONS,
        request.operation,
      );
      const base = bridgeBase(secret);
      const body = entry.method === 'POST' ? JSON.stringify(sendBody(request.input)) : undefined;
      const value = await executeWithRetry(
        async (signal) => {
          const response = await fetch(`${base}${entry.path}`, {
            method: entry.method,
            ...(body === undefined
              ? {}
              : { headers: { 'content-type': 'application/json' }, body }),
            redirect: 'error',
            signal,
          });
          if (!response.ok) throw bridgeError(response.status);
          return (await response.json().catch(() => ({}))) as unknown;
        },
        { retries: 2, signal: request.signal, idempotent, attemptTimeoutMs: timeoutMs },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return connectorFailure('signal', error, 'Signal operation failed');
    }
  },
};
