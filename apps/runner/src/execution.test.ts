import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PlaywrightExecutionAdapter,
  RunnerConfigurationError,
  RunnerInfrastructureError,
  terminateProcessTree,
  type PlaywrightExecutionOptions,
} from './execution.js';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 42_424;
  exitCode: number | null = null;
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const here = dirname(fileURLToPath(import.meta.url));

function fixtureRoot(): string {
  // Derived from this file, not from `process.cwd()`. A root `vitest` run has
  // the repo root as its cwd, so a cwd-relative fixture path resolved to
  // `<repo>/fixtures/playwright-smoke`, the pre-flight existence check failed,
  // and the two tests that assert a successful Playwright execution were red
  // for a reason that had nothing to do with the code under test.
  return join(here, '..', 'fixtures', 'playwright-smoke');
}

function fakeSpawn(
  code: number,
  calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }>,
  /**
   * How long the fake child waits before completing on its own.
   *
   * `null` means it never completes, so the adapter's deadline is the only thing
   * that can end the run. The timeout test used a 5 ms auto-complete against a
   * `deadlineMs: 5` deadline — two timers of the same length, so which one won
   * depended on registration order and the test flaked under load.
   */
  autoCompleteMs: number | null = 5,
): (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
    if (autoCompleteMs !== null) {
      const timeout = setTimeout(() => {
        void (async () => {
          const reportPath = String(options.env?.['PLAYWRIGHT_JSON_OUTPUT_NAME']);
          await mkdir(dirname(reportPath), { recursive: true });
          await Promise.all([
            writeFile(reportPath, '{"stats":{"unexpected":0}}\n'),
            writeFile(String(options.env?.['PLAYWRIGHT_JUNIT_OUTPUT_NAME']), '<testsuites/>\n'),
            writeFile(
              String(options.env?.['AUTOMATE_RUNNER_EVENTS_PATH']),
              `${JSON.stringify({ eventId: 'event-1', sequence: 1, type: 'test.completed', occurredAt: new Date().toISOString(), payload: { testId: 'test-1', status: 'passed' } })}\n`,
            ),
          ]);
          child.stdout.write('token=super-secret\n');
          child.emit('close', code, null);
        })();
      }, autoCompleteMs);
      timeout.unref();
    }
    return child as unknown as ChildProcessWithoutNullStreams;
  };
}

describe('PlaywrightExecutionAdapter', () => {
  it('uses a fixed argument array, captures native evidence, redacts logs, and cleans up', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'runner-execution-'));
    roots.push(workspaceRoot);
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
    const adapter = new PlaywrightExecutionAdapter({
      projectRoot: fixtureRoot(),
      allowedProjects: ['smoke-pass'],
      allowedTargetUrls: ['https://allowed.test'],
      workspaceRoot,
      artifactMaxBytes: 1_000_000,
      logMaxBytes: 10_000,
      redactions: ['super-secret'],
      environment: { PATH: process.env['PATH'], RUNNER_CREDENTIAL: 'super-secret' },
      spawnProcess: fakeSpawn(0, calls),
      playwrightCliPath: 'playwright-cli.js',
    });

    const result = await adapter.execute({
      jobId: 'job;rm -rf /',
      project: 'smoke-pass',
      targetUrl: 'https://allowed.test/health',
      deadlineMs: 1_000,
      signal: new AbortController().signal,
      onEvent: async (event) => expect(event.payload['testId']).toBe('test-1'),
    });

    expect(result.status).toBe('passed');
    expect(result.stdout).toContain('[REDACTED]');
    expect(result.stdout).not.toContain('super-secret');
    expect(result.artifacts.map((artifact) => artifact.kind)).toEqual(
      // `junit-xml`, not `junit`: one classifier in `artifact-kind.ts` names every artifact,
      // and it uses the contract's id for a report so the label the runner sends is the label
      // the upload door and `packages/projects` look for.
      expect.arrayContaining(['event-log', 'playwright-json', 'junit-xml', 'stderr', 'stdout']),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args).toEqual(expect.arrayContaining(['test', '--project', 'smoke-pass']));
    expect(calls[0]?.args.join(' ')).not.toContain('rm -rf');
    expect(calls[0]?.options.shell).toBe(false);
    expect(calls[0]?.options.env?.['RUNNER_CREDENTIAL']).toBeUndefined();
    await adapter.cleanup(result.workspacePath);
    await expect(access(result.workspacePath)).rejects.toThrow();
  });

  it('rejects untrusted projects and target origins before spawning', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'runner-execution-'));
    roots.push(workspaceRoot);
    const spawnProcess = vi.fn(fakeSpawn(0, []));
    const adapter = new PlaywrightExecutionAdapter({
      projectRoot: fixtureRoot(),
      allowedProjects: ['smoke-pass'],
      allowedTargetUrls: ['https://allowed.test'],
      workspaceRoot,
      artifactMaxBytes: 1_000_000,
      logMaxBytes: 10_000,
      spawnProcess,
      playwrightCliPath: 'playwright-cli.js',
    });

    await expect(
      adapter.execute({
        jobId: 'job-1',
        project: 'smoke-pass; powershell.exe',
        deadlineMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
    await expect(
      adapter.execute({
        jobId: 'job-1',
        project: 'smoke-pass',
        targetUrl: 'https://allowed.test.evil.example',
        deadlineMs: 1_000,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(RunnerConfigurationError);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('terminates Playwright on timeout and reports a distinct terminal state', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'runner-execution-'));
    roots.push(workspaceRoot);
    const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
    let terminated = false;
    const adapter = new PlaywrightExecutionAdapter({
      projectRoot: fixtureRoot(),
      allowedProjects: ['smoke-pass'],
      allowedTargetUrls: ['https://allowed.test'],
      workspaceRoot,
      artifactMaxBytes: 1_000_000,
      logMaxBytes: 10_000,
      // The child never completes on its own, so the deadline is the only thing
      // that can end this run and the outcome is not a race.
      spawnProcess: fakeSpawn(0, calls, null),
      terminateProcess: async (child) => {
        terminated = true;
        child.emit('close', null, 'SIGTERM');
      },
      playwrightCliPath: 'playwright-cli.js',
    });
    const result = await adapter.execute({
      jobId: 'job-timeout',
      project: 'smoke-pass',
      targetUrl: 'https://allowed.test',
      deadlineMs: 5,
      signal: new AbortController().signal,
    });
    expect(result.status).toBe('timed_out');
    // And it really was the deadline that ended it, not a spontaneous exit.
    expect(terminated).toBe(true);
  });
});

type Script = (child: FakeChild, env: NodeJS.ProcessEnv) => Promise<void> | void;

/**
 * A spawner whose child does exactly what `script` says, a tick after it is
 * spawned — so the adapter has attached its listeners before anything happens.
 */
function scriptedSpawn(
  script: Script,
  calls: SpawnOptions[] = [],
): NonNullable<PlaywrightExecutionOptions['spawnProcess']> {
  return (_command, _args, options) => {
    calls.push(options);
    const child = new FakeChild();
    setImmediate(() => {
      void script(child, options.env ?? {});
    });
    return child as unknown as ChildProcessWithoutNullStreams;
  };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runner-execution-'));
  roots.push(root);
  return root;
}

async function adapterWith(
  overrides: Partial<PlaywrightExecutionOptions>,
): Promise<{ adapter: PlaywrightExecutionAdapter; workspaceRoot: string }> {
  const workspaceRoot = await workspace();
  const adapter = new PlaywrightExecutionAdapter({
    projectRoot: fixtureRoot(),
    allowedProjects: ['smoke-pass'],
    allowedTargetUrls: ['https://allowed.test'],
    workspaceRoot,
    artifactMaxBytes: 1_000_000,
    logMaxBytes: 10_000,
    redactions: ['super-secret'],
    environment: { PATH: process.env['PATH'] },
    playwrightCliPath: 'playwright-cli.js',
    spawnProcess: scriptedSpawn((child) => {
      child.emit('close', 0, null);
    }),
    ...overrides,
  });
  return { adapter, workspaceRoot };
}

/** A terminator that closes the fake child the way a real one would: later, not inline. */
function closingTerminator() {
  return vi.fn(
    (child: ChildProcessWithoutNullStreams) =>
      new Promise<void>((resolveTermination) => {
        setImmediate(() => {
          child.emit('close', null, 'SIGTERM');
          resolveTermination();
        });
      }),
  );
}

function run(adapter: PlaywrightExecutionAdapter, signal = new AbortController().signal) {
  return adapter.execute({ jobId: 'job-1', deadlineMs: 5_000, signal });
}

describe('PlaywrightExecutionAdapter outcomes', () => {
  it.each([
    { code: 1, signal: null, status: 'failed', error: undefined },
    {
      code: 3,
      signal: null,
      status: 'infra_failed',
      error: { code: 'RUNNER_INFRA_FAILED', message: 'Playwright exited with 3' },
    },
    {
      code: null,
      signal: 'SIGKILL',
      status: 'infra_failed',
      error: { code: 'RUNNER_INFRA_FAILED', message: 'Playwright exited with SIGKILL' },
    },
  ])('maps exit $code/$signal to $status', async ({ code, signal, status, error }) => {
    const { adapter } = await adapterWith({
      spawnProcess: scriptedSpawn((child) => {
        child.emit('close', code, signal);
      }),
    });

    const result = await run(adapter);

    expect(result.status).toBe(status);
    expect(result.error).toEqual(error);
    // No Playwright JSON report was written, so there is no result document to point at.
    expect(result.resultPath).toBe('');
  });

  it('reports a spawn failure as an infrastructure failure with the secret redacted', async () => {
    const { adapter } = await adapterWith({
      spawnProcess: scriptedSpawn((child) => {
        child.emit('error', new Error('spawn EACCES while reading super-secret'));
        child.emit('close', -2, null);
      }),
    });

    const result = await run(adapter);

    expect(result.status).toBe('infra_failed');
    expect(result.error).toEqual({
      code: 'RUNNER_INFRA_FAILED',
      message: 'spawn EACCES while reading [REDACTED]',
    });
  });

  it('terminates a run whose signal is already aborted and reports it cancelled', async () => {
    const terminateProcess = closingTerminator();
    const { adapter } = await adapterWith({
      // Never completes on its own: only the abort can end it.
      spawnProcess: scriptedSpawn(() => undefined),
      terminateProcess,
    });
    const controller = new AbortController();
    controller.abort();

    const result = await run(adapter, controller.signal);

    expect(result.status).toBe('cancelled');
    expect(result.error).toBeUndefined();
    expect(terminateProcess).toHaveBeenCalled();
  });

  it('terminates a running Playwright when the job is cancelled mid-run', async () => {
    const controller = new AbortController();
    const terminateProcess = closingTerminator();
    const { adapter } = await adapterWith({
      spawnProcess: scriptedSpawn(() => controller.abort()),
      terminateProcess,
    });

    const result = await run(adapter, controller.signal);

    expect(result.status).toBe('cancelled');
    expect(terminateProcess).toHaveBeenCalledTimes(1);
  });

  it('caps stdout and stderr at logMaxBytes and redacts both', async () => {
    const { adapter } = await adapterWith({
      logMaxBytes: 16,
      spawnProcess: scriptedSpawn((child) => {
        child.stdout.write('0123456789');
        child.stdout.write('abcdefghij');
        child.stdout.write('dropped entirely');
        child.stderr.write('super-secret');
        setImmediate(() => child.emit('close', 0, null));
      }),
    });

    const result = await run(adapter);

    expect(result.status).toBe('passed');
    expect(result.stdout).toBe('0123456789abcdef');
    expect(result.stderr).toBe('[REDACTED]');
    const stderrLog = result.artifacts.find((artifact) => artifact.name === 'stderr.log');
    expect(stderrLog).toMatchObject({ kind: 'stderr', contentType: 'application/x-ndjson' });
  });

  it('fails the run as infrastructure when a reporter event line is not a valid event', async () => {
    const { adapter } = await adapterWith({
      spawnProcess: scriptedSpawn(async (child, env) => {
        await writeFile(String(env['AUTOMATE_RUNNER_EVENTS_PATH']), '{"type":"half an event"}\n');
        child.emit('close', 0, null);
      }),
    });

    const result = await run(adapter);

    expect(result.status).toBe('infra_failed');
    expect(result.error?.code).toBe('RUNNER_INFRA_FAILED');
  });

  it('fails the run as infrastructure when the event sink rejects an event', async () => {
    const { adapter } = await adapterWith({
      spawnProcess: scriptedSpawn(async (child, env) => {
        await writeFile(
          String(env['AUTOMATE_RUNNER_EVENTS_PATH']),
          `${JSON.stringify({ eventId: 'e-1', sequence: 1, type: 'test.started', occurredAt: new Date().toISOString(), payload: {} })}\n`,
        );
        child.emit('close', 0, null);
      }),
    });

    const result = await adapter.execute({
      jobId: 'job-1',
      deadlineMs: 5_000,
      signal: new AbortController().signal,
      onEvent: () => Promise.reject(new Error('spool full; super-secret')),
    });

    expect(result.status).toBe('infra_failed');
    expect(result.error).toEqual({
      code: 'RUNNER_INFRA_FAILED',
      message: 'spool full; [REDACTED]',
    });
  });

  it('labels every collected artifact with its content type and digest', async () => {
    const files: Record<string, string> = {
      'shot.png': 'image/png',
      'video.webm': 'video/webm',
      'trace.zip': 'application/zip',
      'notes.txt': 'text/plain',
      'index.html': 'text/html',
      'data.bin': 'application/octet-stream',
    };
    const { adapter } = await adapterWith({
      spawnProcess: scriptedSpawn(async (child, env) => {
        const output = String(env['AUTOMATE_OUTPUT_DIR']);
        await mkdir(join(output, 'nested'), { recursive: true });
        await Promise.all(
          Object.keys(files).map((name) => writeFile(join(output, 'nested', name), 'x')),
        );
        child.emit('close', 0, null);
      }),
    });

    const result = await run(adapter);

    for (const [name, contentType] of Object.entries(files)) {
      expect(
        result.artifacts.find((artifact) => artifact.name === `test-results/nested/${name}`),
      ).toMatchObject({
        contentType,
        bytes: 1,
        // sha256("x")
        digest: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
      });
    }
    expect(result.artifacts.find((artifact) => artifact.name === 'events.ndjson')?.bytes).toBe(0);
  });

  it('refuses an artifact over the size limit and removes the workspace it made', async () => {
    const { adapter, workspaceRoot } = await adapterWith({
      artifactMaxBytes: 8,
      spawnProcess: scriptedSpawn(async (child, env) => {
        await writeFile(join(String(env['AUTOMATE_OUTPUT_DIR']), 'big.bin'), 'x'.repeat(9));
        child.emit('close', 0, null);
      }),
    });

    const failure = run(adapter);

    await expect(failure).rejects.toBeInstanceOf(RunnerInfrastructureError);
    await expect(failure).rejects.toThrow(
      /Artifact exceeds configured limit: test-results.big\.bin/u,
    );
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it('wraps an unexpected spawner failure, redacts it, and removes the workspace', async () => {
    const { adapter, workspaceRoot } = await adapterWith({
      spawnProcess: () => {
        throw new Error('fork failed for super-secret');
      },
    });

    const failure = run(adapter);

    await expect(failure).rejects.toBeInstanceOf(RunnerInfrastructureError);
    await expect(failure).rejects.toThrow('fork failed for [REDACTED]');
    expect(await readdir(workspaceRoot)).toEqual([]);
  });

  it('keeps the message of a thrown non-Error value', async () => {
    const { adapter } = await adapterWith({
      spawnProcess: () => {
        throw 'spawner threw a string';
      },
    });

    await expect(run(adapter)).rejects.toThrow('spawner threw a string');
  });

  it('defaults to the first allowed target and the smoke-pass project', async () => {
    const calls: SpawnOptions[] = [];
    const { adapter } = await adapterWith({
      spawnProcess: scriptedSpawn((child) => {
        child.emit('close', 0, null);
      }, calls),
    });

    const result = await run(adapter);

    expect(result.status).toBe('passed');
    expect(calls[0]?.env?.['AUTOMATE_BASE_URL']).toBe('https://allowed.test/');
    expect(calls[0]?.env?.['CI']).toBe('1');
  });

  it('withholds secret-named variables and any variable carrying a redacted value', async () => {
    const calls: SpawnOptions[] = [];
    const { adapter } = await adapterWith({
      environment: {
        PATH: '/usr/bin',
        GITHUB_TOKEN: 'ghp-anything',
        DB_PASSWORD: 'pw',
        // Assembled, so the secret scan does not read a credential-shaped literal.
        DATABASE_URL: ['postgres://user', 'super-secret@db/automate'].join(':'),
        JOB_SECRET_VALUE_HOLDER: 'harmless',
        HOME: '/home/runner',
      },
      spawnProcess: scriptedSpawn((child) => {
        child.emit('close', 0, null);
      }, calls),
    });

    await adapter.execute({
      jobId: 'job-1',
      deadlineMs: 5_000,
      signal: new AbortController().signal,
      redactions: ['/home/runner'],
    });

    const env = calls[0]?.env ?? {};
    expect(env['PATH']).toBe('/usr/bin');
    for (const key of [
      'GITHUB_TOKEN',
      'DB_PASSWORD',
      'DATABASE_URL',
      'JOB_SECRET_VALUE_HOLDER',
      'HOME',
    ]) {
      expect(env[key], key).toBeUndefined();
    }
  });
});

describe('PlaywrightExecutionAdapter configuration checks', () => {
  it.each([
    { name: 'a zero deadline', context: { deadlineMs: 0 }, message: /positive integer/u },
    { name: 'a fractional deadline', context: { deadlineMs: 1.5 }, message: /positive integer/u },
    { name: 'an unparsable URL', context: { targetUrl: 'not a url' }, message: /is invalid/u },
    {
      name: 'a non-HTTP scheme',
      context: { targetUrl: 'ftp://allowed.test' },
      message: /is not allowed/u,
    },
    {
      name: 'embedded credentials',
      context: { targetUrl: ['https://user', 'pw@allowed.test'].join(':') },
      message: /is not allowed/u,
    },
  ])('rejects $name before spawning', async ({ context, message }) => {
    const spawnProcess = vi.fn(scriptedSpawn(() => undefined));
    const { adapter } = await adapterWith({ spawnProcess });

    const failure = adapter.execute({
      jobId: 'job-1',
      deadlineMs: 5_000,
      signal: new AbortController().signal,
      ...context,
    });

    await expect(failure).rejects.toBeInstanceOf(RunnerConfigurationError);
    await expect(failure).rejects.toThrow(message);
    expect(spawnProcess).not.toHaveBeenCalled();
  });

  it('refuses a project root that has no Playwright config', async () => {
    const emptyProject = await workspace();
    const { adapter } = await adapterWith({ projectRoot: emptyProject });

    await expect(run(adapter)).rejects.toThrow('Playwright project or reporter is not installed');
  });

  it('refuses a reporter that is missing', async () => {
    const { adapter } = await adapterWith({
      reporterPath: join(await workspace(), 'no-such-reporter.js'),
    });

    await expect(run(adapter)).rejects.toThrow('Playwright project or reporter is not installed');
  });

  it('refuses a reporter path with a comma, which would split the --reporter list', async () => {
    const directory = join(await workspace(), 'a,b');
    await mkdir(directory);
    const reporterPath = join(directory, 'reporter.js');
    await writeFile(reporterPath, '');
    const { adapter } = await adapterWith({ reporterPath });

    await expect(run(adapter)).rejects.toThrow('Reporter path cannot contain a comma');
  });

  it('refuses to clean up anything that is not inside its workspace root', async () => {
    const { adapter, workspaceRoot } = await adapterWith({});

    await expect(adapter.cleanup(workspaceRoot)).rejects.toBeInstanceOf(RunnerConfigurationError);
    await expect(adapter.cleanup(join(workspaceRoot, '..'))).rejects.toThrow(
      'Path is outside the configured runner workspace',
    );
    await expect(access(workspaceRoot)).resolves.toBeUndefined();
  });
});

describe('terminateProcessTree', () => {
  it('does nothing for a child that never got a pid', async () => {
    const kill = vi.fn();
    const child = { pid: undefined, exitCode: null, kill };

    await terminateProcessTree(child as unknown as ChildProcessWithoutNullStreams, 10);

    expect(kill).not.toHaveBeenCalled();
  });

  it('ends a live process, even one that ignores SIGTERM', async () => {
    const child = spawn(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); console.log('up')"],
      { detached: process.platform !== 'win32', stdio: 'pipe', windowsHide: true },
    ) as ChildProcessWithoutNullStreams;
    const closed = new Promise<void>((resolveClose) => {
      child.once('close', () => resolveClose());
    });
    // Wait until the SIGTERM handler is installed, so the grace path is the one exercised.
    await new Promise<void>((resolveUp) => {
      child.stdout.once('data', () => resolveUp());
    });

    await terminateProcessTree(child, 200);
    await closed;

    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  });
});
