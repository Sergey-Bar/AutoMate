export interface ConnectorManifest {
  name: string;
  version: string;
  operations: Record<string, { sideEffecting: boolean; idempotent: boolean; timeoutMs: number }>;
}

export interface ConnectorRequest {
  operation: string;
  input: unknown;
  signal?: AbortSignal;
}

export interface ConnectorResult {
  status: 'ok' | 'error';
  data?: unknown;
  error?: { code: string; retryable: boolean; message: string };
  attempts: number;
}

export interface ConnectorAdapter {
  manifest: ConnectorManifest;
  execute(request: ConnectorRequest, secret: string): Promise<ConnectorResult>;
}

export function isRetryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

export class ConnectorHttpError extends Error {
  /**
   * How many attempts were actually made, including this one.
   *
   * Set by {@link executeWithRetry} when it gives up, because the error is
   * constructed inside the caller's operation and cannot know the count itself.
   * An adapter reporting `attempts: 1` after three HTTP calls is a wrong number in
   * an evidence trail, and `attempts` is the field that tells a reader whether a
   * failure was retried.
   */
  attempts = 1;

  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** How many attempts a failed operation actually made, for an honest result. */
export function attemptsOf(error: unknown): number {
  return error instanceof ConnectorHttpError ? error.attempts : 1;
}

export async function executeWithRetry<T>(
  operation: () => Promise<T>,
  options: { retries: number; signal?: AbortSignal; sleep?: (ms: number) => Promise<void> },
): Promise<{ value: T; attempts: number }> {
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let attempts = 0;
  while (true) {
    attempts += 1;
    try {
      return { value: await operation(), attempts };
    } catch (error) {
      const retryable = error instanceof ConnectorHttpError && isRetryableStatus(error.status);
      if (!retryable || attempts > options.retries) {
        if (error instanceof ConnectorHttpError) error.attempts = attempts;
        throw error;
      }
      // Checked before the backoff, not after. A cancelled caller has already
      // given up, and making it wait out a 400ms sleep before the cancellation is
      // honoured is time the caller has already decided not to spend.
      if (options.signal?.aborted) throw new Error('Connector operation cancelled');
      await sleep(100 * 2 ** (attempts - 1));
    }
  }
}
