import {
  ConnectorHttpError,
  executeWithRetry,
  type ConnectorAdapter,
} from '@automate/connectors-sdk';

export const slackAdapter: ConnectorAdapter = {
  manifest: {
    name: 'slack',
    version: '1.0.0',
    operations: {
      authTest: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      postMessage: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
    },
  },
  async execute(request, secret) {
    try {
      const value = await executeWithRetry(
        async () => {
          const response = await fetch('https://slack.com/api/auth.test', {
            method: 'POST',
            headers: { authorization: `Bearer ${secret}` },
            signal: request.signal,
          });
          if (!response.ok) throw new ConnectorHttpError(response.status, 'Slack request failed');
          return response.json();
        },
        { retries: 2, signal: request.signal },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch {
      return {
        status: 'error',
        error: { code: 'slack_request_failed', retryable: true, message: 'Slack operation failed' },
        attempts: 1,
      };
    }
  },
};
