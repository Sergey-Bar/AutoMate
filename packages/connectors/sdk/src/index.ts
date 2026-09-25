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

export class ConnectorHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function isRetryableStatus(status: number): boolean {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
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
      if (!retryable || attempts > options.retries) throw error;
      await sleep(100 * 2 ** (attempts - 1));
      if (options.signal?.aborted) throw new Error('Connector operation cancelled');
    }
  }
}
