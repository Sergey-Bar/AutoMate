import * as fs from 'node:fs';
import * as path from 'node:path';
import { and, count, desc, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { qualityGateConfig, quarantine, results, runs, schedules, suites, tests } from '../db/schema.js';
import { MCP_ERROR_CODES } from './contract.js';
import { DEFAULT_QUERY_LIMIT } from '../constants.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }> };
type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

function ok(content: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(content) }],
  };
}

function internalError(err: unknown): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: MCP_ERROR_CODES.INTERNAL_ERROR,
        message: err instanceof Error ? err.message : 'Unknown error',
      }),
    }],
  };
}

function invalidInput(message: string): ToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error: MCP_ERROR_CODES.INVALID_INPUT,
        message,
      }),
    }],
  };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function cutoffDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function deriveSeverity(countValue: number): 'critical' | 'high' | 'medium' | 'low' {
  if (countValue >= 10) return 'critical';
  if (countValue >= 5) return 'high';
  if (countValue >= 2) return 'medium';
  return 'low';
}

function parseEnvironment(config: string | null): string | undefined {
  if (!config) return undefined;

  try {
    const parsed = JSON.parse(config) as { environment?: unknown };
    if (typeof parsed?.environment === 'string' && parsed.environment.length > 0) {
      return parsed.environment;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export function createToolHandlers(): Record<string, ToolHandler> {
  return {
    'runs.list_recent': async (args) => {
      try {
        const workspaceId = asString(args.workspaceId);
        const limit = asNumber(args.limit, 20);
        const rows = await db
          .select()
          .from(runs)
          .where(workspaceId ? eq(runs.workspaceId, workspaceId) : undefined)
          .orderBy(desc(runs.startedAt))
          .limit(limit);

        return ok({
          runs: rows.map((run) => ({
            id: run.id,
            name: run.branch ?? `Run ${run.id}`,
            status: run.status,
            startedAt: run.startedAt,
            duration: run.durationMs ?? 0,
            totalTests: run.total,
            passed: run.passed,
            failed: run.failed,
          })),
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'runs.get_summary_by_id': async (args) => {
      try {
        const runId = asString(args.runId);
        if (!runId) return invalidInput('runId is required');

        const runRows = await db.select().from(runs).where(eq(runs.id, runId));
        const run = runRows[0];
        if (!run) return invalidInput(`Run not found: ${runId}`);

        const suiteRows = await db
          .select({ count: count() })
          .from(suites)
          .where(eq(suites.runId, runId));

        return ok({
          run: {
            id: run.id,
            name: run.branch ?? `Run ${run.id}`,
            status: run.status,
            startedAt: run.startedAt,
            duration: run.durationMs ?? 0,
            totalTests: run.total,
            passed: run.passed,
            failed: run.failed,
            skipped: run.skipped,
            suites: suiteRows[0]?.count ?? 0,
            environment: parseEnvironment(run.config),
          },
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'tests.get_failures_by_run': async (args) => {
      try {
        const runId = asString(args.runId);
        if (!runId) return invalidInput('runId is required');

        const limit = asNumber(args.limit, 20);
        const rows = await db
          .select({
            testId: results.testId,
            title: tests.title,
            file: tests.file,
            errorMessage: results.errorMessage,
            errorStack: results.errorStack,
            durationMs: results.durationMs,
          })
          .from(results)
          .innerJoin(tests, and(eq(results.testId, tests.id), eq(results.runId, tests.runId)))
          .where(and(eq(results.runId, runId), eq(results.status, 'failed')))
          .limit(limit);

        return ok({
          failures: rows.map((row) => ({
            testId: row.testId,
            name: row.title,
            suiteName: row.file,
            errorMessage: row.errorMessage ?? 'Unknown error',
            errorStack: row.errorStack ?? undefined,
            duration: row.durationMs ?? 0,
          })),
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'analytics.get_pass_rate': async (args) => {
      try {
        const workspaceId = asString(args.workspaceId);
        const days = asNumber(args.days, 30);
        const cutoff = cutoffDate(days);

        const rows = await db
          .select({
            date: sql<string>`substr(${runs.startedAt}, 1, 10)`.as('date'),
            passed: sql<number>`sum(${runs.passed})`.as('passed'),
            total: sql<number>`sum(${runs.total})`.as('total'),
          })
          .from(runs)
          .where(
            and(
              sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`,
              ne(runs.status, 'running'),
              workspaceId ? eq(runs.workspaceId, workspaceId) : undefined,
            ),
          )
          .groupBy(sql`substr(${runs.startedAt}, 1, 10)`)
          .orderBy(sql`substr(${runs.startedAt}, 1, 10)`);

        const runCountRows = await db
          .select({ value: count(runs.id) })
          .from(runs)
          .where(
            and(
              sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`,
              ne(runs.status, 'running'),
              workspaceId ? eq(runs.workspaceId, workspaceId) : undefined,
            ),
          );

        const totals = rows.reduce(
          (acc, row) => ({
            passed: acc.passed + (row.passed ?? 0),
            total: acc.total + (row.total ?? 0),
          }),
          { passed: 0, total: 0 },
        );

        return ok({
          passRate: totals.total > 0 ? totals.passed / totals.total : 0,
          totalRuns: runCountRows[0]?.value ?? 0,
          period: {
            from: cutoff,
            to: new Date().toISOString().slice(0, 10),
          },
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'analytics.get_duration_trend': async (args) => {
      try {
        const workspaceId = asString(args.workspaceId);
        const days = asNumber(args.days, 30);
        const cutoff = cutoffDate(days);

        const rows = await db
          .select({
            date: sql<string>`substr(${runs.startedAt}, 1, 10)`.as('date'),
            durationMs: runs.durationMs,
          })
          .from(runs)
          .where(
            and(
              sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`,
              isNotNull(runs.durationMs),
              ne(runs.status, 'running'),
              workspaceId ? eq(runs.workspaceId, workspaceId) : undefined,
            ),
          )
          .orderBy(sql`substr(${runs.startedAt}, 1, 10)`);

        const byDate = new Map<string, number[]>();
        for (const row of rows) {
          if (row.durationMs == null) continue;
          if (!byDate.has(row.date)) byDate.set(row.date, []);
          byDate.get(row.date)?.push(row.durationMs);
        }

        const trend = Array.from(byDate.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, durations]) => ({
            date,
            avgDuration: durations.reduce((sum, value) => sum + value, 0) / durations.length,
            runCount: durations.length,
          }));

        return ok({ trend });
      } catch (err) {
        return internalError(err);
      }
    },

    'tests.get_error_clusters': async (args) => {
      try {
        const runId = asString(args.runId);
        const limit = asNumber(args.limit, 20);
        if (!runId) {
          return ok({ clusters: [] });
        }

        const { clusterErrors } = await import('../services/error-clustering.js');
        const clusters = await clusterErrors(runId);

        return ok({
          clusters: clusters.slice(0, limit).map((cluster) => ({
            clusterId: cluster.clusterId,
            pattern: cluster.sampleError,
            count: cluster.count,
            severity: deriveSeverity(cluster.count),
            examples: cluster.testIds.slice(0, 3),
          })),
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'tests.get_predictive_candidates': async (args) => {
      try {
        const changedFiles = Array.isArray(args.changedFiles)
          ? args.changedFiles.filter((f): f is string => typeof f === 'string')
          : [];

        try {
          const service = await import('../services/predictive-selection.js');
          const result = await service.getPredictiveCandidates(changedFiles, process.cwd());

          return ok({
            candidates: result.candidates.map((candidate) => ({
              testId: candidate.testFile,
              testName: candidate.title,
              score: candidate.score,
              reason: candidate.reason,
            })),
            mode: result.mode,
          });
        } catch {
          return ok({ candidates: [], mode: 'static_only' });
        }
      } catch (err) {
        return internalError(err);
      }
    },

    'quarantine.list_quarantined': async (args) => {
      try {
        const limit = asNumber(args.limit, DEFAULT_QUERY_LIMIT);
        const rows = await db.select().from(quarantine).limit(limit);
        return ok({
          tests: rows.map((row) => ({
            id: row.id,
            testTitle: row.testTitle,
            testFile: row.testFile ?? undefined,
            reason: row.reason ?? 'No reason provided',
            quarantinedAt: row.quarantinedAt,
            quarantinedBy: row.quarantinedBy ?? 'manual',
          })),
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'quarantine.get_details': async (args) => {
      try {
        const testTitle = asString(args.testTitle);
        if (!testTitle) return invalidInput('testTitle is required');
        const rows = await db.select().from(quarantine).where(eq(quarantine.testTitle, testTitle));
        const row = rows[0];
        return ok({
          quarantine: row ? {
            id: row.id,
            testTitle: row.testTitle,
            testFile: row.testFile ?? undefined,
            reason: row.reason ?? 'No reason provided',
            quarantinedAt: row.quarantinedAt,
            quarantinedBy: row.quarantinedBy ?? 'manual',
          } : null,
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'runs.compare': async (args) => {
      try {
        const baseRunId = asString(args.baseRunId);
        const headRunId = asString(args.headRunId);
        if (!baseRunId) return invalidInput('baseRunId is required');
        if (!headRunId) return invalidInput('headRunId is required');

        const baseResults = await db
          .select({
            stableId: tests.stableId,
            title: tests.title,
            status: results.status,
            errorMessage: results.errorMessage,
          })
          .from(results)
          .innerJoin(tests, and(eq(results.testId, tests.id), eq(results.runId, tests.runId)))
          .where(eq(results.runId, baseRunId));

        const headResults = await db
          .select({
            stableId: tests.stableId,
            title: tests.title,
            status: results.status,
            errorMessage: results.errorMessage,
          })
          .from(results)
          .innerJoin(tests, and(eq(results.testId, tests.id), eq(results.runId, tests.runId)))
          .where(eq(results.runId, headRunId));

        const baseMap = new Map(baseResults.map((r) => [r.stableId, r]));
        const headMap = new Map(headResults.map((r) => [r.stableId, r]));

        const newFailures: Array<{ testId: string; testName: string; errorMessage: string }> = [];
        const fixed: Array<{ testId: string; testName: string }> = [];
        const regressions: Array<{ testId: string; testName: string; baseStatus: string; headStatus: string }> = [];

        for (const [stableId, head] of headMap) {
          const base = baseMap.get(stableId);
          if (head.status === 'failed') {
            if (!base || base.status === 'passed') {
              newFailures.push({
                testId: stableId ?? head.title,
                testName: head.title,
                errorMessage: head.errorMessage ?? 'Unknown error',
              });
            } else if (base.status !== 'failed') {
              regressions.push({
                testId: stableId ?? head.title,
                testName: head.title,
                baseStatus: base.status,
                headStatus: head.status,
              });
            }
          } else if (head.status === 'passed' && base && base.status === 'failed') {
            fixed.push({
              testId: stableId ?? head.title,
              testName: head.title,
            });
          }
        }

        return ok({
          newFailures,
          fixed,
          regressions,
          summary: {
            baseTotal: baseResults.length,
            headTotal: headResults.length,
            basePassed: baseResults.filter((r) => r.status === 'passed').length,
            headPassed: headResults.filter((r) => r.status === 'passed').length,
          },
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'tests.get_flaky': async (args) => {
      try {
        const days = asNumber(args.days, 14);
        const minFlipCount = asNumber(args.minFlipCount, 3);
        const cutoff = cutoffDate(days);

        const rows = await db
          .select({
            stableId: tests.stableId,
            title: tests.title,
            file: tests.file,
            flakyCount: sql<number>`sum(case when ${tests.status} = 'flaky' then 1 else 0 end)`.as('flaky_count'),
            totalRuns: count(tests.id).as('total_runs'),
            lastSeen: sql<string>`max(${runs.startedAt})`.as('last_seen'),
          })
          .from(tests)
          .innerJoin(runs, eq(tests.runId, runs.id))
          .where(sql`substr(${runs.startedAt}, 1, 10) >= ${cutoff}`)
          .groupBy(tests.stableId)
          .orderBy(sql`flaky_count DESC`);

        const filtered = rows.filter((r) => r.flakyCount >= minFlipCount && r.stableId);

        return ok({
          flakyTests: filtered.map((r) => ({
            stableId: r.stableId!,
            testName: r.title,
            testFile: r.file,
            flakyCount: r.flakyCount,
            totalRuns: r.totalRuns,
            lastSeen: r.lastSeen,
          })),
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'schedules.list': async () => {
      try {
        const rows = await db.select().from(schedules);
        return ok({
          schedules: rows.map((row) => ({
            id: row.id,
            cronExpr: row.cronExpr,
            enabled: row.enabled ?? true,
            lastRunAt: row.lastRunAt ?? undefined,
            createdAt: row.createdAt,
          })),
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'schedules.get_by_id': async (args) => {
      try {
        const scheduleId = asString(args.scheduleId);
        if (!scheduleId) return invalidInput('scheduleId is required');
        const rows = await db.select().from(schedules).where(eq(schedules.id, scheduleId));
        const row = rows[0];
        return ok({
          schedule: row ? {
            id: row.id,
            cronExpr: row.cronExpr,
            runOptions: row.runOptions ?? undefined,
            enabled: row.enabled ?? true,
            lastRunAt: row.lastRunAt ?? undefined,
            createdAt: row.createdAt,
          } : null,
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'integrations.get_status': async () => {
      try {
        const INTEGRATION_TYPES = ['slack', 'jira', 'github', 'gitlab', 'email', 'webhooks'] as const;
        const configPath = path.resolve(process.cwd(), '.automate', 'integrations.json');

        let config: Record<string, unknown> = {};
        try {
          const raw = fs.readFileSync(configPath, 'utf-8');
          config = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          // No config file — all unconfigured
        }

        return ok({
          integrations: INTEGRATION_TYPES.map((type) => ({
            type,
            configured: config[type] != null,
          })),
        });
      } catch (err) {
        return internalError(err);
      }
    },

    'runs.get_gate_status': async (args) => {
      try {
        const runId = asString(args.runId);
        if (!runId) return invalidInput('runId is required');

        const runRows = await db.select().from(runs).where(eq(runs.id, runId));
        const run = runRows[0];
        if (!run) return invalidInput(`Run not found: ${runId}`);

        const cfgRows = await db.select().from(qualityGateConfig).where(eq(qualityGateConfig.id, 'global'));
        const threshold = cfgRows[0]?.passRateThreshold ?? 100;
        const passRate = run.total > 0 ? Math.round((run.passed / run.total) * 100) : 0;

        return ok({
          gateStatus: run.gateStatus ?? 'skipped',
          passed: run.gateStatus === 'passed',
          passRate,
          threshold,
          failedTests: run.failed,
          totalTests: run.total,
        });
      } catch (err) {
        return internalError(err);
      }
    },
  };
}
