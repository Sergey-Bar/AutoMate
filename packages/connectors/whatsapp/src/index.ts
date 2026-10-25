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
 * WhatsApp, through Meta's Cloud API.
 *
 * A message a business starts — which every scheduled report is — must be an *approved
 * template*; free text is only allowed inside 24 hours of the recipient writing first. So
 * the one send operation is `sendTemplate`: the template's name and language, and the
 * rendered report as its single body parameter. The secret is the system-user access
 * token; the phone-number id is not secret and arrives in the input.
 *
 * Meta answers errors as `{ error: { code, message } }` with an HTTP status. The rate-limit
 * codes (4, 80007, 130429, 131048, 131056) mean nothing was sent and are retried as a 429
 * refusal; anything else keeps its status.
 */

const GRAPH = 'https://graph.facebook.com';
const DEFAULT_API_VERSION = 'v23.0';
const RATE_LIMIT_CODES = new Set([4, 80007, 130429, 131048, 131056]);

interface WhatsAppOperation {
  readonly path: (phoneNumberId: string) => string;
  readonly method: 'GET' | 'POST';
}

const OPERATIONS: Record<string, WhatsAppOperation> = {
  phoneNumber: { path: (id) => `/${id}`, method: 'GET' },
  sendTemplate: { path: (id) => `/${id}/messages`, method: 'POST' },
};

function apiVersion(input: unknown): string {
  const value =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)['apiVersion']
      : undefined;
  if (value === undefined) return DEFAULT_API_VERSION;
  if (typeof value !== 'string' || !/^v\d+\.\d+$/u.test(value)) {
    throw new ConnectorInputError('invalid_input', 'input.apiVersion must look like v23.0');
  }
  return value;
}

function phoneNumberIdOf(input: unknown): string {
  const id = requireString(input, 'phoneNumberId');
  if (!/^\d+$/u.test(id)) {
    throw new ConnectorInputError('invalid_input', 'input.phoneNumberId must be digits');
  }
  return id;
}

function templateBody(input: unknown): Record<string, unknown> {
  return {
    messaging_product: 'whatsapp',
    to: requireString(input, 'to'),
    type: 'template',
    template: {
      name: requireString(input, 'template'),
      language: { code: requireString(input, 'language') },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: requireString(input, 'text') }] },
      ],
    },
  };
}

function refusal(record: Record<string, unknown>, status: number): ConnectorHttpError {
  const error = record['error'];
  const code =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>)['code'] : null;
  if (typeof code === 'number' && RATE_LIMIT_CODES.has(code)) {
    return new ConnectorRejectionError(429, 'WhatsApp is rate limiting this number');
  }
  return status >= 500
    ? new ConnectorHttpError(status, 'WhatsApp request failed')
    : new ConnectorRejectionError(status, 'WhatsApp refused the request');
}

export const whatsappAdapter: ConnectorAdapter = {
  manifest: {
    name: 'whatsapp',
    version: '1.0.0',
    operations: {
      phoneNumber: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      sendTemplate: { sideEffecting: true, idempotent: false, timeoutMs: 15_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      const { entry, idempotent, timeoutMs } = dispatchEntry(
        whatsappAdapter.manifest,
        OPERATIONS,
        request.operation,
      );
      const url = `${GRAPH}/${apiVersion(request.input)}${entry.path(phoneNumberIdOf(request.input))}`;
      const body =
        entry.method === 'POST' ? JSON.stringify(templateBody(request.input)) : undefined;
      const value = await executeWithRetry(
        async (signal) => {
          const response = await fetch(url, {
            method: entry.method,
            headers: {
              authorization: `Bearer ${secret}`,
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
            },
            ...(body === undefined ? {} : { body }),
            signal,
          });
          const parsed: unknown = await response.json().catch(() => null);
          if (typeof parsed !== 'object' || parsed === null) {
            throw new ConnectorHttpError(response.status, 'WhatsApp response was not an object');
          }
          const record = parsed as Record<string, unknown>;
          if (!response.ok || 'error' in record) throw refusal(record, response.status);
          return record;
        },
        { retries: 2, signal: request.signal, idempotent, attemptTimeoutMs: timeoutMs },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return connectorFailure('whatsapp', error, 'WhatsApp operation failed');
    }
  },
};
