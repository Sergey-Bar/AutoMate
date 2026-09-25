import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createReporterRoutes } from '../routes/reporter.js';
import { InMemoryRunRepository } from '../repositories/in-memory-run-repository.js';

async function send(app: Hono, body: Record<string, unknown>): Promise<void> {
  const response = await app.request('/api/v1/reporter/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(202);
}

describe('reporter duplicate counter handling', () => {
  it('does not count the same terminal test event twice', async () => {
    const repository = new InMemoryRunRepository();
    const app = new Hono().route('/', createReporterRoutes(undefined, { repository }));
    await send(app, { type: 'run:start', runId: 'dedupe-run', payload: { total: 1 } });
    await send(app, {
      type: 'test:begin',
      runId: 'dedupe-run',
      payload: { testId: 'test-1', title: 'test' },
    });
    const event = {
      type: 'test:end',
      runId: 'dedupe-run',
      payload: { testId: 'test-1', status: 'passed', durationMs: 10 },
    };
    await send(app, event);
    await send(app, event);
    const run = await repository.getRun('dedupe-run');
    expect(run?.passed).toBe(1);
    expect(run?.total).toBe(1);
  });
});
