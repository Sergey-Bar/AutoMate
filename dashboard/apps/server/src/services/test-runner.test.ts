import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn } from 'node:child_process';

// ─── Mock child_process ───────────────────────────────────────────────────────
// Use vi.hoisted so the variable is available inside the mock factory.
const mockChildProcess = vi.hoisted(() => {
  const closeCallbacks = new Map<string, (code: number) => void>();
  const mockKill = vi.fn(function (this: { _runId?: string }) {
    const id = this._runId ?? '';
    const cb = closeCallbacks.get(id);
    if (cb) {
      setTimeout(() => cb(null as unknown as number), 5);
    }
  });

  return { closeCallbacks, mockKill };
});

// ─── Mock node:fs ────────────────────────────────────────────────────────────
// Wrap only the fs functions used by test-runner in vi.fn() so they can be
// overridden in cleanupStaleRuns tests. All functions call through to the
// real implementation by default so existing tests still use real I/O.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readdirSync: vi.fn(actual.readdirSync),
    statSync: vi.fn(actual.statSync),
    rmSync: vi.fn(actual.rmSync),
  };
});

vi.mock('node:child_process', () => {
  return {
    spawn: vi.fn((_cmd: string, _args: string[], _opts: object) => {
      // Each spawn creates a unique run ID key for tracking close callbacks
      const runId = String(Date.now() + Math.random());
      const stdoutHandlers: ((d: Buffer) => void)[] = [];
      const stderrHandlers: ((d: Buffer) => void)[] = [];
      const closeHandlers: ((code: number) => void)[] = [];

      const child = {
        _runId: runId,
        stdout: { on: vi.fn((ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') stdoutHandlers.push(cb); }) },
        stderr: { on: vi.fn((ev: string, cb: (d: Buffer) => void) => { if (ev === 'data') stderrHandlers.push(cb); }) },
        on: vi.fn((ev: string, cb: (code: number) => void) => {
          if (ev === 'close') {
            closeHandlers.push(cb);
            mockChildProcess.closeCallbacks.set(runId, cb);
            // Default: auto-close with exit code 0 after 10ms
            setTimeout(() => cb(0), 10);
          }
        }),
        kill: vi.fn(() => {
          // Simulate kill by triggering close with null exit code
          setTimeout(() => closeHandlers.forEach((cb) => cb(null as unknown as number)), 5);
        }),
        killed: false,
      };

      return child;
    }),
  };
});

// ─── Import after mocks are registered ───────────────────────────────────────
// We import TestRunner class so each test can instantiate a fresh one.
import { TestRunner } from '../services/test-runner.js';

describe('TestRunner', () => {
  let runner: TestRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    mockChildProcess.closeCallbacks.clear();
    runner = new TestRunner();
    // Disable auto-cleanup scheduler for unit tests
    runner.stopCleanupScheduler();
  });

  afterEach(() => {
    runner.stopCleanupScheduler();
  });

  describe('executeTestRun', () => {
    it('creates temp directory and writes spec file', async () => {
      const runId = 'test-run-create-dir';
      const specCode = 'test("example", async () => { expect(1).toBe(1); });';
      const specFileName = 'example.spec.ts';

      const resultPromise = runner.executeTestRun({ runId, specCode, specFileName });

      // The spec file should be written synchronously before spawn
      const specPath = path.join(os.tmpdir(), 'automate-runs', runId, specFileName);
      expect(fs.existsSync(specPath)).toBe(true);
      expect(fs.readFileSync(specPath, 'utf-8')).toBe(specCode);

      await resultPromise;

      // Cleanup
      runner.cleanupRun(runId);
    });

    it('emits run:started event with runId and specPath', async () => {
      const runId = 'test-run-events';
      const specFileName = 'spec.ts';
      const startedEvents: unknown[] = [];

      runner.on('run:started', (payload) => startedEvents.push(payload));

      await runner.executeTestRun({ runId, specCode: 'test("x", () => {})', specFileName });

      expect(startedEvents).toHaveLength(1);
      expect((startedEvents[0] as { runId: string }).runId).toBe(runId);

      runner.cleanupRun(runId);
    });

    it('emits run:completed event with result', async () => {
      const runId = 'test-run-completed';
      const completedEvents: unknown[] = [];

      runner.on('run:completed', (payload) => completedEvents.push(payload));

      const result = await runner.executeTestRun({
        runId,
        specCode: 'test("x", () => {})',
        specFileName: 'spec.ts',
      });

      expect(completedEvents).toHaveLength(1);
      expect(result.runId).toBe(runId);
      expect(result.exitCode).toBe(0);

      runner.cleanupRun(runId);
    });

    it('enforces timeout and emits run:timeout event', async () => {
      const runId = 'test-run-timeout';
      const timeoutEvents: unknown[] = [];
      const origTimeout = process.env.TEST_RUNNER_TIMEOUT;

      try {
        const spawnMock = vi.mocked(spawn);

        // Mock spawn to produce a child that never auto-closes (simulates hanging test)
        spawnMock.mockImplementationOnce((_cmd: string, _args: string[], _opts?: object) => {
          const closeHandlers: ((code: null) => void)[] = [];
          const child = {
            stdout: { on: vi.fn() },
            stderr: { on: vi.fn() },
            on: vi.fn((ev: string, cb: (code: null) => void) => {
              if (ev === 'close') closeHandlers.push(cb);
            }),
            kill: vi.fn(() => {
              // Simulates the OS killing the process on SIGTERM
              setTimeout(() => closeHandlers.forEach((cb) => cb(null)), 5);
            }),
            killed: false,
          };
          return child as unknown as ReturnType<typeof spawn>;
        });

        // Set a short timeout so the test doesn't wait 30s
        process.env.TEST_RUNNER_TIMEOUT = '100';

        runner.on('run:timeout', (payload) => timeoutEvents.push(payload));

        const result = await runner.executeTestRun({
          runId,
          specCode: 'test("x", () => {})',
          specFileName: 'spec.ts',
        });

        // exitCode is null when killed by timeout
        expect(result.runId).toBe(runId);
        expect(timeoutEvents).toHaveLength(1);
        expect((timeoutEvents[0] as { runId: string }).runId).toBe(runId);
      } finally {
        if (origTimeout !== undefined) {
          process.env.TEST_RUNNER_TIMEOUT = origTimeout;
        } else {
          delete process.env.TEST_RUNNER_TIMEOUT;
        }
        runner.cleanupRun(runId);
      }
    }, 10_000);

    it('returns runId in result', async () => {
      const runId = 'test-run-return-id';
      const result = await runner.executeTestRun({
        runId,
        specCode: 'test("x", () => {})',
        specFileName: 'spec.ts',
      });

      expect(result.runId).toBe(runId);

      runner.cleanupRun(runId);
    });

    it('passes --project and baseUrl env var when browser and baseUrl are specified', async () => {
      const runId = 'test-run-browser-baseurl';
      const capturedArgs: string[] = [];
      let capturedEnv: Record<string, string | undefined> = {};

      vi.mocked(spawn).mockImplementationOnce((_cmd, args, opts) => {
        capturedArgs.push(...(args as string[]));
        capturedEnv = ((opts as { env?: Record<string, string | undefined> }).env) ?? {};
        const closeHandlers: ((code: number) => void)[] = [];
        const child = {
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
          on: vi.fn((ev: string, cb: (code: number) => void) => {
            if (ev === 'close') {
              closeHandlers.push(cb);
              setTimeout(() => cb(0), 10);
            }
          }),
          kill: vi.fn(),
          killed: false,
        };
        return child as unknown as ReturnType<typeof spawn>;
      });

      await runner.executeTestRun({
        runId,
        specCode: 'test("x", () => {})',
        specFileName: 'spec.ts',
        browser: 'chromium',
        baseUrl: 'http://localhost:3000',
      });

      expect(capturedArgs).toContain('--project');
      expect(capturedArgs).toContain('chromium');
      expect(capturedEnv['BASE_URL']).toBe('http://localhost:3000');

      runner.cleanupRun(runId);
    });
  });

  describe('cleanupRun', () => {
    it('removes the temp directory for a given runId', async () => {
      const runId = 'test-run-cleanup';
      const dir = runner.runDir(runId);

      // Create the directory
      fs.mkdirSync(dir, { recursive: true });
      expect(fs.existsSync(dir)).toBe(true);

      runner.cleanupRun(runId);

      expect(fs.existsSync(dir)).toBe(false);
    });

    it('does nothing if directory does not exist', () => {
      const runId = 'test-run-no-dir';
      // Should not throw
      expect(() => runner.cleanupRun(runId)).not.toThrow();
    });
  });

  describe('runDir', () => {
    it('returns the correct temp directory path', () => {
      const runId = 'my-run-id';
      const expected = path.join(os.tmpdir(), 'automate-runs', runId);
      expect(runner.runDir(runId)).toBe(expected);
    });
  });

  describe('stopCleanupScheduler', () => {
    it('can be called multiple times without throwing', () => {
      runner.stopCleanupScheduler();
      expect(() => runner.stopCleanupScheduler()).not.toThrow();
    });
  });

  describe('stdout/stderr data capture', () => {
    it('captures stdout output from child process', async () => {
      const runId = 'test-stdout-capture';
      const capturedHandlers = {
        stdout: [] as Array<(d: Buffer) => void>,
        close: [] as Array<(code: number) => void>,
      };

      vi.mocked(spawn).mockImplementationOnce((_cmd, _args, _opts) => {
        const child = {
          stdout: {
            on: vi.fn((ev: string, cb: (d: Buffer) => void) => {
              if (ev === 'data') capturedHandlers.stdout.push(cb);
            }),
          },
          stderr: { on: vi.fn() },
          on: vi.fn((ev: string, cb: (code: number) => void) => {
            if (ev === 'close') capturedHandlers.close.push(cb);
          }),
          kill: vi.fn(),
          killed: false,
        };
        return child as unknown as ReturnType<typeof spawn>;
      });

      const resultPromise = runner.executeTestRun({
        runId,
        specCode: 'test("x", () => {})',
        specFileName: 'spec.ts',
      });

      // Handlers are registered synchronously inside executeTestRun — push data then trigger close
      capturedHandlers.stdout.forEach((h) => h(Buffer.from('hello stdout')));
      capturedHandlers.close.forEach((h) => h(0));

      const result = await resultPromise;
      expect(result.stdout).toBe('hello stdout');

      runner.cleanupRun(runId);
    });

    it('captures stderr output from child process', async () => {
      const runId = 'test-stderr-capture';
      const capturedHandlers = {
        stderr: [] as Array<(d: Buffer) => void>,
        close: [] as Array<(code: number) => void>,
      };

      vi.mocked(spawn).mockImplementationOnce((_cmd, _args, _opts) => {
        const child = {
          stdout: { on: vi.fn() },
          stderr: {
            on: vi.fn((ev: string, cb: (d: Buffer) => void) => {
              if (ev === 'data') capturedHandlers.stderr.push(cb);
            }),
          },
          on: vi.fn((ev: string, cb: (code: number) => void) => {
            if (ev === 'close') capturedHandlers.close.push(cb);
          }),
          kill: vi.fn(),
          killed: false,
        };
        return child as unknown as ReturnType<typeof spawn>;
      });

      const resultPromise = runner.executeTestRun({
        runId,
        specCode: 'test("x", () => {})',
        specFileName: 'spec.ts',
      });

      capturedHandlers.stderr.forEach((h) => h(Buffer.from('hello stderr')));
      capturedHandlers.close.forEach((h) => h(1));

      const result = await resultPromise;
      expect(result.stderr).toBe('hello stderr');

      runner.cleanupRun(runId);
    });
  });

  describe('startCleanupScheduler', () => {
    it('calls unref on the cleanup interval when unref is available', () => {
      const unrefSpy = vi.fn();
      const fakeInterval = { unref: unrefSpy } as unknown as ReturnType<typeof setInterval>;
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValueOnce(fakeInterval);

      const r = new TestRunner();

      expect(unrefSpy).toHaveBeenCalledOnce();

      setIntervalSpy.mockRestore();
      r.stopCleanupScheduler();
    });

    it('does not throw when cleanup interval has no unref method', () => {
      const fakeInterval = {} as unknown as ReturnType<typeof setInterval>;
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockReturnValueOnce(fakeInterval);

      expect(() => {
        const r = new TestRunner();
        r.stopCleanupScheduler();
      }).not.toThrow();

      setIntervalSpy.mockRestore();
    });

    it('fires cleanupStaleRuns callback when the interval elapses', () => {
      vi.useFakeTimers();
      // existsSync returns false so cleanupStaleRuns exits early without real I/O
      vi.mocked(fs.existsSync).mockImplementation(() => false);

      try {
        const r = new TestRunner();
        // Advance past the default 1-hour cleanup interval
        vi.advanceTimersByTime(3_600_001);
        r.stopCleanupScheduler();

        // If we reach here the interval callback (line 135) was invoked
        expect(vi.mocked(fs.existsSync)).toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('cleanupStaleRuns', () => {
    function triggerCleanup(r: TestRunner): void {
      (r as unknown as { cleanupStaleRuns(): void }).cleanupStaleRuns();
    }

    it('returns early when base directory does not exist', () => {
      vi.mocked(fs.existsSync).mockImplementation(() => false);
      const readdirMock = vi.mocked(fs.readdirSync);

      expect(() => triggerCleanup(runner)).not.toThrow();
      expect(readdirMock).not.toHaveBeenCalled();
    });

    it('handles readdirSync throwing without propagating the error', () => {
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readdirSync).mockImplementation(
        (() => { throw new Error('EACCES: permission denied'); }) as unknown as typeof fs.readdirSync,
      );
      const statMock = vi.mocked(fs.statSync);

      expect(() => triggerCleanup(runner)).not.toThrow();
      expect(statMock).not.toHaveBeenCalled();
    });

    it('skips entries that are not directories', () => {
      const fakeFile = { name: 'some-file.txt', isDirectory: () => false } as unknown as fs.Dirent;
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readdirSync).mockImplementation(
        (() => [fakeFile]) as unknown as typeof fs.readdirSync,
      );
      const statMock = vi.mocked(fs.statSync);

      triggerCleanup(runner);

      expect(statMock).not.toHaveBeenCalled();
    });

    it('removes stale directories older than 1 hour', () => {
      const staleEntry = { name: 'stale-run-123', isDirectory: () => true } as unknown as fs.Dirent;
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readdirSync).mockImplementation(
        (() => [staleEntry]) as unknown as typeof fs.readdirSync,
      );
      vi.mocked(fs.statSync).mockImplementation(
        (() => ({ mtimeMs: Date.now() - 3_700_000 })) as unknown as typeof fs.statSync,
      );
      vi.mocked(fs.rmSync).mockImplementation(
        (() => undefined) as unknown as typeof fs.rmSync,
      );

      triggerCleanup(runner);

      expect(vi.mocked(fs.rmSync)).toHaveBeenCalledOnce();
    });

    it('keeps directories newer than 1 hour', () => {
      const freshEntry = { name: 'fresh-run-456', isDirectory: () => true } as unknown as fs.Dirent;
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readdirSync).mockImplementation(
        (() => [freshEntry]) as unknown as typeof fs.readdirSync,
      );
      vi.mocked(fs.statSync).mockImplementation(
        (() => ({ mtimeMs: Date.now() - 1_000 })) as unknown as typeof fs.statSync,
      );
      vi.mocked(fs.rmSync).mockImplementation(
        (() => undefined) as unknown as typeof fs.rmSync,
      );

      triggerCleanup(runner);

      expect(vi.mocked(fs.rmSync)).not.toHaveBeenCalled();
    });

    it('handles statSync throwing for an individual directory without propagating', () => {
      const badEntry = { name: 'error-run-789', isDirectory: () => true } as unknown as fs.Dirent;
      vi.mocked(fs.existsSync).mockImplementation(() => true);
      vi.mocked(fs.readdirSync).mockImplementation(
        (() => [badEntry]) as unknown as typeof fs.readdirSync,
      );
      vi.mocked(fs.statSync).mockImplementation(
        (() => { throw new Error('ENOENT: no such file or directory'); }) as unknown as typeof fs.statSync,
      );
      vi.mocked(fs.rmSync).mockImplementation(
        (() => undefined) as unknown as typeof fs.rmSync,
      );

      expect(() => triggerCleanup(runner)).not.toThrow();
      expect(vi.mocked(fs.rmSync)).not.toHaveBeenCalled();
    });
  });
});
