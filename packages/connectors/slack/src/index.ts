import {
  attemptsOf,
  ConnectorHttpError,
  ConnectorInputError,
  ConnectorRejectionError,
  executeWithRetry,
  isRetryableStatus,
  optionalObject,
  operationSpec,
  requireString,
  type ConnectorAdapter,
  type ConnectorRequest,
  type ConnectorResult,
} from '@automate/connectors-sdk';

/**
 * The Slack Web API, by name.
 *
 * Every operation is a POST to `https://slack.com/api/<method>` with a bearer token and a
 * JSON body, and every operation refuses itself with **HTTP 200** and `ok: false`. That
 * second fact is the whole design constraint of this file: the transport succeeded, and
 * only the payload says whether the operation did. A dispatcher that stops at
 * `response.ok` reports every refusal as a success — which is what this adapter did, for
 * both of its declared operations.
 *
 * The `ok` error is a code (`channel_not_found`, `not_in_channel`, `invalid_auth`) and
 * Slack documents which of them are worth another attempt, so the retry decision reads the
 * body rather than the status line.
 */

interface SlackOperation {
  /** Slack method name — the last path segment. */
  readonly method: string;
  /** Required input fields, mapped to Slack's body keys. */
  readonly fields: readonly string[];
}

/**
 * The dispatch table, held separately from the manifest and cross-checked against it by a
 * test.
 *
 * A manifest entry with no dispatch entry is an operation a caller can read about and
 * cannot call, and that is exactly the defect this row describes: the manifest declared
 * `postMessage` and the adapter answered `auth.test` for every request.
 */
const OPERATIONS: Record<string, SlackOperation> = {
  authTest: { method: 'auth.test', fields: [] },
  postMessage: { method: 'chat.postMessage', fields: ['channel', 'text'] },
};

/** Slack error codes worth another attempt. */
const RETRYABLE_SLACK_ERRORS = new Set(['ratelimited', 'internal_error', 'service_unavailable']);

/**
 * The dispatch entry, or a refusal — before any I/O.
 *
 * `operationSpec` throws for an operation the manifest does not declare, and that refusal
 * names the declared spellings. This adapter's own table is checked against the manifest by
 * a test, so the two cannot drift apart the way the manifest and the code did.
 */
/**
 * The request for an operation, and the manifest's claim about it.
 *
 * One refusal, not two. `operationSpec` already refuses anything the manifest does
 * not declare, and `connector-dispatch.test.ts` asserts that every declared
 * operation has an entry in `OPERATIONS` across all three connectors — so a spec
 * that exists *is* a key that exists. The second check this function used to carry
 * was therefore unreachable, and the `void spec` beside it existed only to silence
 * the unused binding that unreachable branch needed.
 *
 * Returning both halves together is also what stops them being looked up twice: the
 * table said which operation to run, and the manifest said whether repeating it was
 * safe, and those are one decision.
 *
 * @throws {ConnectorInputError} `invalid_input` naming the declared spellings
 */
function dispatchFor(
  manifest: ConnectorAdapter['manifest'],
  operation: string,
): { operation: SlackOperation; idempotent: boolean } {
  const spec = operationSpec(manifest, operation);
  return { operation: OPERATIONS[operation], idempotent: spec.idempotent };
}

export const slackAdapter: ConnectorAdapter = {
  manifest: {
    name: 'slack',
    version: '1.0.0',
    operations: {
      authTest: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      postMessage: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
    },
  },

  async execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult> {
    try {
      // Both refusals happen before a request exists. An operation this adapter cannot
      // perform, or one whose input is incomplete, must not become a network call — the
      // old code sent `auth.test` in both cases and reported success.
      const { operation, idempotent } = dispatchFor(slackAdapter.manifest, request.operation);

      const body: Record<string, unknown> = {};
      for (const field of operation.fields) body[field] = requireString(request.input, field);
      Object.assign(body, optionalObject(request.input, 'fields'));

      const value = await executeWithRetry(
        async () => {
          const response = await fetch(`https://slack.com/api/${operation.method}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json; charset=utf-8',
              authorization: `Bearer ${secret}`,
            },
            body: JSON.stringify(body),
            signal: request.signal,
          });
          if (!response.ok) throw new ConnectorHttpError(response.status, 'Slack request failed');
          const parsed: unknown = await response.json();
          // A 200 is not an answer from Slack; it is a transport. This check has to
          // come *before* the `ok` inspection below, because that inspection was
          // guarded by `typeof parsed === 'object'` — so a 200 whose body was not an
          // object skipped the check entirely and was reported as `status: 'ok'` with
          // the body as the data. That is the same defect the `ok` check exists to
          // prevent, one level up: a response we cannot read is not a delivery.
          //
          // The status is real and is reported as `slack_200`, which reads as "Slack
          // answered 200 and the answer was unusable" — deliberately not a
          // `slack_transport_failed`, because a response did arrive, and not
          // retryable, because nothing says the request was refused.
          if (typeof parsed !== 'object' || parsed === null) {
            throw new ConnectorHttpError(response.status, 'Slack response body was not an object');
          }
          const record = parsed as Record<string, unknown>;
          if (record['ok'] === false) {
            const detail = slackRefusal(record);
            // A refusal is a claim that nothing happened, which is what separates it
            // from a 502 — so it is a `Rejection` and is retryable even though
            // `postMessage` is not idempotent.
            throw new ConnectorRejectionError(detail.status, `slack: ${detail.slackError}`);
          }
          return parsed;
        },
        { retries: 2, signal: request.signal, idempotent },
      );

      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      if (error instanceof ConnectorInputError) {
        // Not retryable, and not a remote failure: the caller sent something this adapter
        // cannot do, and repeating it verbatim will not change that.
        return {
          status: 'error',
          error: {
            code: `slack_${error.code}`,
            retryable: false,
            // The refusal's own message. See the same note in `jira`: these are
            // authored here, and replacing them with a fixed phrase discards the
            // actionable half — which operation names are real, which field was blank.
            message: error.message,
          },
          attempts: 1,
        };
      }

      // Three outcomes, and the code has to tell them apart or it is lying:
      //
      //  - Slack refused in the body (`ok: false`). It carries a code, it carries a status,
      //    and it is a claim that **nothing happened**.
      //  - Slack refused at the status line (401, 429, 5xx). Also carries a status, and it
      //    is a claim about the request.
      //  - Slack never answered. **No status at all**, so there is nothing to name and
      //    nothing to learn from it.
      //
      // A rejected credential and a socket hang-up are not the same event, and a first cut
      // that asked only "was this a Slack refusal?" collapsed both of the last two into
      // `slack_transport_failed` — which is the conflation in a different costume, because
      // a 401 is a server that answered. `attemptsOf` on a plain `Error` is 1, and
      // `executeWithRetry` does not retry a non-`ConnectorHttpError` at all, so the attempt
      // count is already right.
      const slackError = slackErrorOf(error);
      const status = error instanceof ConnectorHttpError ? error.status : undefined;
      const refusal = slackError !== undefined;

      return {
        status: 'error',
        error: {
          code: refusal
            ? 'slack_api_error'
            : status === undefined
              ? 'slack_transport_failed'
              : `slack_${String(status)}`,
          // From the evidence, not from a literal. The old error said `retryable: true` on
          // every failure, so a rejected credential and a momentary outage were reported
          // identically, and a caller that trusted the flag retried a 401 until its budget
          // was gone. A transport failure is not retryable **by this policy**: nothing came
          // back, so nothing says the request was refused, and repeating a non-idempotent
          // post is how one caller becomes two messages. The caller's own budget, not ours,
          // decides whether to try again.
          retryable: refusal ? RETRYABLE_SLACK_ERRORS.has(slackError) : isRetryableStatus(status),
          message: 'Slack operation failed',
        },
        attempts: attemptsOf(error),
      };
    }
  },
};

/**
 * `{"ok": false, "error": "…"}` turned into a status, so the retry policy can decide
 * from one number.
 *
 * Two facts, and keeping them apart is the whole content of this function. **Nothing
 * happened** is what makes a refusal safe to repeat for an operation that is not
 * idempotent — a `postMessage` rejected before acceptance cannot become a second message.
 * **This might clear on its own** is what makes it worth repeating at all. Conflating them,
 * as a first version did, retries `channel_not_found` three times: the channel is not
 * going to appear while the caller waits, and the three attempts cost the caller's whole
 * budget to learn what one said immediately.
 *
 * So the mapping is Slack's own guidance about which error codes are transient, with the
 * `retry-after` header as a second signal for the ones that do not name themselves.
 */
function slackRefusal(record: Record<string, unknown>): { slackError: string; status: number } {
  const headers = (record['headers'] ?? {}) as Record<string, unknown>;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  const slackError = typeof record['error'] === 'string' ? record['error'] : 'unknown_error';
  return {
    slackError,
    status: Number.isFinite(parsed) || RETRYABLE_SLACK_ERRORS.has(slackError) ? 429 : 400,
  };
}

/** The Slack error code, when the failure carries one. */
function slackErrorOf(error: unknown): string | undefined {
  if (!(error instanceof ConnectorRejectionError)) return undefined;
  const match = /^slack: (.+)$/.exec(error.message);
  return match?.[1];
}
