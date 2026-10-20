import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lifecycle, closeHttpServer, installShutdownHandlers } from './lifecycle.js';

describe('the process lifecycle', () => {
  it('closes what it was given in the reverse order it was given it', async () => {
    const closed: string[] = [];
    const lifecycle = new Lifecycle();
    lifecycle.add('database pool', () => void closed.push('pool'));
    lifecycle.add('retention sweep', () => void closed.push('sweep'));
    lifecycle.add('http server', () => void closed.push('server'));

    await lifecycle.shutdown();

    // The server stops taking requests first and the pool goes last, so nothing is mid-query
    // when its connections are taken away.
    expect(closed).toEqual(['server', 'sweep', 'pool']);
  });

  it('waits for an asynchronous close before the next one starts', async () => {
    const events: string[] = [];
    const lifecycle = new Lifecycle();
    lifecycle.add('second', () => void events.push('second'));
    lifecycle.add('first', async () => {
      events.push('first:start');
      await new Promise((resolve) => setTimeout(resolve, 20));
      events.push('first:end');
    });

    await lifecycle.shutdown();

    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('keeps going when one close fails, and says which', async () => {
    const closed: string[] = [];
    const failures: Array<[string, unknown]> = [];
    const lifecycle = new Lifecycle((name, error) => failures.push([name, error]));
    lifecycle.add('pool', () => void closed.push('pool'));
    lifecycle.add('sweep', () => {
      throw new Error('sweep would not stop');
    });
    lifecycle.add('server', async () => {
      await Promise.resolve();
      throw new Error('server would not close');
    });

    await lifecycle.shutdown();

    expect(closed, 'the pool is still closed after two failures').toEqual(['pool']);
    expect(failures.map(([name]) => name)).toEqual(['server', 'sweep']);
    expect(String(failures[0]?.[1])).toContain('server would not close');
  });

  it('closes everything once, however many times it is asked', async () => {
    const closed: string[] = [];
    const lifecycle = new Lifecycle();
    lifecycle.add('pool', () => void closed.push('pool'));

    await Promise.all([lifecycle.shutdown(), lifecycle.shutdown()]);
    await lifecycle.shutdown();

    expect(closed).toEqual(['pool']);
  });

  it('has nothing to do when nothing was added', async () => {
    await expect(new Lifecycle().shutdown()).resolves.toBeUndefined();
  });
});

describe('shutdown on a signal', () => {
  const stubProcess = (): EventEmitter => new EventEmitter();

  it('shuts down on SIGTERM and SIGINT, and exits cleanly when everything closed', async () => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const emitter = stubProcess();
      const closed = vi.fn();
      const exit = vi.fn();
      const lifecycle = new Lifecycle();
      lifecycle.add('pool', closed);
      installShutdownHandlers(lifecycle, {
        process: emitter,
        exit,
        log: () => undefined,
        graceMs: 1_000,
      });

      emitter.emit(signal);
      await vi.waitFor(() => expect(exit).toHaveBeenCalled());

      expect(closed).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    }
  });

  it('exits non-zero when a close failed, so a supervisor sees an unclean stop', async () => {
    const emitter = stubProcess();
    const exit = vi.fn();
    const lifecycle = new Lifecycle(() => undefined);
    lifecycle.add('pool', () => {
      throw new Error('boom');
    });
    installShutdownHandlers(lifecycle, {
      process: emitter,
      exit,
      log: () => undefined,
      graceMs: 1_000,
    });

    emitter.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('gives up and exits non-zero when shutdown does not finish in time', async () => {
    const emitter = stubProcess();
    const exit = vi.fn();
    const lifecycle = new Lifecycle();
    lifecycle.add('stuck', () => new Promise<void>(() => undefined));
    installShutdownHandlers(lifecycle, {
      process: emitter,
      exit,
      log: () => undefined,
      graceMs: 30,
    });

    emitter.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 2_000 });

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not start a second shutdown on a second signal', async () => {
    const emitter = stubProcess();
    const exit = vi.fn();
    const closed = vi.fn();
    const lifecycle = new Lifecycle();
    lifecycle.add('pool', closed);
    installShutdownHandlers(lifecycle, {
      process: emitter,
      exit,
      log: () => undefined,
      graceMs: 1_000,
    });

    emitter.emit('SIGTERM');
    emitter.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalled());

    expect(closed).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('closing the HTTP server', () => {
  const servers: Server[] = [];
  afterEach(() => {
    for (const server of servers.splice(0)) server.closeAllConnections();
  });

  const listen = async (handler: Parameters<typeof createServer>[1]): Promise<Server> => {
    const server = createServer(handler);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return server;
  };
  const portOf = (server: Server): number => (server.address() as AddressInfo).port;

  it('stops listening and returns promptly when nothing is connected', async () => {
    const server = await listen((_req, res) => res.end('ok'));
    await closeHttpServer(server, 1_000);
    expect(server.listening).toBe(false);
  });

  it('lets a request that is already being answered finish', async () => {
    const server = await listen((_req, res) => {
      setTimeout(() => res.end('finished'), 100);
    });
    const body = new Promise<string>((resolve, reject) => {
      request({ host: '127.0.0.1', port: portOf(server), agent: false }, (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString()));
        res.on('end', () => resolve(text));
      })
        .on('error', reject)
        .end();
    });
    await new Promise((resolve) => setTimeout(resolve, 30));

    await closeHttpServer(server, 2_000);

    expect(await body).toBe('finished');
  });

  it('cuts off a stream that never ends once the grace period is spent', async () => {
    // A server-sent-events response: headers sent, body never finished.
    const server = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: hello\n\n');
    });
    const ended = new Promise<void>((resolve) => {
      request({ host: '127.0.0.1', port: portOf(server), agent: false }, (res) => {
        res.on('data', () => undefined);
        res.on('close', () => resolve());
        res.on('error', () => resolve());
      })
        .on('error', () => resolve())
        .end();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const started = Date.now();
    await closeHttpServer(server, 150);

    await ended;
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(server.listening).toBe(false);
  });
});
