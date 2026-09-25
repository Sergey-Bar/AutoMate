/**
 * runner.ts — Playwright process management
 *
 * Responsibilities:
 * - startRun()  : spawn `npx playwright test` with a PTY so xterm renders correctly
 * - abortRun()  : send SIGTERM to the spawned process
 * - listTests() : run --list --reporter=json and return parsed test tree
 */
import { EventEmitter } from 'events';
import * as path from 'path';
import { db } from '../db/client.js';
import { runs, quarantine } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import type { ReporterBridge } from './reporter-bridge.js';

interface RunOptions {
  projects?: string[];
  grep?: string;
  workers?: number;
  retries?: number;
  trace?: 'off' | 'on' | 'on-first-retry' | 'retain-on-failure';
  headed?: boolean;
  shard?: { current: number; total: number };
  timeout?: number;
  maxFailures?: number;
  lastFailed?: boolean;
  updateSnapshots?: boolean;
  tags?: string[];
  configPath?: string;
  testDir?: string;
  dryRun?: boolean;
}

interface ActiveProcess {
  pid: number;
  kill: () => void;
}

class Runner extends EventEmitter {
  private activeProcesses = new Map<string, ActiveProcess>();

  /** List available tests without running them */
  async listTests(configPath?: string): Promise<object> {
    const { spawnSync } = await import('child_process');
    const args = ['playwright', 'test', '--list', '--reporter=json'];
    if (configPath) {
      // Validate configPath: must be relative, no path traversal, and end with a config extension
      const normalised = path.normalize(configPath);
      if (path.isAbsolute(normalised) || normalised.includes('..') || !/\.(ts|js|json)$/.test(normalised)) {
        throw new Error(`Invalid config path: ${configPath}`);
      }
      args.push('--config', normalised);
    }

    const result = spawnSync('npx', args, {
      encoding: 'utf-8',
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    try {
      return JSON.parse(result.stdout);
    } catch {
      return { suites: [], errors: [result.stderr] };
    }
  }

  /** Spawn a Playwright test run via node-pty (PTY for correct ANSI/color output) */
  async startRun(options: RunOptions, bridge: ReporterBridge): Promise<string> {
    const runId = randomUUID();
    const reporterPath = path.resolve(
      process.cwd(),
      'apps/server/src/reporter/ws-reporter.js',
    );

    // Read quarantined tests for --grep-invert (only approved ones)
    const quarantinedTests = await db.select().from(quarantine).where(eq(quarantine.status, 'approved'));
    const grepInvert = quarantinedTests.length > 0
      ? quarantinedTests.map(q => q.testTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
      : undefined;

    // Build CLI args
    const args = buildArgs(options, reporterPath, grepInvert);

    // Persist initial run record
    await db.insert(runs).values({
      id: runId,
      startedAt: new Date().toISOString(),
      status: 'running',
      total: 0,
      rawArgs: args.join(' '),
      config: JSON.stringify(options),
    });

    // Spawn via node-pty for authentic terminal output
    let ptyProcess: import('node-pty').IPty;
    try {
      const pty = await import('node-pty');
      const ptyModule = ('default' in pty ? (pty.default as typeof import('node-pty')) : pty);
      ptyProcess = ptyModule.spawn('npx', args, {
        name: 'xterm-256color',
        cols: 220,
        rows: 50,
        cwd: process.cwd(),
        env: {
          ...process.env,
          FORCE_COLOR: '3',
          DASHBOARD_RUN_ID: runId,
        },
      });

      ptyProcess.onData((data: string) => {
        bridge.broadcast({ type: 'stdout', runId, payload: { chunk: data } });
      });

      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        this.activeProcesses.delete(runId);
        try {
          db.update(runs)
            .set({ status: exitCode === 0 ? 'passed' : 'failed', finishedAt: new Date().toISOString() })
            .where(eq(runs.id, runId))
            .run();
        } catch (err) {
          process.stderr.write(`[runner] Failed to update run ${runId} status: ${(err as Error).message}\n`);
        }
      });
    } catch {
      // Fallback: plain spawn if node-pty unavailable
      process.stderr.write('[runner] node-pty unavailable, falling back to child_process.spawn\n');
      const { spawn } = await import('child_process');
      const proc = spawn('npx', args, {
        cwd: process.cwd(),
        env: { ...process.env, FORCE_COLOR: '3', DASHBOARD_RUN_ID: runId },
        shell: false,
      });

      proc.stdout.on('data', (data: Buffer) => {
        bridge.broadcast({ type: 'stdout', runId, payload: { chunk: data.toString() } });
      });
      proc.stderr.on('data', (data: Buffer) => {
        bridge.broadcast({ type: 'stderr', runId, payload: { chunk: data.toString() } });
      });
      proc.on('close', (code) => {
        this.activeProcesses.delete(runId);
        try {
          db.update(runs)
            .set({ status: code === 0 ? 'passed' : 'failed', finishedAt: new Date().toISOString() })
            .where(eq(runs.id, runId))
            .run();
        } catch (err) {
          process.stderr.write(`[runner] Failed to update run ${runId} status: ${(err as Error).message}\n`);
        }
      });

      this.activeProcesses.set(runId, { pid: proc.pid ?? 0, kill: () => proc.kill('SIGTERM') });
      return runId;
    }

    this.activeProcesses.set(runId, {
      pid: ptyProcess.pid,
      kill: () => ptyProcess.kill('SIGTERM'),
    });

    return runId;
  }

  /** Abort a running test process */
  abortRun(runId: string): boolean {
    const proc = this.activeProcesses.get(runId);
    if (!proc) return false;
    proc.kill();
    this.activeProcesses.delete(runId);
    db.update(runs).set({ status: 'interrupted', finishedAt: new Date().toISOString() }).where(eq(runs.id, runId)).run();
    return true;
  }

  isRunning(runId: string): boolean {
    return this.activeProcesses.has(runId);
  }
}

function buildArgs(opts: RunOptions, reporterPath: string, grepInvert?: string): string[] {
  const args = ['playwright', 'test'];

  if (opts.configPath) {
    const normalised = path.normalize(opts.configPath);
    if (path.isAbsolute(normalised) || normalised.includes('..') || !/\.(ts|js|json)$/.test(normalised)) {
      throw new Error(`Invalid config path: ${opts.configPath}`);
    }
    args.push('--config', normalised);
  }
  if (opts.workers !== undefined) args.push('--workers', String(opts.workers));
  if (opts.retries !== undefined) args.push('--retries', String(opts.retries));
  if (opts.timeout !== undefined) args.push('--timeout', String(opts.timeout));
  if (opts.maxFailures !== undefined) args.push('--max-failures', String(opts.maxFailures));
  if (opts.headed) args.push('--headed');
  if (opts.lastFailed) args.push('--last-failed');
  if (opts.updateSnapshots) args.push('--update-snapshots');
  if (opts.dryRun) args.push('--list');

  // Combine explicit grep + tag-based grep into a single --grep argument
  // (Playwright CLI only uses the last --grep, so passing two would silently drop the first)
  const tagGrep = opts.tags?.length ? opts.tags.map((t) => `@${t}`).join('|') : '';
  const combinedGrep = [opts.grep, tagGrep].filter(Boolean).join('|');
  if (combinedGrep) args.push('--grep', combinedGrep);
  if (grepInvert) args.push('--grep-invert', grepInvert);
  if (opts.projects?.length) {
    for (const p of opts.projects) args.push('--project', p);
  }
  if (opts.trace) args.push('--trace', opts.trace);
  if (opts.shard) args.push('--shard', `${opts.shard.current}/${opts.shard.total}`);

  // Auto-capture screenshots on failure unless explicitly configured
  if (!opts.dryRun) {
    args.push('--screenshot=only-on-failure');
  }

  // Always add ws-reporter alongside json (json for list, ws for live streaming)
  args.push(`--reporter=${reporterPath}`);

  return args;
}

export const runner = new Runner();
