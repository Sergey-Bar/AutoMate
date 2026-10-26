import { and, desc, eq, notInArray } from 'drizzle-orm';
import { coverageLineMaps, diffCoverageResults } from '@automate/db';
import type { LineCoverageFile } from '@automate/reporter';
import { diffCoverage } from '@automate/reporting';
import type { DiffCoverageRecord, DiffCoverageStatus } from '@automate/shared-contracts';
import { z } from 'zod/v4';
import { projectRow, type HealthStoreOptions } from './health-findings.js';

/**
 * Diff coverage, from two uploads that may arrive in either order.
 *
 * A coverage upload naming a commit stores that commit's line map; a `git-diff` upload stores
 * the commit's added lines. **Whichever arrives second computes**: a diff finds the line map
 * already there, or a line map finds the diffs waiting for it. Both are keyed by commit, so
 * the pair always describes the same tree.
 *
 * ## Several coverage reports for one commit are one measurement
 *
 * Shards of one test run each upload part of the line map. They are merged — a line is
 * executable if any report says so and covered if any report ran it — which is also why a
 * re-upload of the same report changes nothing. The merge is read, merged and written inside
 * one transaction holding the commit's row `FOR UPDATE`, so shards uploading at once each
 * merge into the other's lines rather than overwriting them.
 *
 * ## Bounded
 *
 * Each table keeps the {@link DIFF_COVERAGE_RETENTION} most recently received rows per
 * project, pruned on every write: a pull request's diff coverage matters while it is open,
 * and an unbounded per-commit history would grow with every push.
 */
export const DIFF_COVERAGE_RETENTION = 50;

const FilesSchema = z.array(
  z.object({
    path: z.string(),
    executable: z.array(z.number().int()),
    covered: z.array(z.number().int()),
  }),
);
const ChangedSchema = z.array(z.object({ path: z.string(), lines: z.array(z.number().int()) }));
const UncoveredSchema = z.array(z.object({ path: z.string(), lines: z.array(z.number().int()) }));

function readFiles(raw: unknown): LineCoverageFile[] {
  const parsed = FilesSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

function readChanged(raw: unknown): Map<string, Set<number>> {
  const parsed = ChangedSchema.safeParse(raw);
  return new Map(
    (parsed.success ? parsed.data : []).map((file) => [file.path, new Set(file.lines)]),
  );
}

/** Union per path: executable if any report says so, covered if any report ran it. */
export function mergeLineMaps(
  left: readonly LineCoverageFile[],
  right: readonly LineCoverageFile[],
): LineCoverageFile[] {
  const byPath = new Map<string, { executable: Set<number>; covered: Set<number> }>();
  for (const file of [...left, ...right]) {
    const entry = byPath.get(file.path) ?? { executable: new Set(), covered: new Set() };
    for (const line of file.executable) entry.executable.add(line);
    for (const line of file.covered) entry.covered.add(line);
    byPath.set(file.path, entry);
  }
  const sorted = (lines: Set<number>) => [...lines].sort((a, b) => a - b);
  return [...byPath]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, entry]) => ({
      path,
      executable: sorted(entry.executable),
      covered: sorted(entry.covered),
    }));
}

function scope<T extends typeof coverageLineMaps | typeof diffCoverageResults>(
  table: T,
  options: HealthStoreOptions,
  projectId: string,
) {
  return and(eq(table.workspaceId, options.workspaceId), eq(table.projectId, projectId));
}

async function pruneLineMaps(options: HealthStoreOptions, projectId: string): Promise<void> {
  const keep = options.db
    .select({ id: coverageLineMaps.id })
    .from(coverageLineMaps)
    .where(scope(coverageLineMaps, options, projectId))
    .orderBy(desc(coverageLineMaps.receivedAt), desc(coverageLineMaps.id))
    .limit(DIFF_COVERAGE_RETENTION);
  await options.db
    .delete(coverageLineMaps)
    .where(and(scope(coverageLineMaps, options, projectId), notInArray(coverageLineMaps.id, keep)));
}

async function pruneDiffs(options: HealthStoreOptions, projectId: string): Promise<void> {
  const keep = options.db
    .select({ id: diffCoverageResults.id })
    .from(diffCoverageResults)
    .where(scope(diffCoverageResults, options, projectId))
    .orderBy(desc(diffCoverageResults.receivedAt), desc(diffCoverageResults.id))
    .limit(DIFF_COVERAGE_RETENTION);
  await options.db
    .delete(diffCoverageResults)
    .where(
      and(scope(diffCoverageResults, options, projectId), notInArray(diffCoverageResults.id, keep)),
    );
}

async function lineMapFor(
  options: HealthStoreOptions,
  projectId: string,
  commit: string,
): Promise<LineCoverageFile[] | null> {
  const rows = await options.db
    .select({ files: coverageLineMaps.files })
    .from(coverageLineMaps)
    .where(and(scope(coverageLineMaps, options, projectId), eq(coverageLineMaps.commitSha, commit)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : readFiles(row.files);
}

async function computeInto(
  options: HealthStoreOptions,
  id: string,
  changed: Map<string, Set<number>>,
  files: readonly LineCoverageFile[],
  now: Date,
): Promise<void> {
  const result = diffCoverage(changed, { files });
  await options.db
    .update(diffCoverageResults)
    .set({
      covered: result.covered,
      executable: result.executable,
      ratio: result.ratio,
      uncovered: result.uncovered,
      unmeasuredFiles: result.unmeasuredFiles,
      computedAt: now,
    })
    .where(
      and(eq(diffCoverageResults.workspaceId, options.workspaceId), eq(diffCoverageResults.id, id)),
    );
}

/**
 * Stores (merges) a commit's line map and computes every diff of that commit that was waiting.
 * Returns how many diff coverage results it computed.
 */
export async function storeLineMap(
  options: HealthStoreOptions,
  input: {
    projectId: string;
    branch: string;
    commit: string;
    files: readonly LineCoverageFile[];
    reportId: string | null;
    now: Date;
  },
): Promise<number> {
  const merged = await options.db.transaction(async (tx) => {
    // Make sure the row exists, then lock it: a concurrent shard's insert waits on this one,
    // and its `FOR UPDATE` waits for this transaction, so it merges into what this one wrote
    // rather than into the map both read before either wrote.
    await tx
      .insert(coverageLineMaps)
      .values({
        workspaceId: options.workspaceId,
        projectId: input.projectId,
        commitSha: input.commit,
        branch: input.branch,
        files: [],
        reportId: input.reportId,
        receivedAt: input.now,
      })
      .onConflictDoNothing({
        target: [
          coverageLineMaps.workspaceId,
          coverageLineMaps.projectId,
          coverageLineMaps.commitSha,
        ],
      });
    const [locked] = await tx
      .select({ files: coverageLineMaps.files })
      .from(coverageLineMaps)
      .where(
        and(
          scope(coverageLineMaps, options, input.projectId),
          eq(coverageLineMaps.commitSha, input.commit),
        ),
      )
      .for('update');
    const files = mergeLineMaps(readFiles(locked?.files), input.files);
    await tx
      .update(coverageLineMaps)
      .set({ files, branch: input.branch, reportId: input.reportId, receivedAt: input.now })
      .where(
        and(
          scope(coverageLineMaps, options, input.projectId),
          eq(coverageLineMaps.commitSha, input.commit),
        ),
      );
    return files;
  });
  await pruneLineMaps(options, input.projectId);
  const waiting = await options.db
    .select({ id: diffCoverageResults.id, changed: diffCoverageResults.changed })
    .from(diffCoverageResults)
    .where(
      and(
        scope(diffCoverageResults, options, input.projectId),
        eq(diffCoverageResults.commitSha, input.commit),
      ),
    );
  for (const row of waiting) {
    await computeInto(options, row.id, readChanged(row.changed), merged, input.now);
  }
  return waiting.length;
}

/** Stores a commit's diff, and computes its coverage at once when the line map is already here. */
export async function storeDiff(
  options: HealthStoreOptions,
  input: {
    projectId: string;
    branch: string;
    commit: string;
    changed: ReadonlyMap<string, ReadonlySet<number>>;
    reportId: string;
    now: Date;
  },
): Promise<boolean> {
  const changed = [...input.changed]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, lines]) => ({ path, lines: [...lines].sort((a, b) => a - b) }));
  const reset = {
    changed,
    covered: null,
    executable: null,
    ratio: null,
    uncovered: null,
    unmeasuredFiles: null,
    computedAt: null,
    reportId: input.reportId,
    receivedAt: input.now,
  };
  const [row] = await options.db
    .insert(diffCoverageResults)
    .values({
      workspaceId: options.workspaceId,
      projectId: input.projectId,
      branch: input.branch,
      commitSha: input.commit,
      ...reset,
    })
    .onConflictDoUpdate({
      target: [
        diffCoverageResults.workspaceId,
        diffCoverageResults.projectId,
        diffCoverageResults.branch,
        diffCoverageResults.commitSha,
      ],
      set: reset,
    })
    .returning({ id: diffCoverageResults.id });
  await pruneDiffs(options, input.projectId);
  const files = await lineMapFor(options, input.projectId, input.commit);
  if (row === undefined || files === null) return false;
  await computeInto(options, row.id, readChanged(changed), files, input.now);
  return true;
}

function recordOf(row: typeof diffCoverageResults.$inferSelect): DiffCoverageRecord | null {
  if (row.computedAt === null || row.covered === null || row.executable === null) return null;
  const uncovered = UncoveredSchema.safeParse(row.uncovered);
  const unmeasured = z.array(z.string()).safeParse(row.unmeasuredFiles);
  return {
    covered: row.covered,
    executable: row.executable,
    // `real` is single precision; the ratio is reported from the exact counts instead.
    ratio: row.executable === 0 ? null : row.covered / row.executable,
    uncovered: uncovered.success ? uncovered.data : [],
    unmeasuredFiles: unmeasured.success ? unmeasured.data : [],
    computedAt: row.computedAt.toISOString(),
  };
}

/** `GET …/health/diff-coverage?commit=`: the commit's latest diff, and what it is waiting for. */
export async function diffCoverageStatus(
  options: HealthStoreOptions,
  projectId: string,
  commit: string,
): Promise<DiffCoverageStatus> {
  const project = await projectRow(options, projectId);
  const [rows, files] = await Promise.all([
    options.db
      .select()
      .from(diffCoverageResults)
      .where(
        and(
          scope(diffCoverageResults, options, project.id),
          eq(diffCoverageResults.commitSha, commit),
        ),
      )
      .orderBy(desc(diffCoverageResults.receivedAt), desc(diffCoverageResults.id))
      .limit(1),
    lineMapFor(options, project.id, commit),
  ]);
  const row = rows[0];
  const result = row === undefined ? null : recordOf(row);
  let state: DiffCoverageStatus['state'] = 'none';
  if (result !== null) state = 'computed';
  else if (row !== undefined) state = 'waiting-for-coverage';
  else if (files !== null) state = 'waiting-for-diff';
  return { projectId: project.id, commit, branch: row?.branch ?? null, state, result };
}

/**
 * The diff coverage the gate reads: the named commit's on the branch, or without a commit the
 * branch's most recently received one. `null` when there is none, or it is still waiting.
 */
export async function gateDiffCoverage(
  options: HealthStoreOptions,
  projectId: string,
  branch: string,
  commit?: string,
): Promise<DiffCoverageRecord | null> {
  const rows = await options.db
    .select()
    .from(diffCoverageResults)
    .where(
      and(
        scope(diffCoverageResults, options, projectId),
        eq(diffCoverageResults.branch, branch),
        ...(commit === undefined ? [] : [eq(diffCoverageResults.commitSha, commit)]),
      ),
    )
    .orderBy(desc(diffCoverageResults.receivedAt), desc(diffCoverageResults.id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : recordOf(row);
}
