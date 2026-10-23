import { describe, expect, it, vi } from 'vitest';
import { RoutingExecutionAdapter, readGenericCommand } from './execution-router.js';
import {
  RunnerConfigurationError,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
} from './execution.js';

/**
 * The seam that decides which executor runs a job.
 *
 * ## Why this file needs a test more than any other in the runner
 *
 * Every security assertion about the generic mode is about **how** a command is
 * spawned, and `GenericSpawnAdapter` proves that through its recorded options. This
 * file decides **whether** it is used at all, from the shape of a job's
 * `configuration` — and that `configuration` arrives from a database and from other
 * runners. So the properties here are:
 *
 *  - a job with a command goes to the generic adapter, and nothing else;
 *  - a job with **neither** shape is a configuration failure, not a guess;
 *  - a job declaring **both** is a failure, because silently preferring one would
 *    execute a suite the operator did not ask for.
 */

/**
 * A stand-in executor.
 *
 * `as unknown as ExecutionResult` rather than a direct cast: the stub returns a
 * **partial** result on purpose — the router never reads any field of it — and a
 * direct cast to `ExecutionResult` would be a lie the compiler is right to refuse.
 * Going through `unknown` says what is meant: "this stands in for the whole thing,
 * and no assertion depends on the parts it omits".
 */
function stubProvider(): ExecutionProvider & {
  execute: ReturnType<typeof vi.fn>;
  cleanup: ReturnType<typeof vi.fn>;
} {
  return {
    execute: vi.fn().mockResolvedValue({
      status: 'passed',
      artifacts: [],
    } as unknown as ExecutionResult),
    cleanup: vi.fn().mockResolvedValue(undefined),
  };
}

const context = (overrides: Partial<ExecutionContext> = {}): ExecutionContext => ({
  jobId: 'job-1',
  deadlineMs: 1000,
  signal: new AbortController().signal,
  ...overrides,
});

describe('a job is routed by the shape of its own configuration', () => {
  it('sends a job with a command to the generic adapter', async () => {
    const generic = stubProvider();
    const playwright = stubProvider();
    const router = new RoutingExecutionAdapter(generic, playwright, stubProvider());

    await router.execute(
      context({ command: { argv: ['pytest'], workingDirectory: '.', artifactGlobs: [] } }),
    );

    expect(generic.execute).toHaveBeenCalledOnce();
    expect(playwright.execute).not.toHaveBeenCalled();
  });

  it('sends a job with no command to the Playwright adapter, unchanged', async () => {
    // The regression proof the plan asks for: the existing Playwright path must keep
    // working exactly as it did, because it is the one mode with real deployments.
    const generic = stubProvider();
    const playwright = stubProvider();
    const router = new RoutingExecutionAdapter(generic, playwright, stubProvider());

    await router.execute(context({ playwrightProject: 'chromium', targetUrl: 'https://a.test' }));

    expect(playwright.execute).toHaveBeenCalledOnce();
    expect(generic.execute).not.toHaveBeenCalled();
  });

  it('refuses a job declaring both a command and a Playwright project', async () => {
    const generic = stubProvider();
    const playwright = stubProvider();
    const router = new RoutingExecutionAdapter(generic, playwright, stubProvider());

    // Preferring one would execute the wrong suite against the wrong target and
    // report it as the operator's intent. Refusing is the only safe answer.
    await expect(
      router.execute(
        context({
          playwrightProject: 'chromium',
          command: { argv: ['rm', '-rf', '/'], workingDirectory: '.', artifactGlobs: [] },
        }),
      ),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
    expect(generic.execute).not.toHaveBeenCalled();
    expect(playwright.execute).not.toHaveBeenCalled();
  });

  it('sends a job naming an API collection to the API adapter, and to nothing else', async () => {
    const generic = stubProvider();
    const playwright = stubProvider();
    const api = stubProvider();
    const router = new RoutingExecutionAdapter(generic, playwright, stubProvider(), api);

    await router.execute(context({ apiCollection: 'pass', targetUrl: 'https://a.test' }));

    expect(api.execute).toHaveBeenCalledOnce();
    expect(generic.execute).not.toHaveBeenCalled();
    expect(playwright.execute).not.toHaveBeenCalled();
  });

  it('refuses an API collection combined with a command or a Playwright project', async () => {
    const api = stubProvider();
    const router = new RoutingExecutionAdapter(stubProvider(), stubProvider(), stubProvider(), api);
    const command = { argv: ['x'], workingDirectory: '.', artifactGlobs: [] };
    for (const other of [{ command }, { playwrightProject: 'chromium' }]) {
      await expect(
        router.execute(context({ apiCollection: 'pass', ...other })),
      ).rejects.toBeInstanceOf(RunnerConfigurationError);
    }
    expect(api.execute).not.toHaveBeenCalled();
  });

  it('refuses an API collection on a runner that has no API adapter', async () => {
    const router = new RoutingExecutionAdapter(stubProvider(), stubProvider(), stubProvider());
    await expect(router.execute(context({ apiCollection: 'pass' }))).rejects.toBeInstanceOf(
      RunnerConfigurationError,
    );
  });

  it('cleans up through the generic adapter', async () => {
    const generic = stubProvider();
    const router = new RoutingExecutionAdapter(generic, stubProvider(), stubProvider());
    await router.cleanup('/tmp/workspace');
    expect(generic.cleanup).toHaveBeenCalledWith('/tmp/workspace');
  });
});

describe('a load job goes to the k6 adapter, and only a load job does', () => {
  const k6 = { script: 'smoke.js', vus: 1, durationSeconds: 5 };

  it('sends a job carrying a k6 block to the k6 adapter', async () => {
    const [generic, playwright, k6Adapter] = [stubProvider(), stubProvider(), stubProvider()];
    const router = new RoutingExecutionAdapter(generic, playwright, k6Adapter);

    await router.execute(context({ k6, targetUrl: 'http://a.test' }));

    expect(k6Adapter.execute).toHaveBeenCalledOnce();
    expect(playwright.execute).not.toHaveBeenCalled();
    expect(generic.execute).not.toHaveBeenCalled();
  });

  it('refuses a job that mixes a k6 block with a command or a Playwright project', async () => {
    const [generic, playwright, k6Adapter] = [stubProvider(), stubProvider(), stubProvider()];
    const router = new RoutingExecutionAdapter(generic, playwright, k6Adapter);

    await expect(
      router.execute(context({ k6, playwrightProject: 'smoke-pass' })),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
    await expect(
      router.execute(
        context({ k6, command: { argv: ['sh'], workingDirectory: '.', artifactGlobs: [] } }),
      ),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
    expect(k6Adapter.execute).not.toHaveBeenCalled();
    expect(generic.execute).not.toHaveBeenCalled();
    expect(playwright.execute).not.toHaveBeenCalled();
  });
});
describe('a command is read out of a job spec, and validated before it spawns', () => {
  it('reads argv and globs out of a well-formed spec', () => {
    const command = readGenericCommand({
      command: {
        argv: ['pnpm', 'test'],
        workingDirectory: 'services/api',
        artifactGlobs: ['reports/*.xml'],
        env: ['CI_TOKEN'],
      },
    });
    expect(command?.argv).toEqual(['pnpm', 'test']);
    expect(command?.workingDirectory).toBe('services/api');
    expect(command?.artifactGlobs).toEqual(['reports/*.xml']);
    // A suite is held to the artifact rule unless the server said otherwise.
    expect(command?.evidence).toBe('artifact');
  });

  it('reads the exit-code evidence mode, and nothing else, out of the spec', () => {
    expect(
      readGenericCommand({ command: { argv: ['x'], repository: '/srv/repos/shop' } })?.repository,
    ).toBe('/srv/repos/shop');
    expect(readGenericCommand({ command: { argv: ['x'], repository: 7 } })).not.toHaveProperty(
      'repository',
    );
    expect(
      readGenericCommand({ command: { argv: ['pnpm', 'run', 'lint'], evidence: 'exit-code' } })
        ?.evidence,
    ).toBe('exit-code');
    expect(
      readGenericCommand({ command: { argv: ['pnpm', 'run', 'lint'], evidence: 'shell' } })
        ?.evidence,
    ).toBe('artifact');
  });

  it('returns nothing for a spec with no command, which is the Playwright case', () => {
    expect(readGenericCommand({ playwrightProject: 'chromium' })).toBeUndefined();
    expect(readGenericCommand({})).toBeUndefined();
  });

  it('refuses a command whose argv is not a non-empty array of strings', () => {
    // These arrive from a database and from other runners. A malformed argv reaching
    // `spawn` would be something no operator wrote, and `spawn` does not validate.
    for (const argv of [[], ['ok', 42], 'pytest', { not: 'an array' }]) {
      expect(() => readGenericCommand({ command: { argv } })).toThrow(RunnerConfigurationError);
    }
  });

  it('refuses a command that is not an object at all', () => {
    expect(() => readGenericCommand({ command: 'pytest' })).toThrow(RunnerConfigurationError);
  });

  it('looks declared variable names up in the runner environment, never the values', () => {
    // The spec names a variable; the runner supplies its value. A spec that could
    // carry a credential would be a credential in a database row.
    process.env['AUTOMATE_TEST_REDACT_ME'] = 'resolved-at-spawn-time';
    try {
      const command = readGenericCommand({
        command: { argv: ['pytest'], env: ['AUTOMATE_TEST_REDACT_ME', 'AUTOMATE_TEST_ABSENT'] },
      });
      expect(command?.env).toEqual({ AUTOMATE_TEST_REDACT_ME: 'resolved-at-spawn-time' });
      expect(Object.keys(command?.env ?? {})).toHaveLength(1);
    } finally {
      delete process.env['AUTOMATE_TEST_REDACT_ME'];
    }
  });

  it('drops a declared name that is unset, rather than sending an empty value', () => {
    const command = readGenericCommand({
      command: { argv: ['pytest'], env: ['AUTOMATE_TEST_DEFINITELY_ABSENT'] },
    });
    expect(command?.env).toEqual({});
  });

  it('defaults the working directory and drops a non-string glob rather than passing it on', () => {
    const command = readGenericCommand({
      command: { argv: ['pytest'], artifactGlobs: ['a.xml', 42, null] },
    });
    expect(command?.workingDirectory).toBe('.');
    expect(command?.artifactGlobs).toEqual(['a.xml']);
  });
});
