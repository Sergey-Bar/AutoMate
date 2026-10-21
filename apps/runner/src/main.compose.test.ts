import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { RunnerApiClientOptions } from './client.js';
import type { RunnerServiceOptions } from './runner-service.js';
import { readStoredToken, writeStoredToken } from './token-store.js';

/**
 * The composition in `main()`, with the two collaborators that talk to the
 * network or loop forever replaced. Everything else — config parsing, the token
 * store, the spool, both execution adapters and the health server — is real, so
 * what is asserted is how `main` wires them together.
 */
const state = vi.hoisted(() => ({
  clients: [] as Array<{
    instance: unknown;
    options: unknown;
    register: ReturnType<typeof vi.fn>;
  }>,
  register: undefined as undefined | ((request: unknown) => Promise<unknown>),
  services: [] as Array<{ options: unknown; stop: ReturnType<typeof vi.fn> }>,
  run: undefined as undefined | ((signal: AbortSignal | undefined) => Promise<void>),
}));

vi.mock('./client.js', () => ({
  RunnerApiClient: class {
    readonly register: ReturnType<typeof vi.fn>;

    constructor(readonly options: unknown) {
      this.register = vi.fn((request: unknown) =>
        state.register
          ? state.register(request)
          : Promise.resolve({ runnerId: 'issued-runner', token: 'issued-token' }),
      );
      state.clients.push({ instance: this, options, register: this.register });
    }
  },
}));

vi.mock('./runner-service.js', () => ({
  RunnerService: class {
    readonly stop = vi.fn();

    constructor(readonly options: unknown) {
      state.services.push({ options, stop: this.stop });
    }

    isReady(): boolean {
      return true;
    }

    run(signal?: AbortSignal): Promise<void> {
      return state.run ? state.run(signal) : Promise.resolve();
    }
  },
}));

const { main } = await import('./main.js');

let spoolRoot: string;
let workspaceRoot: string;
let listening: MockInstance<Console['info']>;
let errors: MockInstance<Console['error']>;

beforeEach(async () => {
  spoolRoot = await mkdtemp(join(tmpdir(), 'runner-main-spool-'));
  workspaceRoot = await mkdtemp(join(tmpdir(), 'runner-main-work-'));
  listening = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  state.clients.length = 0;
  state.services.length = 0;
  state.register = undefined;
  state.run = undefined;
  vi.useRealTimers();
  vi.restoreAllMocks();
  await Promise.all(
    [spoolRoot, workspaceRoot].map((path) => rm(path, { recursive: true, force: true })),
  );
});

function env(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const base: Record<string, string | undefined> = {
    AUTOMATE_API_URL: 'http://127.0.0.1:9/',
    RUNNER_INSTANCE_ID: 'runner-a',
    RUNNER_REGISTRATION_SECRET: 'registration-secret-value',
    RUNNER_SPOOL_ROOT: spoolRoot,
    RUNNER_WORKSPACE_ROOT: workspaceRoot,
    RUNNER_HEALTH_HOST: '127.0.0.1',
    RUNNER_HEALTH_PORT: '0',
    RUNNER_SLOTS: '4',
    RUNNER_MAX_CONCURRENCY: '2',
    RUNNER_REDACT_VALUES: 'customer-acme',
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(base).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );
}

function clientOptions(index: number): RunnerApiClientOptions {
  return state.clients[index]?.options as RunnerApiClientOptions;
}

function serviceOptions(): RunnerServiceOptions {
  return state.services[0]?.options as RunnerServiceOptions;
}

function healthPort(): number {
  const line = listening.mock.calls
    .map((call) => String(call[0]))
    .find((message) => message.startsWith('automate-runner listening on'));
  const port = Number(line?.split(':').at(-1));
  expect(port).toBeGreaterThan(0);
  return port;
}

interface ListenerCounts {
  SIGINT: number;
  SIGTERM: number;
  unhandledRejection: number;
  uncaughtException: number;
}

function listenerCounts(): ListenerCounts {
  return {
    SIGINT: process.listenerCount('SIGINT'),
    SIGTERM: process.listenerCount('SIGTERM'),
    unhandledRejection: process.listenerCount('unhandledRejection'),
    uncaughtException: process.listenerCount('uncaughtException'),
  };
}

describe('runner main composition', () => {
  it('registers, stores the issued token, and builds the service on the issued identity', async () => {
    let readyDuringRun: number | undefined;
    state.run = async () => {
      readyDuringRun = (await fetch(`http://127.0.0.1:${healthPort()}/ready`)).status;
    };

    await main(env());

    expect(state.clients).toHaveLength(2);
    expect(clientOptions(0)).toMatchObject({
      baseUrl: 'http://127.0.0.1:9',
      runnerId: 'runner-a',
      token: '',
      registrationSecret: 'registration-secret-value',
    });
    expect(state.clients[0]?.register).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolVersion: '1',
        runnerId: 'runner-a',
        name: 'automate-playwright-runner-runner-a',
        slots: 2,
        os: process.platform,
        arch: process.arch,
      }),
    );
    expect(clientOptions(1)).toMatchObject({ runnerId: 'issued-runner', token: 'issued-token' });
    await expect(readStoredToken(spoolRoot, 'issued-runner')).resolves.toBe('issued-token');

    const options = serviceOptions();
    expect(options.runnerId).toBe('issued-runner');
    expect(options.slots).toBe(2);
    expect(options.protocol).toBe(state.clients[1]?.instance);
    expect(options.redactions).toEqual(
      expect.arrayContaining(['customer-acme', 'registration-secret-value', 'issued-token']),
    );
    // The generated spool key is a secret too, and is redacted alongside the others.
    expect(options.redactions).toHaveLength(4);
    expect(readyDuringRun).toBe(200);
  });

  it('closes the health server and removes every process listener once the service returns', async () => {
    const before = listenerCounts();
    let during: ListenerCounts | undefined;
    let port = 0;
    state.run = () => {
      during = listenerCounts();
      port = healthPort();
      return Promise.resolve();
    };

    await main(env());

    expect(during).toEqual({
      SIGINT: before.SIGINT + 1,
      SIGTERM: before.SIGTERM + 1,
      unhandledRejection: before.unhandledRejection + 1,
      uncaughtException: before.uncaughtException + 1,
    });
    expect(listenerCounts()).toEqual(before);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it('presents the stored token on restart instead of registering as a stranger', async () => {
    await writeStoredToken(spoolRoot, 'runner-a', 'remembered-token');

    await main(env());

    expect(clientOptions(0)).toMatchObject({ runnerId: 'runner-a', token: 'remembered-token' });
  });

  it('skips registration entirely when a credential is configured', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');

    await main(
      env({
        RUNNER_REGISTRATION_SECRET: undefined,
        RUNNER_CREDENTIAL: 'configured-credential',
        RUNNER_SPOOL_KEY: 'spool-key-of-sufficient-length',
      }),
    );

    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.register).not.toHaveBeenCalled();
    expect(clientOptions(0)).toMatchObject({
      runnerId: 'runner-a',
      token: 'configured-credential',
    });
    expect(serviceOptions().runnerId).toBe('runner-a');
    expect(serviceOptions().redactions).toEqual([
      'customer-acme',
      'configured-credential',
      'spool-key-of-sufficient-length',
      'configured-credential',
    ]);
    await expect(readStoredToken(spoolRoot, 'runner-a')).resolves.toBe('');
    expect(setInterval).not.toHaveBeenCalled();
  });

  it('turns SIGTERM into an aborted lifecycle and a stopped service', async () => {
    const before = new Set(process.listeners('SIGTERM'));
    let aborted = false;
    state.run = async (signal) => {
      const added = process.listeners('SIGTERM').filter((listener) => !before.has(listener));
      expect(added).toHaveLength(1);
      expect(signal?.aborted).toBe(false);
      added[0]?.('SIGTERM');
      aborted = signal?.aborted ?? false;
      return Promise.resolve();
    };

    await main(env());

    expect(aborted).toBe(true);
    expect(state.services[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it('still closes the health server when the service fails', async () => {
    const before = listenerCounts();
    let port = 0;
    state.run = () => {
      port = healthPort();
      return Promise.reject(new Error('service crashed'));
    };

    await expect(main(env())).rejects.toThrow('service crashed');

    expect(listenerCounts()).toEqual(before);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });

  it('fails before starting anything when the configuration is invalid', async () => {
    await expect(main(env({ RUNNER_REGISTRATION_SECRET: undefined }))).rejects.toThrow(
      /RUNNER_REGISTRATION_SECRET or RUNNER_CREDENTIAL is required/u,
    );
    expect(state.clients).toHaveLength(0);
    expect(state.services).toHaveLength(0);
  });

  it('refreshes the registration every ten minutes and stores the rotated token', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let calls = 0;
    state.register = () => {
      calls += 1;
      return Promise.resolve(
        calls === 1
          ? { runnerId: 'issued-runner', token: 'issued-token' }
          : { runnerId: 'issued-runner', token: 'rotated-token' },
      );
    };
    state.run = async () => {
      vi.advanceTimersByTime(10 * 60_000);
      await vi.waitFor(async () => {
        await expect(readStoredToken(spoolRoot, 'issued-runner')).resolves.toBe('rotated-token');
      });
    };

    await main(env());

    expect(state.clients[1]?.register).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a failed refresh by error name only and keeps running', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    let calls = 0;
    state.register = () => {
      calls += 1;
      if (calls === 1) return Promise.resolve({ runnerId: 'issued-runner', token: 'issued-token' });
      const failure = new Error('secret issued-token rejected');
      failure.name = 'RunnerApiError';
      return Promise.reject(failure);
    };
    state.run = async () => {
      vi.advanceTimersByTime(10 * 60_000);
      await vi.waitFor(() => {
        expect(errors).toHaveBeenCalledWith(
          'automate-runner registration refresh failed (RunnerApiError)',
        );
      });
    };

    await main(env());

    expect(errors.mock.calls.flat().join('\n')).not.toContain('issued-token');
    await expect(readStoredToken(spoolRoot, 'issued-runner')).resolves.toBe('issued-token');
  });

  it('waits out an API that is not listening yet, and says so', async () => {
    let calls = 0;
    state.register = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError('fetch failed'))
        : Promise.resolve({ runnerId: 'issued-runner', token: 'issued-token' });
    };

    await main(env());

    expect(calls).toBe(2);
    expect(listening).toHaveBeenCalledWith(
      'automate-runner waiting for the API at http://127.0.0.1:9',
    );
    expect(serviceOptions().runnerId).toBe('issued-runner');
  });

  it('does not wait on an API that answered with a refusal', async () => {
    state.register = () => Promise.reject(new Error('RUNNER_ID_TAKEN'));

    await expect(main(env())).rejects.toThrow('RUNNER_ID_TAKEN');
    expect(state.services).toHaveLength(0);
  });
});
