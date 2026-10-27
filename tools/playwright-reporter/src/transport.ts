/**
 * One queue of requests, sent in order, each retried a bounded number of times, none of
 * which can throw into the test run.
 *
 * **In order** because the route requires it: `run:start` before any test, `test:begin`
 * before its `test:end`, and an artifact only once its run exists. Playwright calls the
 * reporter synchronously and does not wait, so the order is the queue's to keep.
 *
 * **A failure is a line on stderr, never an exception.** A reporter that throws fails the
 * test run, and a dashboard being down is not a reason for a test suite to fail.
 */

export interface Request {
  /** What the line in the log calls it: `run:start`, `trace.zip`. */
  label: string;
  path: string;
  /** Built when the request is sent, so a trace is read only if it is going anywhere. */
  body: () => Promise<unknown>;
  /**
   * Whether every later request depends on this one. A `run:start` that never landed makes
   * every event after it about a run the server never heard of, so the queue stops there.
   */
  essential: boolean;
}

export interface TransportOptions {
  origin: URL;
  secret: string | undefined;
  fetch: typeof globalThis.fetch;
  log: (line: string) => void;
  retryDelayMs: number;
}

const ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30_000;

export class Transport {
  private tail: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: TransportOptions) {}

  enqueue(request: Request): void {
    this.tail = this.tail.then(() => this.send(request));
  }

  /** Resolves once everything enqueued so far has been sent or given up on. */
  drain(): Promise<void> {
    return this.tail;
  }

  private async send(request: Request): Promise<void> {
    if (this.stopped) return;
    let body: string;
    try {
      body = JSON.stringify(await request.body());
    } catch (failure) {
      this.warn(`${request.label} was not sent (${reason(failure)})`);
      return;
    }
    let last = '';
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      const outcome = await this.post(request.path, body);
      if (outcome === 'sent') return;
      if (typeof outcome === 'number') {
        // A refusal is an answer: the same request will be refused again.
        this.giveUp(request, `was refused with ${String(outcome)}`);
        return;
      }
      last = outcome.retry;
      if (attempt < ATTEMPTS) await delay(this.options.retryDelayMs * 2 ** (attempt - 1));
    }
    this.giveUp(request, `failed after ${String(ATTEMPTS)} attempts (${last})`);
  }

  /** Says why a request was abandoned, and stops the queue if everything after it depends on it. */
  private giveUp(request: Request, why: string): void {
    this.warn(`${request.label} ${why}`);
    if (request.essential) this.stopped = true;
  }

  /** `'sent'`, the status of a refusal, or the reason a retry might help. */
  private async post(path: string, body: string): Promise<'sent' | number | { retry: string }> {
    try {
      const response = await this.options.fetch(new URL(path, this.options.origin), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authorization(this.options.secret),
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return 'sent';
      if (response.status >= 500 || response.status === 429) {
        return { retry: `status ${String(response.status)}` };
      }
      return response.status;
    } catch (failure) {
      return { retry: reason(failure) };
    }
  }

  private warn(message: string): void {
    const secret = this.options.secret;
    const line = `AutoMate reporter: ${message}`;
    this.options.log(secret === undefined ? line : line.replaceAll(secret, '[redacted]'));
  }
}

/** The `authorization` header, or nothing when no credential is configured. */
function authorization(token: string | undefined): { authorization?: string } {
  return typeof token === 'string' ? { authorization: `Bearer ${token}` } : {};
}

function reason(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

function delay(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
