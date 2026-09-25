import {
  ConnectorHttpError,
  executeWithRetry,
  type ConnectorAdapter,
} from '@automate/connectors-sdk';

export const githubAdapter: ConnectorAdapter = {
  manifest: {
    name: 'github',
    version: '1.0.0',
    operations: {
      getRepository: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      createIssue: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
    },
  },
  async execute(request, _secret) {
    try {
      const value = await executeWithRetry(
        async () => {
          const response = await fetch('https://api.github.com', { signal: request.signal });
          if (!response.ok) throw new ConnectorHttpError(response.status, 'GitHub request failed');
          return response.json();
        },
        { retries: 2, signal: request.signal },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      const status = error instanceof ConnectorHttpError ? error.status : 500;
      return {
        status: 'error',
        error: {
          code: `github_${status}`,
          retryable: status >= 500,
          message: 'GitHub operation failed',
        },
        attempts: 1,
      };
    }
  },
};
