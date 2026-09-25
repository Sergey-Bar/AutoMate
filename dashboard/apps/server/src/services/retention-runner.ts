/**
 * apps/server/src/services/retention-runner.ts
 *
 * Periodically runs data retention cleanup on a configurable interval.
 * Factory function pattern — no module-level singletons.
 *
 * Interval defaults to 1 hour (3_600_000 ms). Override via:
 *   - RETENTION_INTERVAL_MS environment variable
 *   - options.intervalMs in createRetentionRunner(options)
 */
import { loadRetentionConfig, runRetentionCleanup } from './data-retention.js';
import type { CleanupResult } from './data-retention.js';

export type { CleanupResult };

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RetentionRunnerOptions {
  intervalMs?: number;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (obj: { err: unknown }, msg: string) => void;
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 3_600_000; // 1 hour

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a retention runner that periodically executes data retention cleanup.
 *
 * @example
 * const runner = createRetentionRunner({ logger: app.log });
 * runner.start();
 * // on shutdown:
 * runner.stop();
 */
export function createRetentionRunner(options?: RetentionRunnerOptions) {
  const intervalMs =
    options?.intervalMs ??
    (process.env.RETENTION_INTERVAL_MS
      ? parseInt(process.env.RETENTION_INTERVAL_MS, 10)
      : DEFAULT_INTERVAL_MS);

  const logger = options?.logger ?? {
    info: (msg: string) => process.stdout.write(`[retention-runner] ${msg}\n`),
    warn: (msg: string) => process.stderr.write(`[retention-runner] ${msg}\n`),
    error: (obj: { err: unknown }, msg: string) =>
      process.stderr.write(
        `[retention-runner] ${msg}: ${(obj.err as Error)?.message ?? String(obj.err)}\n`,
      ),
  };

  let timer: ReturnType<typeof setInterval> | null = null;

  /**
   * Runs one cleanup cycle. Re-reads config each time so changes are
   * picked up without a restart. If disabled, skips cleanup but does NOT
   * stop the interval (config may re-enable later).
   */
  async function runCycle(): Promise<CleanupResult> {
    const config = loadRetentionConfig();
    if (!config.enabled) {
      logger.info('Retention cleanup skipped — disabled in config');
      return {
        deletedRuns: 0,
        deletedResults: 0,
        deletedNlQueries: 0,
        deletedAttachments: 0,
        durationMs: 0,
      };
    }
    try {
      return await runRetentionCleanup(config, logger);
    } catch (err) {
      logger.error({ err }, 'Retention cleanup failed');
      return {
        deletedRuns: 0,
        deletedResults: 0,
        deletedNlQueries: 0,
        deletedAttachments: 0,
        durationMs: 0,
      };
    }
  }

  return {
    /**
     * Starts the retention runner. Checks config first — if disabled, logs
     * and returns without creating an interval. Calling start() when already
     * running is a no-op (logs a warning).
     */
    start(): void {
      if (timer !== null) {
        logger.warn('Retention runner is already running — ignoring duplicate start()');
        return;
      }

      const config = loadRetentionConfig();
      if (!config.enabled) {
        logger.info('Retention cleanup is disabled — not starting runner');
        return;
      }

      // Run immediately, then on each interval tick
      void runCycle();

      timer = setInterval(() => {
        void runCycle();
      }, intervalMs);
    },

    /**
     * Stops the interval timer. Safe to call when not running (no-op).
     */
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },

    /**
     * Returns whether the interval is currently active.
     */
    isRunning(): boolean {
      return timer !== null;
    },

    /**
     * Manually triggers a cleanup cycle, bypassing the enabled check.
     * Useful for admin endpoints and testing.
     */
    runNow(): Promise<CleanupResult> {
      return runRetentionCleanup(loadRetentionConfig(), logger);
    },
  };
}
