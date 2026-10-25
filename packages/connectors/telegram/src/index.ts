import {
  ConnectorHttpError,
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
 * The Telegram Bot API, for scheduled reports.
 *
 * Every method is `POST https://api.telegram.org/bot<token>/<method>` with a JSON body, and
 * every answer is `{ ok, result }` or `{ ok: false, error_code, description }` — usually
 * with the matching HTTP status, which is why a refusal is read from the body rather than
 * from `response.ok`. A refusal is a statement that nothing was sent, so it is a
 * `ConnectorRejectionError` and retried only when Telegram says "not now" (429, with
 * `parameters.retry_after`). The token is the secret; it is in the URL path, so it is never
 * put in an error message.
 */

const API = 'https://api.telegram.org';

interface TelegramOperation {
  readonly method: string;
  /** Required input fields, and the Bot API body key each becomes. */
  readonly fields: Readonly<Record<string, string>>;
  readonly extra: Readonly<Record<string, unknown>>;
}

const OPERATIONS: Record<string, TelegramOperation> = {
  getMe: { method: 'getMe', fields: {}, extra: {} },
  sendMessage: {
    method: 'sendMessage',
    fields: { chatId: 'chat_id', text: 'text' },
    // The report renderer writes Telegram HTML; previews would expand the dashboard link
    // into a card that is larger than the report.
    extra: { parse_mode: 'HTML', link_preview_options: { is_disabled: true } },
  },
};

function bodyFor(operation: TelegramOperation, input: unknown): Record<string, unknown> {
  const body: Record<string, unknown> = { ...operation.extra };
  for (const [field, key] of Object.entries(operation.fields)) {
    body[key] = requireString(input, field);
  }
  return body;
}

/** Telegram's own error code is the status worth acting on; the line may say 200. */
function refusalOf(record: Record<string, unknown>, response: Response): ConnectorRejectionError {
  const code = record['error_code'];
  const status =
    typeof code === 'number' && Number.isInteger(code) ? code : response.ok ? 400 : response.status;
  return new ConnectorRejectionError(status, 'Telegram refused the request');
}

export const telegramAdapter: ConnectorAdapter = {
  manifest: {
    name: 'telegram',
    version: '1.0.0',
    operations: {
      getMe: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      sendMessage: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      const { entry, idempotent, timeoutMs } = dispatchEntry(
        telegramAdapter.manifest,
        OPERATIONS,
        request.operation,
      );
      const body = bodyFor(entry, request.input);
      const value = await executeWithRetry(
        async (signal) => {
          const response = await fetch(`${API}/bot${secret}/${entry.method}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal,
          });
          const parsed: unknown = await response.json().catch(() => null);
          if (typeof parsed !== 'object' || parsed === null) {
            throw new ConnectorHttpError(response.status, 'Telegram response was not an object');
          }
          const record = parsed as Record<string, unknown>;
          if (record['ok'] !== true) throw refusalOf(record, response);
          return record['result'];
        },
        { retries: 2, signal: request.signal, idempotent, attemptTimeoutMs: timeoutMs },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return connectorFailure('telegram', error, 'Telegram operation failed');
    }
  },
};
