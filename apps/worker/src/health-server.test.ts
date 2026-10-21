import { afterEach, describe, expect, it } from 'vitest';
import { WorkerHealthServer, type WorkerHealthOptions } from './health-server.js';

const servers: WorkerHealthServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function server(isReady: WorkerHealthOptions['isReady'] = () => true): WorkerHealthServer {
  const created = new WorkerHealthServer({ host: '127.0.0.1', port: 0, version: '9.9.9', isReady });
  servers.push(created);
  return created;
}

describe('WorkerHealthServer', () => {
  it('reports liveness with the service and version', async () => {
    const port = await server().listen();

    const response = await fetch(`http://127.0.0.1:${port}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toMatchObject({
      status: 'healthy',
      service: 'automate-worker',
      version: '9.9.9',
      timestamp: expect.any(String),
    });
  });

  it('answers 404 with a stable code for any other route', async () => {
    const port = await server().listen();

    const response = await fetch(`http://127.0.0.1:${port}/metrics`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    });
  });

  it('ignores the query string when routing', async () => {
    const port = await server().listen();

    const response = await fetch(`http://127.0.0.1:${port}/ready?probe=kubelet`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready' });
  });

  it('awaits an asynchronous readiness check', async () => {
    const port = await server(() => Promise.resolve(false)).listen();

    const response = await fetch(`http://127.0.0.1:${port}/ready`);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: 'not_ready' });
  });

  it('reports not ready, rather than failing the request, when the check throws', async () => {
    const port = await server(() => Promise.reject(new Error('db down'))).listen();

    const response = await fetch(`http://127.0.0.1:${port}/ready`);

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('db down');
  });

  it('returns the bound port again rather than listening twice', async () => {
    const target = server();
    const first = await target.listen();

    await expect(target.listen()).resolves.toBe(first);
    expect((await fetch(`http://127.0.0.1:${first}/health`)).status).toBe(200);
  });

  it('rejects when the port is taken', async () => {
    const port = await server().listen();
    const clash = new WorkerHealthServer({
      host: '127.0.0.1',
      port,
      version: '1',
      isReady: () => true,
    });
    servers.push(clash);

    await expect(clash.listen()).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });

  it('stops serving once closed, and closing again is harmless', async () => {
    const target = server();
    const port = await target.listen();

    await target.close();
    await target.close();

    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it('closes cleanly when it never listened', async () => {
    await expect(server().close()).resolves.toBeUndefined();
  });
});
