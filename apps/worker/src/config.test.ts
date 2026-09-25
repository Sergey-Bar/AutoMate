import { afterEach, describe, expect, it } from 'vitest';
import { parseWorkerConfig } from './config.js';
import { WorkerHealthServer } from './health-server.js';

const servers: WorkerHealthServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('worker process boundaries', () => {
  it('parses safe queue and health limits', () => {
    const config = parseWorkerConfig({
      DATABASE_URL: 'postgresql://postgres@localhost/automate',
      WORKER_MAX_ATTEMPTS: '4',
      WORKER_WORKSPACE_QUOTA: '12',
    });
    expect(config).toMatchObject({ maxAttempts: 4, workspaceQuota: 12, healthPort: 3001 });
    expect(() => parseWorkerConfig({ DATABASE_URL: 'https://database.test' })).toThrow();
  });

  it('serves liveness and DB-gated readiness without leaking configuration', async () => {
    let ready = true;
    const server = new WorkerHealthServer({
      host: '127.0.0.1',
      port: 0,
      version: '1.0.0',
      isReady: () => ready,
    });
    servers.push(server);
    const port = await server.listen();
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const readiness = await fetch(`http://127.0.0.1:${port}/ready`);
    ready = false;
    const unavailable = await fetch(`http://127.0.0.1:${port}/ready`);

    expect(health.status).toBe(200);
    expect(readiness.status).toBe(200);
    expect(unavailable.status).toBe(503);
    expect(await health.text()).not.toContain('database');
  });
});
