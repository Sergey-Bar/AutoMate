import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

import { GenericSpawnAdapter, globToRegExp, type SpawnCall } from './generic-spawn.js';
import { RunnerConfigurationError, RunnerInfrastructureError } from './execution.js';

/**
 * A process stand-in that records exactly how it was spawned.
 *
 * The assertions below are about the **shape of the spawn**, not about a command
 * succeeding — a `shell: true` in this code would execute everything correctly on
 * the happy path and be an RCE surface on the other one, and only the recorded
 * options can tell the two apart.
 */
class FakeChild extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode: number | null = null;
  pid: undefined | number = undefined;
  killed = false;
}

async function scaffold(): Promise<{
  repo: string;
  workspace: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), 'automate-spawn-'));
  const repo = path.join(root, 'repo');
  const workspace = path.join(root, 'workspace');
  await mkdir(repo, { recursive: true });
  await mkdir(workspace, { recursive: true });
  return { repo, workspace, cleanup: () => rm(root, { recursive: true, force: true }) };
}

interface Harness {
  adapter: GenericSpawnAdapter;
  calls: SpawnCall[];
  /**
   * Waits for the spawn, then lets the child report `code`.
   *
   * Async on purpose. The adapter does real I/O before it spawns — `mkdtemp`,
   * `mkdir` — so a test that called a synchronous `finish()` right after
   * `execute()` would be calling it on nothing, and the promise it is waiting on
   * would never settle. Thirty seconds per test, fifteen times, for a race that
   * was in the test rather than in the code.
   */
  finish: (code: number | null) => Promise<void>;
  /** Resolves once the child has actually been spawned. */
  started: Promise<void>;
}

function harness(
  repo: string,
  workspace: string,
  overrides: Partial<ConstructorParameters<typeof GenericSpawnAdapter>[0]> = {},
): Harness {
  const calls: SpawnCall[] = [];
  let child: FakeChild | null = null;
  let resolveExit: ((code: number | null) => void) | null = null;
  let markStarted: (() => void) | null = null;
  const started = new Promise<void>((settle) => {
    markStarted = settle;
  });

  const adapter = new GenericSpawnAdapter({
    repoRoot: repo,
    workspaceRoot: workspace,
    artifactMaxBytes: 1024 * 1024,
    logMaxBytes: 64 * 1024,
    spawnProcess: (command, args, options) => {
      calls.push({ command, args: [...args], options });
      const fake = new FakeChild();
      child = fake;
      void new Promise<void>((settle) => {
        resolveExit = (code) => {
          fake.exitCode = code;
          resolveExit = null;
          settle();
          setImmediate(() => fake.emit('close', code, null));
        };
      });
      markStarted?.();
      markStarted = null;
      return fake as unknown as ChildProcessWithoutNullStreams;
    },
    terminateProcess: async () => {
      if (child !== null) child.killed = true;
    },
    ...overrides,
  });

  return {
    adapter,
    calls,
    started,
    finish: async (code) => {
      await started;
      resolveExit?.(code);
    },
  };
}

const command = (argv: readonly string[], artifactGlobs: readonly string[] = []) => ({
  argv,
  workingDirectory: '.',
  artifactGlobs,
});

const context = (overrides: Partial<Parameters<GenericSpawnAdapter['execute']>[0]> = {}) => ({
  jobId: 'job-1',
  deadlineMs: 10_000,
  signal: new AbortController().signal,
  ...overrides,
});

describe('a command is argv, and the spawn proves it', () => {
  it('never asks for a shell', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter, calls, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pnpm', 'test']) }));
      void finish(0);

      await running;
      expect(calls[0]?.options.shell).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it('passes argv elements through unchanged, spaces and metacharacters included', async () => {
    // `npm run test && rm -rf /` as one argv element is a literal argument to
    // `npm`, not a command. There is nothing to parse and nothing to quote,
    // because the data's shape makes the shell unavailable rather than merely
    // discouraged — which is decision D7 in the one place it can be enforced.
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const argv = ['npm', 'run', 'test && rm -rf /', 'a b c'];
      const { adapter, calls, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(argv) }));
      void finish(0);

      await running;
      // Reconstructed as the process would see it, which is the only form in
      // which "unchanged" means anything.
      const call = calls[0];
      expect([call?.command, ...(call?.args ?? [])]).toEqual(argv);
      expect(call?.command).toBe('npm');
    } finally {
      await cleanup();
    }
  });

  it('refuses a command with no argv rather than spawning a shell with no script', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter } = harness(repo, workspace);
      await expect(
        adapter.execute(
          context({ command: { argv: [], workingDirectory: '.', artifactGlobs: [] } }),
        ),
      ).rejects.toBeInstanceOf(RunnerConfigurationError);
    } finally {
      await cleanup();
    }
  });

  it('refuses to execute a working directory outside the registered repository', async () => {
    // The repository path came from a `projects` row, so it is operator input.
    // `cwd: /etc` would run the command there with the runner's privileges.
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter } = harness(repo, workspace);
      await expect(
        adapter.execute(
          context({ command: { argv: ['ls'], workingDirectory: '../../..', artifactGlobs: [] } }),
        ),
      ).rejects.toBeInstanceOf(RunnerConfigurationError);
    } finally {
      await cleanup();
    }
  });
});

describe("the child gets a scrubbed environment, not the runner's", () => {
  it('passes only the allowlist when the command names none', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter, calls, finish } = harness(repo, workspace, {
        environment: {
          PATH: '/usr/bin',
          HOME: '/root',
          CI: '1',
          GITHUB_TOKEN: 'ghp_realtoken',
          AWS_SECRET_ACCESS_KEY: 'realkey',
          DATABASE_PASSWORD: 'hunter2',
        },
      });
      const running = adapter.execute(context({ command: command(['pytest']) }));
      void finish(0);

      await running;
      const env = calls[0]?.options.env ?? {};
      expect(env['PATH']).toBe('/usr/bin');
      expect(env['HOME']).toBe('/root');
      expect(env['CI']).toBe('1');
      // None of these is in the default allowlist. The Playwright adapter's
      // `sanitizeEnvironment` drops anything matching
      // /token|secret|password|credential|api[_-]?key/ — a denylist, which is
      // the weaker shape: it cannot know the name of the secret the customer
      // keeps in `DATABASE_DSN`.
      expect(env['GITHUB_TOKEN']).toBeUndefined();
      expect(env['AWS_SECRET_ACCESS_KEY']).toBeUndefined();
      expect(env['DATABASE_PASSWORD']).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('passes an environment variable the command declared by name, and only that one', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter, calls, finish } = harness(repo, workspace, {
        environment: { PATH: '/usr/bin', CI_TOKEN: 'wanted', OTHER_TOKEN: 'unwanted' },
      });
      const running = adapter.execute(
        context({
          command: { ...command(['pytest']), env: { CI_TOKEN: 'wanted' } },
        }),
      );
      void finish(0);

      await running;
      const env = calls[0]?.options.env ?? {};
      expect(env['CI_TOKEN']).toBe('wanted');
      // Declaring one does not open the rest of the namespace.
      expect(env['OTHER_TOKEN']).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it('never passes a declared variable whose value is empty, so an unset secret cannot read as set', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter, calls, finish } = harness(repo, workspace, { environment: {} });
      const running = adapter.execute(
        context({ command: { ...command(['pytest']), env: { TOKEN: '' } } }),
      );
      void finish(0);

      await running;
      // An empty value reaching the child is how `${TOKEN:-}` and a bearer
      // header behave *identically*, which is a defect the child cannot report.
      expect((calls[0]?.options.env ?? {})['TOKEN']).toBeUndefined();
    } finally {
      await cleanup();
    }
  });
});

describe('stdout is evidence, never a result', () => {
  it('does not report a pass from a clean exit code with no declared artifact', async () => {
    // Decision D9. A command that prints "12 passed" and writes nothing has
    // asserted nothing, and the score has no row to read. Treating the exit code
    // as the result is how a suite that stopped running keeps reporting green.
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pytest'], ['reports/*.xml']) }));
      void finish(0);

      const result = await running;
      expect(result.status).toBe('infra_failed');
      expect(result.resultPath).toBe('');
      // And the stdout is still retained, because a human will want it.
      expect(typeof result.stdout).toBe('string');
    } finally {
      await cleanup();
    }
  });

  it('does not parse a result out of stdout even when the text says everything passed', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pytest']) }));
      void finish(0);
      const result = await running;
      expect(result.status).toBe('infra_failed');
      expect(result.artifacts.filter((artifact) => artifact.kind === 'stdout')).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it('reports passed when a declared artifact exists and the exit code is 0', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await mkdir(path.join(repo, 'reports'), { recursive: true });
      await writeFile(path.join(repo, 'reports', 'junit.xml'), '<testsuite tests="1"/>', 'utf8');
      const { adapter, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pytest'], ['reports/*.xml']) }));
      void finish(0);

      const result = await running;
      expect(result.status).toBe('passed');
      expect(result.resultPath.endsWith('junit.xml')).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it('reports failed when a declared artifact exists and the exit code is 1', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await mkdir(path.join(repo, 'reports'), { recursive: true });
      await writeFile(path.join(repo, 'reports', 'junit.xml'), '<testsuite/>', 'utf8');
      const { adapter, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pytest'], ['reports/*.xml']) }));
      void finish(1);

      expect((await running).status).toBe('failed');
    } finally {
      await cleanup();
    }
  });

  it('reports infra_failed on an exit code that is neither 0 nor 1', async () => {
    // 127 is "command not found", 126 is "cannot execute", 137 is a kill. None
    // of them is a test result, and calling any of them `failed` would charge a
    // team's failure rate for a broken environment.
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await writeFile(path.join(repo, 'junit.xml'), '<testsuite/>', 'utf8');
      const { adapter, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pytest'], ['junit.xml']) }));
      void finish(127);

      expect((await running).status).toBe('infra_failed');
    } finally {
      await cleanup();
    }
  });
});

describe('a stopped run keeps the results it produced', () => {
  it('returns cancelled and collects the partial artifacts', async () => {
    // The plan's manual acceptance: "stop mid-run, confirm partial results
    // survive". A half-finished suite is evidence — it says which tests passed
    // before the operator interrupted it — and a stop that discarded the
    // workspace would make every interruption cost the operator their run.
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await mkdir(path.join(repo, 'reports'), { recursive: true });
      await writeFile(path.join(repo, 'reports', 'partial.xml'), '<testsuite/>', 'utf8');
      const { adapter, finish } = harness(repo, workspace);
      const controller = new AbortController();
      const running = adapter.execute(
        context({
          command: command(['pytest', '-x'], ['reports/*.xml']),
          signal: controller.signal,
        }),
      );
      controller.abort();
      void finish(143);

      const result = await running;
      expect(result.status).toBe('cancelled');
      expect(result.artifacts.map((artifact) => artifact.name)).toContain('reports/partial.xml');
    } finally {
      await cleanup();
    }
  });

  it('reports timed_out rather than cancelled when the deadline is what stopped it', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const { adapter, started, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pytest']), deadlineMs: 5 }));
      // The deadline has to actually *fire* before the child reports its exit,
      // or the test would be asserting that a two-millisecond race went the right
      // way rather than that the deadline is what stopped the run.
      await started;
      await new Promise((settle) => setTimeout(settle, 25));
      void finish(null);

      expect((await running).status).toBe('timed_out');
    } finally {
      await cleanup();
    }
  });
});

describe('artifacts are bounded and addressed', () => {
  it('refuses an artifact over the configured ceiling rather than uploading it', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await writeFile(path.join(repo, 'big.xml'), 'x'.repeat(4096), 'utf8');
      const { adapter, finish } = harness(repo, workspace, { artifactMaxBytes: 1024 });
      const running = adapter.execute(context({ command: command(['pytest'], ['big.xml']) }));
      void finish(0);

      await expect(running).rejects.toThrow(/Artifact exceeds configured limit/);
    } finally {
      await cleanup();
    }
  });

  it('gives every artifact a digest and a repo-relative POSIX name', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await mkdir(path.join(repo, 'reports'), { recursive: true });
      await writeFile(path.join(repo, 'reports', 'junit.xml'), '<testsuite/>', 'utf8');
      const { adapter, finish } = harness(repo, workspace);
      const running = adapter.execute(context({ command: command(['pytest'], ['reports/*.xml']) }));
      void finish(0);

      const [artifact] = (await running).artifacts;
      expect(artifact?.digest).toMatch(/^[a-f0-9]{64}$/u);
      expect(artifact?.name).toBe('reports/junit.xml');
    } finally {
      await cleanup();
    }
  });

  it('matches a glob across directories and does not walk out of the repository', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await mkdir(path.join(repo, 'a', 'b'), { recursive: true });
      await writeFile(path.join(repo, 'a', 'b', 'deep.xml'), '<testsuite/>', 'utf8');
      await mkdir(path.join(workspace, 'outside'), { recursive: true });
      await writeFile(path.join(workspace, 'outside', 'leak.xml'), '<testsuite/>', 'utf8');
      const { adapter, finish } = harness(repo, workspace);
      const running = adapter.execute(
        context({ command: command(['pytest'], ['**/*.xml', '../outside/*.xml']) }),
      );
      void finish(0);

      const names = (await running).artifacts.map((artifact) => artifact.name);
      expect(names).toContain('a/b/deep.xml');
      expect(names.some((name) => name.includes('leak'))).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

describe('a glob is matched, not interpreted', () => {
  it('treats a dot as a literal rather than as "any character"', () => {
    // A pattern that did not escape the dot would match `reportsXxml` for
    // `reports.xml`, and a run would ingest a file the operator never declared.
    expect(globToRegExp('a.xml').test('a.xml')).toBe(true);
    expect(globToRegExp('a.xml').test('aXxml')).toBe(false);
  });

  it('anchors at both ends, so it cannot match a prefix of a longer name', () => {
    expect(globToRegExp('reports/junit.xml').test('reports/junit.xml.bak')).toBe(false);
    expect(globToRegExp('reports/junit.xml').test('x/reports/junit.xml')).toBe(false);
  });

  it('matches one character for a question mark', () => {
    expect(globToRegExp('a?.xml').test('ab.xml')).toBe(true);
    expect(globToRegExp('a?.xml').test('abc.xml')).toBe(false);
  });

  it('matches any depth for a double star', () => {
    expect(globToRegExp('**/*.xml').test('a.xml')).toBe(true);
    expect(globToRegExp('**/*.xml').test('a/b/c.xml')).toBe(true);
    expect(globToRegExp('**/*.xml').test('a/b/c.txt')).toBe(false);
  });

  it('normalises a backslash separator rather than treating it as a literal', () => {
    // Producers send `reports/junit.xml` and `reports\junit.xml` depending on the
    // platform they ran on. A matcher that understood only one would silently
    // collect nothing on the platform that uses the other.
    expect(globToRegExp('reports\\*.xml').test('reports/junit.xml')).toBe(true);
  });
});

describe('the default process path is the one product code uses', () => {
  it('spawns a real command with no shell and collects its declared artifact', async () => {
    // Every recorded-spawn assertion above goes through an injected spawner, so
    // without this the **default** `spawn` call would be the one place in the file
    // where `shell: true` could hide — and it is the only place product code uses.
    const { repo, workspace, cleanup } = await scaffold();
    try {
      await writeFile(path.join(repo, 'junit.xml'), '<testsuite/>', 'utf8');
      const adapter = new GenericSpawnAdapter({
        repoRoot: repo,
        workspaceRoot: workspace,
        artifactMaxBytes: 1024 * 1024,
        logMaxBytes: 64 * 1024,
      });
      const result = await adapter.execute({
        jobId: 'job-real',
        deadlineMs: 20_000,
        signal: new AbortController().signal,
        command: {
          argv: [process.execPath, '-e', 'process.exit(0)'],
          workingDirectory: '.',
          artifactGlobs: ['junit.xml'],
        },
      });
      expect(result.status).toBe('passed');
    } finally {
      await cleanup();
    }
  });

  it('reports a non-existent executable immediately, rather than waiting for the deadline', async () => {
    const { repo, workspace, cleanup } = await scaffold();
    try {
      const adapter = new GenericSpawnAdapter({
        repoRoot: repo,
        workspaceRoot: workspace,
        artifactMaxBytes: 1024 * 1024,
        logMaxBytes: 64 * 1024,
      });
      // `ENOENT` arrives as an `error` event rather than a `close`. An adapter that
      // only listened for `close` would hang until the deadline fired, turning "the
      // command does not exist" into "the command took five seconds" — and, with a
      // five-minute timeout, into an operator watching a spinner for five minutes
      // after typing a command name wrong.
      await expect(
        adapter.execute({
          jobId: 'job-missing',
          deadlineMs: 5000,
          signal: new AbortController().signal,
          command: {
            argv: ['automate-no-such-executable'],
            workingDirectory: '.',
            artifactGlobs: [],
          },
        }),
      ).rejects.toBeInstanceOf(RunnerInfrastructureError);
    } finally {
      await cleanup();
    }
  });
});
