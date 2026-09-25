/**
 * apps/server/src/services/data-retention.ts
 *
 * Configurable data retention cleanup — deletes old test runs, results,
 * NL query history, and attachments. Preserves trend rollup data.
 *
 * Config stored at .automate/data-retention.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { db, isPostgres, sqlite } from '../db/client.js';
import { runs, results, attachments, nlQueryHistory, trends } from '../db/schema.js';
import { lt, inArray } from 'drizzle-orm';

// ── Types ────────────────────────────────────────────────────────────────────

export interface RetentionConfig {
  /** Days to keep test run data (runs + results + tests + suites). Default: 90 */
  testResultDays: number;
  /** Days to keep NL query history. Default: 30 */
  nlQueryHistoryDays: number;
  /** Days to keep attachment files. Default: 60 */
  attachmentDays: number;
  /** Days to keep trend rollups. -1 = forever. Default: -1 */
  trendsDays: number;
  /** Whether automatic cleanup is enabled. Default: false */
  enabled: boolean;
}

export interface CleanupResult {
  deletedRuns: number;
  deletedResults: number;
  deletedNlQueries: number;
  deletedAttachments: number;
  durationMs: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.resolve(process.cwd(), '.automate', 'data-retention.json');

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  testResultDays: 90,
  nlQueryHistoryDays: 30,
  attachmentDays: 60,
  trendsDays: -1, // keep forever
  enabled: false,
};

// ── Config I/O ───────────────────────────────────────────────────────────────

export function loadRetentionConfig(): RetentionConfig {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return { ...DEFAULT_RETENTION_CONFIG, ...JSON.parse(raw) };
    } catch {
      return DEFAULT_RETENTION_CONFIG;
    }
  }
  return DEFAULT_RETENTION_CONFIG;
}

export function saveRetentionConfig(config: RetentionConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

// ── Utilities ────────────────────────────────────────────────────────────────

export function getRetentionCutoffDate(days: number): string {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return cutoff.toISOString();
}

export function formatCleanupResult(result: CleanupResult): string {
  return [
    `Cleanup complete in ${result.durationMs}ms:`,
    `  ${result.deletedRuns} runs`,
    `  ${result.deletedResults} results`,
    `  ${result.deletedNlQueries} NL queries`,
    `  ${result.deletedAttachments} attachments`,
  ].join('\n');
}

// ── Main cleanup ─────────────────────────────────────────────────────────────

/**
 * Run data retention cleanup based on config.
 * Cascade deletes handle tests/suites/results linked to runs via FK.
 * Attachments are deleted based on their parent result's run age.
 */
export interface RetentionLogger {
  info: (msg: string) => void;
}

export async function runRetentionCleanup(
  config?: RetentionConfig,
  logger?: RetentionLogger,
): Promise<CleanupResult> {
  const cfg = config ?? loadRetentionConfig();
  const start = Date.now();

  let deletedRuns = 0;
  let deletedResults = 0;
  let deletedNlQueries = 0;
  let deletedAttachments = 0;

  // 1. Delete old runs (cascades to tests, suites, results, attachments via FK)
  if (cfg.testResultDays > 0) {
    const cutoff = getRetentionCutoffDate(cfg.testResultDays);

    // Count results that will be deleted (for reporting)
    const oldRunIds = await db
      .select({ id: runs.id })
      .from(runs)
      .where(lt(runs.startedAt, cutoff));

    if (oldRunIds.length > 0) {
      const ids = oldRunIds.map((r) => r.id);

      // Count results before cascade delete
      const resultRows = await db
        .select({ id: results.id })
        .from(results)
        .where(inArray(results.runId, ids));
      deletedResults = resultRows.length;

      // Count attachments before cascade delete
      const attachmentRows = await db
        .select({ id: attachments.id })
        .from(attachments)
        .where(
          inArray(
            attachments.resultId,
            resultRows.map((r) => r.id),
          ),
        );
      deletedAttachments = attachmentRows.length;

      // Delete runs — FK cascade handles tests, suites, results, attachments
      await db.delete(runs).where(lt(runs.startedAt, cutoff));
      deletedRuns = oldRunIds.length;
    }
  }

  // 2. Delete old NL query history
  if (cfg.nlQueryHistoryDays > 0) {
    const cutoff = getRetentionCutoffDate(cfg.nlQueryHistoryDays);
    const deleted = await db
      .delete(nlQueryHistory)
      .where(lt(nlQueryHistory.createdAt, cutoff))
      .returning();
    deletedNlQueries = deleted.length;
  }

  // 3. Trends — only delete if trendsDays > 0 (not -1 = forever)
  if (cfg.trendsDays > 0) {
    const cutoff = getRetentionCutoffDate(cfg.trendsDays);
    await db.delete(trends).where(lt(trends.date, cutoff));
  }

  const durationMs = Date.now() - start;

  const result: CleanupResult = {
    deletedRuns,
    deletedResults,
    deletedNlQueries,
    deletedAttachments,
    durationMs,
  };

  const log = logger ?? { info: (msg: string) => process.stdout.write(`[data-retention] ${msg}\n`) };
  log.info(formatCleanupResult(result));
  return result;
}

// ── DB size monitoring ───────────────────────────────────────────────────────

export function getDbSizeBytes(): number {
  if (isPostgres) return 0;
  try {
    const pageCount = (sqlite as any).prepare('PRAGMA page_count').get()['page_count'];
    const pageSize = (sqlite as any).prepare('PRAGMA page_size').get()['page_size'];
    return pageCount * pageSize;
  } catch {
    return 0;
  }
}

export function getDbStats(): { sizeBytes: number; sizeMB: string; pageCount: number; pageSize: number } {
  const sizeBytes = getDbSizeBytes();
  if (isPostgres) {
    return {
      sizeBytes,
      sizeMB: '0.00',
      pageCount: 0,
      pageSize: 0,
    };
  }
  try {
    const pageCount = (sqlite as any).prepare('PRAGMA page_count').get()['page_count'];
    const pageSize = (sqlite as any).prepare('PRAGMA page_size').get()['page_size'];
    return {
      sizeBytes,
      sizeMB: (sizeBytes / (1024 * 1024)).toFixed(2),
      pageCount,
      pageSize,
    };
  } catch {
    return {
      sizeBytes: 0,
      sizeMB: '0.00',
      pageCount: 0,
      pageSize: 0,
    };
  }
}
