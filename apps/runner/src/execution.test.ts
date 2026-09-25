import { EventEmitter } from 'node:events';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaywrightExecutionAdapter, RunnerConfigurationError } from './execution.js';

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

function fixtureRoot(): string {
  return join(process.cwd(), 'fixtures', 'playwright-smoke');
}

function fakeSpawn(
  code: number,
  calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }>,
): (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams {
  return (command, args, options) => {
    calls.push({ command, args, options });
    const child = new FakeChild();
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
    }, 5);
    timeout.unref();
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
      expect.arrayContaining(['event-log', 'playwright-json', 'junit', 'stderr', 'stdout']),
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
    const adapter = new PlaywrightExecutionAdapter({
      projectRoot: fixtureRoot(),
      allowedProjects: ['smoke-pass'],
      allowedTargetUrls: ['https://allowed.test'],
      workspaceRoot,
      artifactMaxBytes: 1_000_000,
      logMaxBytes: 10_000,
      spawnProcess: fakeSpawn(0, calls),
      terminateProcess: async (child) => {
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
  });
});
