/**
 * test-runner.ts — Sandbox test execution service
 *
 * Manages temp-file creation, Playwright process spawning, timeout enforcement,
 * and automatic cleanup of stale run directories.
 *
 * Usage:
 *   import { testRunner } from './test-runner.js';
 *   const result = await testRunner.executeTestRun({ runId, specCode, specFileName });
 */
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const DEFAULT_CLEANUP_INTERVAL_MS = Number(process.env.TEST_RUNNER_CLEANUP_INTERVAL ?? 3_600_000);

function getTimeoutMs(): number {
  return Number(process.env.TEST_RUNNER_TIMEOUT ?? 30_000);
}
const STALE_DIR_AGE_MS = 3_600_000; // 1 hour

export interface ExecuteTestRunOptions {
  runId: string;
  specCode: string;
  specFileName: string;
  baseUrl?: string;
  browser?: 'chromium' | 'firefox' | 'webkit';
  metadata?: Record<string, string>;
}

export interface TestRunResult {
  runId: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export class TestRunner extends EventEmitter {
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super();
    this.startCleanupScheduler();
  }

  /** Returns the temp directory for a given runId */
  runDir(runId: string): string {
    return path.join(os.tmpdir(), 'automate-runs', runId);
  }

  /**
   * Execute a test run in a sandbox:
   *   1. Write spec code to a temp file
   *   2. Spawn `npx playwright test <file> --reporter=list`
   *   3. Enforce timeout, kill on breach
   *   4. Emit events and return result
   */
  async executeTestRun(options: ExecuteTestRunOptions): Promise<TestRunResult> {
    const { runId, specCode, specFileName, browser } = options;
    const dir = this.runDir(runId);

    // Create temp directory and write spec file
    fs.mkdirSync(dir, { recursive: true });
    const specPath = path.join(dir, specFileName);
    fs.writeFileSync(specPath, specCode, 'utf-8');

    this.emit('run:started', { runId, specPath });

    return new Promise<TestRunResult>((resolve) => {
      const args = [
        'playwright',
        'test',
        specPath,
        '--reporter=list',
      ];

      if (browser) {
        args.push('--project', browser);
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const child = spawn('npx', args, {
        env: {
          ...process.env,
          ...(options.baseUrl ? { BASE_URL: options.baseUrl } : {}),
          FORCE_COLOR: '0',
        },
        cwd: dir,
      });

      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        this.emit('run:timeout', { runId });
      }, getTimeoutMs());

      child.on('close', (exitCode) => {
        clearTimeout(timeoutHandle);
        const result: TestRunResult = {
          runId,
          exitCode: timedOut ? null : exitCode,
          stdout,
          stderr,
        };
        this.emit('run:completed', result);
        resolve(result);
      });
    });
  }

  /** Remove the temp directory for a given runId */
  cleanupRun(runId: string): void {
    const dir = this.runDir(runId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /** Schedule periodic cleanup of directories older than STALE_DIR_AGE_MS */
  private startCleanupScheduler(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleRuns();
    }, DEFAULT_CLEANUP_INTERVAL_MS);

    // Allow Node.js to exit even if interval is active
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /** Clean up run directories older than 1 hour */
  private cleanupStaleRuns(): void {
    const baseDir = path.join(os.tmpdir(), 'automate-runs');
    if (!fs.existsSync(baseDir)) return;

    const now = Date.now();
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(baseDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(baseDir, entry.name);
      try {
        const stat = fs.statSync(dirPath);
        if (now - stat.mtimeMs > STALE_DIR_AGE_MS) {
          fs.rmSync(dirPath, { recursive: true, force: true });
        }
      } catch {
        // Non-fatal: ignore errors for individual dirs
      }
    }
  }

  /** Stop the cleanup scheduler (for graceful shutdown) */
  stopCleanupScheduler(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

/** Singleton instance */
export const testRunner = new TestRunner();
