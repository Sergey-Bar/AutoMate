import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './main.js';
import { PostgresExecutionStore } from './postgres-store.js';

/**
 * The production composition: config -> store -> worker -> health server, and the
 * shutdown that unwinds it. The store's I/O is stubbed at the prototype, so the
 * composition is the real one and no database is needed.
 *
 * A signal is delivered by calling the listener `main` registered, which is the
 * function Node would call — without sending a real signal to the test runner.
 */

const ENV = {
  DATABASE_URL: 'postgres://worker@127.0.0.1:1/automate',
  WORKER_HEALTH_HOST: '127.0.0.1',
  WORKER_HEALTH_PORT: '0',
  WORKER_POLL_INTERVAL_MS: '100',
};

type Listener = (...args: unknown[]) => void;

afterEach(() => {
  vi.restoreAllMocks();
});

function listenerCounts(): Record<string, number> {
  return Object.fromEntries(
    (['SIGINT', 'SIGTERM', 'unhandledRejection', 'uncaughtException'] as const).map((event) => [
      event,
      process.listenerCount(event),
    ]),
  );
}

/** Starts `main`, waits for the health server, and returns what a test needs. */
async function started(): Promise<{
  running: Promise<void>;
  port: number;
  signal: (name: 'SIGINT' | 'SIGTERM') => void;
}> {
  const before = {
    SIGINT: new Set(process.listeners('SIGINT')),
    SIGTERM: new Set(process.listeners('SIGTERM')),
  };
  const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const running = main(ENV);
  await vi.waitFor(() => expect(info).toHaveBeenCalled());
  const message = String(info.mock.calls[0]?.[0]);
  const match = /^automate-worker listening on http:\/\/127\.0\.0\.1:(\d+)$/.exec(message);
  if (!match?.[1]) throw new Error(`unexpected banner: ${message}`);
  const signal = (name: 'SIGINT' | 'SIGTERM'): void => {
    const added = process.listeners(name).filter((listener) => !before[name].has(listener));
    expect(added).toHaveLength(1);
    (added[0] as Listener)(name);
  };
  return { running, port: Number(match[1]), signal };
}

function stubStore(ping: () => Promise<boolean>): { close: ReturnType<typeof vi.fn> } {
  vi.spyOn(PostgresExecutionStore.prototype, 'ping').mockImplementation(ping);
  vi.spyOn(PostgresExecutionStore.prototype, 'reapExpiredLeases').mockResolvedValue([]);
  vi.spyOn(PostgresExecutionStore.prototype, 'listDueSchedules').mockResolvedValue([]);
  vi.spyOn(PostgresExecutionStore.prototype, 'listDueReportSchedules').mockResolvedValue([]);
  const close = vi.fn(() => Promise.resolve());
  vi.spyOn(PostgresExecutionStore.prototype, 'close').mockImplementation(close);
  return { close };
}

describe('main', () => {
  it('serves readiness once the worker has polled, and unwinds on SIGTERM', async () => {
    const counts = listenerCounts();
    const { close } = stubStore(() => Promise.resolve(true));

    const { running, port, signal } = await started();
    await vi.waitFor(async () => {
      expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(200);
    });
    signal('SIGTERM');
    await running;

    expect(close).toHaveBeenCalledTimes(1);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
    // Signal and process-failure handlers are all removed: none outlives `main`.
    expect(listenerCounts()).toEqual(counts);
  });

  it('logs a failed poll by name only, stays unready, and unwinds on SIGINT', async () => {
    const counts = listenerCounts();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { close } = stubStore(() =>
      Promise.reject(new TypeError(`connect failed for ${ENV.DATABASE_URL}`)),
    );

    const { running, port, signal } = await started();
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith('automate-worker poll failed (TypeError)'),
    );
    expect((await fetch(`http://127.0.0.1:${port}/ready`)).status).toBe(503);
    signal('SIGINT');
    await running;

    expect(close).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls.flat().join('\n')).not.toContain('postgres://');
    expect(listenerCounts()).toEqual(counts);
  });

  it('logs a non-Error poll failure under a fixed code', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stubStore(vi.fn<() => Promise<boolean>>().mockRejectedValue('down'));

    const { running, signal } = await started();
    await vi.waitFor(() =>
      expect(errors).toHaveBeenCalledWith('automate-worker poll failed (WORKER_POLL_FAILED)'),
    );
    signal('SIGTERM');
    await running;
  });

  it('rejects an invalid configuration before starting anything', async () => {
    const counts = listenerCounts();
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(main({ DATABASE_URL: 'https://not-postgres.test' })).rejects.toThrow(
      /PostgreSQL URL/,
    );

    expect(info).not.toHaveBeenCalled();
    expect(listenerCounts()).toEqual(counts);
  });
});
