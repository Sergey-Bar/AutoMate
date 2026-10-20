import { and, asc, eq, gte } from 'drizzle-orm';
import { qualityGateConfig, scanSnapshots } from '@automate/db';
import type { RepoScan, ScanSnapshot } from '@automate/shared-contracts';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * The project's readings over time: coverage, health score, maturity and flaky tests.
 *
 * ## Written on scan, at most once an hour
 *
 * The primary key is `(workspace, project, hour)` and the write is an upsert, so a rescan
 * inside the hour replaces that hour's reading and a busy afternoon of rescans is still one
 * point. The hour is computed here and not by the database because PGlite and PostgreSQL
 * must agree on it, and `date_trunc` against a session time zone would not.
 *
 * ## Every read names the workspace first
 *
 * `scan_snapshots.workspace_id` is `NOT NULL` from its first migration, and every query
 * here filters on it before the project — a project id from another workspace finds
 * nothing rather than another tenant's history.
 */
type Options = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

const HOUR_MS = 3_600_000;

export function hourOf(at: Date): Date {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS);
}

/** Mean line coverage over every coverage report the scan read, or `null` with none. */
export function meanCoverage(scan: Pick<RepoScan, 'reports'>): number | null {
  const lines = scan.reports
    .filter((report) => report.kind === 'coverage')
    .map((report) => report.metrics['lines'])
    .filter((value): value is number => typeof value === 'number' && value >= 0 && value <= 100);
  if (lines.length === 0) return null;
  return Math.round((lines.reduce((sum, value) => sum + value, 0) / lines.length) * 10) / 10;
}

export async function hasSnapshotFor(
  options: Options,
  projectId: string,
  at: Date,
): Promise<boolean> {
  const rows = await options.db
    .select({ hour: scanSnapshots.hour })
    .from(scanSnapshots)
    .where(
      and(
        eq(scanSnapshots.workspaceId, options.workspaceId),
        eq(scanSnapshots.projectId, projectId),
        eq(scanSnapshots.hour, hourOf(at)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function recordSnapshot(
  options: Options,
  projectId: string,
  reading: Omit<ScanSnapshot, 'at'>,
  at: Date,
): Promise<void> {
  const values = {
    workspaceId: options.workspaceId,
    projectId,
    hour: hourOf(at),
    takenAt: at,
    coverage: reading.coverage,
    healthScore: reading.healthScore,
    maturity: reading.maturity,
    flakyTests: reading.flakyTests,
  };
  await options.db
    .insert(scanSnapshots)
    .values(values)
    .onConflictDoUpdate({
      target: [scanSnapshots.workspaceId, scanSnapshots.projectId, scanSnapshots.hour],
      set: {
        takenAt: values.takenAt,
        coverage: values.coverage,
        healthScore: values.healthScore,
        maturity: values.maturity,
        flakyTests: values.flakyTests,
      },
    });
}

export async function readHistory(
  options: Options,
  projectId: string,
  since: Date,
): Promise<{ points: ScanSnapshot[]; collectingSince: string | null }> {
  const scope = and(
    eq(scanSnapshots.workspaceId, options.workspaceId),
    eq(scanSnapshots.projectId, projectId),
  );
  const rows = await options.db
    .select()
    .from(scanSnapshots)
    .where(and(scope, gte(scanSnapshots.takenAt, since)))
    .orderBy(asc(scanSnapshots.takenAt));
  const first = await options.db
    .select({ takenAt: scanSnapshots.takenAt })
    .from(scanSnapshots)
    .where(scope)
    .orderBy(asc(scanSnapshots.takenAt))
    .limit(1);
  return {
    points: rows.map((row) => ({
      at: row.takenAt.toISOString(),
      coverage: row.coverage,
      healthScore: row.healthScore,
      maturity: row.maturity,
      flakyTests: row.flakyTests,
    })),
    collectingSince: first[0]?.takenAt.toISOString() ?? null,
  };
}

/** The release pass-rate threshold when the project and the workspace declare none. */
export const DEFAULT_RELEASE_PASS_RATE = 95;

/**
 * The project's own gate threshold, else the workspace default gate's, else 95%.
 *
 * Read from `quality_gate_config`, which the gate evaluation path already reads, so the
 * readiness card and the gate cannot use two different numbers for one project.
 */
export async function passRateThreshold(options: Options, projectId: string): Promise<number> {
  const rows = await options.db
    .select({
      projectId: qualityGateConfig.projectId,
      threshold: qualityGateConfig.passRateThreshold,
    })
    .from(qualityGateConfig)
    .where(eq(qualityGateConfig.workspaceId, options.workspaceId));
  const own = rows.find((row) => row.projectId === projectId);
  const fallback = rows.find((row) => row.projectId === null);
  return own?.threshold ?? fallback?.threshold ?? DEFAULT_RELEASE_PASS_RATE;
}
