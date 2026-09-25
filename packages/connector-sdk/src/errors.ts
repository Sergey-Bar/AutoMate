export type ConnectorErrorKind = 'transient' | 'permanent' | 'unknown';

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly kind: ConnectorErrorKind,
    public readonly statusCode?: number,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'ConnectorError';
  }
}

// Classification helper - classifies based on HTTP status code
export function classifyHttpError(err: unknown): ConnectorError {
  const error = err instanceof Error ? err : new Error(String(err));
  const status = (error as Error & { status?: number }).status;

  if (status === 429 || (status !== undefined && status >= 500 && status <= 599 && status !== 501)) {
    return new ConnectorError(error.message, 'transient', status, { cause: error });
  }
  if (status !== undefined && ((status >= 400 && status < 500) || status === 501)) {
    return new ConnectorError(error.message, 'permanent', status, { cause: error });
  }
  // No HTTP status — classify as unknown (won't be retried by default)
  return new ConnectorError(error.message, 'unknown', undefined, { cause: error });
}

// Classify fetch Response object (for non-ok responses that should be retried)
export function classifyResponseStatus(status: number): ConnectorErrorKind {
  if (status === 429 || (status >= 500 && status <= 599 && status !== 501)) return 'transient';
  if ((status >= 400 && status < 500) || status === 501) return 'permanent';
  return 'unknown';
}
