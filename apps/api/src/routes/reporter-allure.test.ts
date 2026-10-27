import { describe, expect, it } from 'vitest';
import { reporterHarness } from '../test-support/reporter-harness.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';

/**
 * An Allure results document through the upload door a team migrating from Allure uses:
 * `POST /api/v1/reporter/upload` with `format=allure-results`. The format is declared
 * because JSON is JSON — nothing in the bytes says Allure.
 */
const START = Date.parse('2026-10-01T00:00:10.000Z');
const results = [
  {
    name: 'pays',
    status: 'passed',
    start: START,
    stop: START + 10,
    labels: [{ name: 'parentSuite', value: 'Checkout' }],
  },
  {
    name: 'refunds',
    status: 'broken',
    start: START,
    stop: START + 20,
    statusDetails: { message: 'boom' },
    labels: [{ name: 'parentSuite', value: 'Checkout' }],
  },
];

function upload(format: string) {
  const repository = new InMemoryRunRepository();
  const { app } = reporterHarness(undefined, { repository });
  const form = new FormData();
  form.set('format', format);
  form.set('runId', '0b9d6a5e-6f1a-4f3a-8c1e-2a7d1d1d1d1d');
  form.set(
    'file',
    new File([JSON.stringify(results)], 'allure.json', { type: 'application/json' }),
  );
  return {
    repository,
    send: () => app.request('/api/v1/reporter/upload', { method: 'POST', body: form }),
  };
}

describe('POST /api/v1/reporter/upload with format=allure-results', () => {
  it('records the run and its tests under the shared identity', async () => {
    const { repository, send } = upload('allure-results');
    const response = await send();
    expect(response.status).toBe(202);
    const run = await repository.getRun('0b9d6a5e-6f1a-4f3a-8c1e-2a7d1d1d1d1d');
    expect(run).toMatchObject({ status: 'failed', total: 2, passed: 1, failed: 1 });
    const stored = await repository.listTests('0b9d6a5e-6f1a-4f3a-8c1e-2a7d1d1d1d1d');
    expect(stored.map((test) => test.stableId).sort()).toEqual([
      'unknown.spec.ts › Checkout › pays',
      'unknown.spec.ts › Checkout › refunds',
    ]);
    expect(stored.find((test) => test.title === 'refunds')).toMatchObject({
      status: 'failed',
      errorMessage: 'boom',
    });
  });

  it('accepts the short spelling', async () => {
    expect((await upload('allure').send()).status).toBe(202);
  });
});
