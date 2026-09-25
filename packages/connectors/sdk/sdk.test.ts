import { describe, expect, it, vi } from 'vitest';
import { ConnectorHttpError, executeWithRetry } from './src/index.js';

describe('connector SDK', () => {
  it('retries retryable statuses with bounded attempts', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ConnectorHttpError(503, 'offline'))
      .mockResolvedValue('ok');
    const result = await executeWithRetry(operation, { retries: 2, sleep: async () => undefined });
    expect(result).toEqual({ value: 'ok', attempts: 2 });
  });

  it('does not retry non-retryable errors', async () => {
    const operation = vi.fn().mockRejectedValue(new ConnectorHttpError(400, 'bad request'));
    await expect(
      executeWithRetry(operation, { retries: 2, sleep: async () => undefined }),
    ).rejects.toThrow('bad request');
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
