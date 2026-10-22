import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HealthServer, type HealthServerOptions } from './health-server.js';

const servers: HealthServer[] = [];
const blockers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    blockers.splice(0).map(
      (server) =>
        new Promise<void>((resolveClose) => {
          server.close(() => resolveClose());
        }),
    ),
  );
});

function health(isReady: HealthServerOptions['isReady']): HealthServer {
  const server = new HealthServer({
    host: '127.0.0.1',
    port: 0,
    service: 'automate-runner',
    version: '9.9.9',
    isReady,
  });
  servers.push(server);
  return server;
}

async function get(
  port: number,
  path: string,
): Promise<{ status: number; type: string | null; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  return {
    status: response.status,
    type: response.headers.get('content-type'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe('HealthServer', () => {
  it('binds an ephemeral port and reports liveness with the service identity', async () => {
    const port = await health(() => true).listen();
    expect(port).toBeGreaterThan(0);

    const response = await get(port, '/health?probe=k8s');

    expect(response.status).toBe(200);
    expect(response.type).toBe('application/json');
    expect(response.body).toMatchObject({
      status: 'healthy',
      service: 'automate-runner',
      version: '9.9.9',
    });
    expect(Number.isNaN(Date.parse(String(response.body['timestamp'])))).toBe(false);
  });

  it('returns the same port when listen is called twice instead of binding again', async () => {
    const server = health(() => true);
    const first = await server.listen();
    const second = await server.listen();
    expect(second).toBe(first);
  });

  it('reports ready only while the readiness probe says so, sync or async', async () => {
    let ready = false;
    const port = await health(async () => Promise.resolve(ready)).listen();

    const before = await get(port, '/ready');
    expect(before.status).toBe(503);
    expect(before.body).toMatchObject({ status: 'not_ready', service: 'automate-runner' });

    ready = true;
    const after = await get(port, '/ready');
    expect(after.status).toBe(200);
    expect(after.body).toMatchObject({ status: 'ready', version: '9.9.9' });
  });

  it('treats a readiness probe that throws as not ready rather than crashing', async () => {
    const port = await health(() => {
      throw new Error('spool is unreadable');
    }).listen();

    const response = await get(port, '/ready');

    expect(response.status).toBe(503);
    expect(response.body['status']).toBe('not_ready');
    expect(JSON.stringify(response.body)).not.toContain('spool is unreadable');
  });

  it('answers an unknown route with a structured 404', async () => {
    const port = await health(() => true).listen();

    const response = await get(port, '/metrics');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('stops accepting connections after close, and a second close is a no-op', async () => {
    const server = health(() => true);
    const port = await server.listen();
    await server.close();

    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('can listen again after being closed', async () => {
    const server = health(() => true);
    await server.listen();
    await server.close();

    const port = await server.listen();
    expect((await get(port, '/health')).status).toBe(200);
  });

  it('rejects listen when the port is already taken', async () => {
    const blocker = createServer();
    blockers.push(blocker);
    const taken = await new Promise<number>((resolveListen) => {
      blocker.listen(0, '127.0.0.1', () => {
        const address = blocker.address();
        resolveListen(typeof address === 'object' && address ? address.port : 0);
      });
    });
    const server = new HealthServer({
      host: '127.0.0.1',
      port: taken,
      service: 'automate-runner',
      version: '1.0.0',
      isReady: () => true,
    });
    servers.push(server);

    await expect(server.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
