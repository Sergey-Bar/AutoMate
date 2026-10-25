import {
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  connectorFailure,
  dispatchEntry,
  executeWithRetry,
  type ConnectorAdapter,
  type ConnectorRequest,
  type ConnectorResult,
} from '@automate/connectors-sdk';

/**
 * Microsoft Teams, through a Workflows webhook.
 *
 * Office 365 connectors (the old "Incoming Webhook") are retired; a Teams channel now takes
 * messages from a Power Automate *Workflows* webhook, whose URL is the whole credential. So
 * the secret this adapter is handed is that URL, and the one operation posts a message
 * carrying an Adaptive Card to it. A Workflows endpoint answers `202 Accepted` and does the
 * posting asynchronously, so 2xx is the delivery this adapter can see.
 *
 * Only an `https:` URL with no userinfo is called. A 429 is the platform saying it did not
 * accept the request, so it is a refusal and safe to retry; a 5xx after a post may have been
 * accepted, so it is not retried for a non-idempotent post.
 */

interface TeamsOperation {
  /** The input field holding the message body. */
  readonly field: string;
}

const OPERATIONS: Record<string, TeamsOperation> = {
  postCard: { field: 'message' },
};

function webhookUrl(secret: string): URL {
  let url: URL;
  try {
    url = new URL(secret);
  } catch {
    throw new ConnectorInputError('invalid_webhook', 'The Teams webhook is not a URL');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new ConnectorInputError('invalid_webhook', 'The Teams webhook must be an https URL');
  }
  return url;
}

function messageOf(input: unknown, field: string): Record<string, unknown> {
  const value =
    typeof input === 'object' && input !== null
      ? (input as Record<string, unknown>)[field]
      : undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ConnectorInputError('invalid_input', `input.${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

export const teamsAdapter: ConnectorAdapter = {
  manifest: {
    name: 'teams',
    version: '1.0.0',
    operations: {
      postCard: { sideEffecting: true, idempotent: false, timeoutMs: 15_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      const { entry, idempotent, timeoutMs } = dispatchEntry(
        teamsAdapter.manifest,
        OPERATIONS,
        request.operation,
      );
      const message = messageOf(request.input, entry.field);
      const url = webhookUrl(secret);
      const value = await executeWithRetry(
        async (signal) => {
          const response = await fetch(url.href, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message),
            redirect: 'error',
            signal,
          });
          if (response.status === 429) {
            throw new ConnectorRejectionError(429, 'Teams is rate limiting this webhook');
          }
          if (!response.ok) throw new ConnectorHttpError(response.status, 'Teams request failed');
          return { accepted: response.status };
        },
        { retries: 2, signal: request.signal, idempotent, attemptTimeoutMs: timeoutMs },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return connectorFailure('teams', error, 'Teams operation failed');
    }
  },
};
