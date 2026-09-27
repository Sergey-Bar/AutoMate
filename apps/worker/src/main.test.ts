import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installProcessFailureHandlers,
  type ProcessFailure,
  type ProcessFailureReporter,
} from './main.js';

type ProcessListener = (reason: unknown, detail: unknown) => void;

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.restoreAllMocks();
});

/**
 * Installs the handlers and returns the listeners the installer actually added
 * to this process, diffed against what was already registered. Node dispatches
 * `unhandledRejection` and `uncaughtException` through exactly these listeners,
 * so invoking them is the same path a real failure takes — without a real
 * failure taking the test runner down with it.
 */
function install(report?: ProcessFailureReporter): {
  unhandledRejection: ProcessListener[];
  uncaughtException: ProcessListener[];
  added(): number;
} {
  const before = {
    unhandledRejection: new Set(process.listeners('unhandledRejection')),
    uncaughtException: new Set(process.listeners('uncaughtException')),
  };
  const dispose = installProcessFailureHandlers('automate-worker', report);
  disposers.push(dispose);
  const added = (): number =>
    process.listeners('unhandledRejection').filter((l) => !before.unhandledRejection.has(l))
      .length +
    process.listeners('uncaughtException').filter((l) => !before.uncaughtException.has(l)).length;
  return {
    unhandledRejection: process
      .listeners('unhandledRejection')
      .filter((listener) => !before.unhandledRejection.has(listener)) as ProcessListener[],
    uncaughtException: process
      .listeners('uncaughtException')
      .filter((listener) => !before.uncaughtException.has(listener)) as ProcessListener[],
    added,
  };
}

function rejected(value: unknown): Promise<unknown> {
  const promise = Promise.reject(value);
  // Keeps Node from reporting the rejection a second time, through a path the
  // test is not asserting on.
  void promise.catch(() => undefined);
  return promise;
}

describe('worker process failure handlers', () => {
  it('registers one handler per failure event and makes the failure loud', () => {
    const reports: ProcessFailure[] = [];
    const installed = install((failure) => reports.push(failure));
    expect(installed.added()).toBe(2);

    installed.unhandledRejection[0](new Error('lease renewal exploded'), rejected('inner failure'));
    installed.uncaughtException[0](
      new TypeError('undefined is not a function'),
      'uncaughtException',
    );

    expect(reports).toEqual([
      {
        service: 'automate-worker',
        kind: 'unhandledRejection',
        code: 'Error',
        message: 'lease renewal exploded',
        stack: expect.any(String),
      },
      {
        service: 'automate-worker',
        kind: 'uncaughtException',
        code: 'TypeError',
        message: 'undefined is not a function',
        stack: expect.any(String),
      },
    ]);
  });

  it('records a reason that is not an Error instead of dropping it', () => {
    const reports: ProcessFailure[] = [];
    const installed = install((failure) => reports.push(failure));

    installed.unhandledRejection[0]('rejected with a string', rejected(1));
    installed.uncaughtException[0](rejected('rejected value'), 'uncaughtException');

    expect(reports[0]).toMatchObject({
      kind: 'unhandledRejection',
      code: 'PROCESS_FAILURE',
      message: 'rejected with a string',
      stack: null,
    });
    expect(reports[1]).toMatchObject({
      kind: 'uncaughtException',
      code: 'PROCESS_FAILURE',
      message: '[object Promise]',
      stack: null,
    });
  });

  it('writes the failure to stderr when no reporter is supplied', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const installed = install();

    installed.unhandledRejection[0](new Error('store is unavailable'), Promise.resolve());

    expect(errors).toHaveBeenCalledWith(
      'automate-worker unhandledRejection (Error): store is unavailable',
    );
  });

  it('falls back to stderr and does not throw when the reporter itself fails', () => {
    const broken = vi.fn((): void => {
      throw new Error('reporter is broken');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const installed = install(broken);

    expect(() =>
      installed.unhandledRejection[0](new Error('store is unavailable'), Promise.resolve()),
    ).not.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledWith('automate-worker unhandledRejection (Error)');
  });

  it('does not throw when both the reporter and stderr are gone', () => {
    const broken = vi.fn((): void => {
      throw new Error('reporter is broken');
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {
      throw new Error('stderr is closed');
    });
    const installed = install(broken);

    expect(() =>
      installed.uncaughtException[0](new Error('escaped throw'), 'uncaughtException'),
    ).not.toThrow();
    expect(broken).toHaveBeenCalledTimes(1);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  it('removes both handlers when the process is shutting down', () => {
    const reports: ProcessFailure[] = [];
    const installed = install((failure) => reports.push(failure));
    expect(installed.added()).toBe(2);

    installed.unhandledRejection[0](new Error('boom'), Promise.resolve());
    disposers.splice(0).forEach((dispose) => dispose());

    expect(installed.added()).toBe(0);
    expect(reports).toHaveLength(1);
  });
});
