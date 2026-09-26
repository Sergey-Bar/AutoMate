import {
  attemptsOf,
  ConnectorHttpError,
  executeWithRetry,
  type ConnectorAdapter,
} from '@automate/connectors-sdk';

export const jiraAdapter: ConnectorAdapter = {
  manifest: {
    name: 'jira',
    version: '1.0.0',
    operations: {
      getIssue: { sideEffecting: false, idempotent: true, timeoutMs: 10_000 },
      createIssue: { sideEffecting: true, idempotent: false, timeoutMs: 10_000 },
    },
  },
  async execute(request, secret) {
    try {
      const value = await executeWithRetry(
        async () => {
          const response = await fetch('https://your-domain.atlassian.net/rest/api/3/myself', {
            headers: { authorization: `Bearer ${secret}` },
            signal: request.signal,
          });
          if (!response.ok) throw new ConnectorHttpError(response.status, 'Jira request failed');
          return response.json();
        },
        { retries: 2, signal: request.signal },
      );
      return { status: 'ok', data: value.value, attempts: value.attempts };
    } catch (error) {
      return {
        status: 'error',
        error: { code: 'jira_request_failed', retryable: true, message: 'Jira operation failed' },
        attempts: attemptsOf(error),
      };
    }
  },
};
