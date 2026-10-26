import { and, eq, inArray, sql } from 'drizzle-orm';
import { healthFindings, projects } from '@automate/db';
import type { CanonicalFinding } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';

/**
 * The parts of repository health every health module shares: the project row a request is
 * about, and the one finding lifecycle.
 *
 * Split out of `repo-health-service.ts` so the supply-chain and diff-coverage modules carry
 * findings forward through **the same** upsert — a licence violation is `new`, `persisting`
 * and `fixed` by exactly the rule a SARIF result is, because it is the same code.
 */
export type HealthStoreOptions = Pick<ProjectRegistryServiceOptions, 'db' | 'workspaceId'>;

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  defaultBranch: string | null;
  repoPath: string | null;
  repositoryUrl: string | null;
  profile: Record<string, unknown>;
  settings: Record<string, unknown>;
}

const UUID = /^[0-9a-f-]{36}$/iu;

/** The project, read in the caller's workspace; another workspace's id is "no such project". */
export async function projectRow(
  options: HealthStoreOptions,
  projectId: string,
): Promise<ProjectRow> {
  // A malformed id is "no such project", not a database error about uuid syntax.
  if (!UUID.test(projectId)) {
    throw new DomainError(ErrorCode.NOT_FOUND, `No project ${projectId}`);
  }
  const rows = await options.db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      defaultBranch: projects.defaultBranch,
      repoPath: projects.repoPath,
      repositoryUrl: projects.repositoryUrl,
      profile: projects.profile,
      settings: projects.settings,
    })
    .from(projects)
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)))
    .limit(1);
  const row = rows[0];
  if (row === undefined) throw new DomainError(ErrorCode.NOT_FOUND, `No project ${projectId}`);
  return row;
}

/** The branch a read means when it names none: the project's default, else `main`. */
export function branchFor(project: Pick<ProjectRow, 'defaultBranch'>, requested?: string): string {
  const branch = requested?.trim();
  return branch !== undefined && branch.length > 0
    ? branch.slice(0, 255)
    : (project.defaultBranch ?? 'main');
}

export const INSERT_CHUNK = 500;

export interface SyncInput {
  projectId: string;
  branch: string;
  /** The report kind whose silence about a finding fixes it. */
  toolKey: string;
  findings: readonly CanonicalFinding[];
  reportId: string | null;
  now: Date;
  /** CODEOWNERS, when the caller has it; fills only what nobody assigned. */
  ownerOf?: (path: string | null) => string | null;
}

export interface SyncResult {
  created: number;
  persisting: number;
  fixed: number;
  added: CanonicalFinding[];
}

/**
 * Carries one report's findings forward against the last report of the same kind.
 *
 * A fingerprint seen before is `persisting`; a new one is `new`; an `open` one the report no
 * longer mentions is `fixed`, and a `fixed` one that comes back is `open` again. A person's
 * decision (`suppressed`, `accepted`, `false_positive`) is never overwritten here.
 */
export async function syncFindings(
  options: HealthStoreOptions,
  input: SyncInput,
): Promise<SyncResult> {
  const scope = and(
    eq(healthFindings.workspaceId, options.workspaceId),
    eq(healthFindings.projectId, input.projectId),
    eq(healthFindings.branch, input.branch),
  );
  const existing = await options.db
    .select({ fingerprint: healthFindings.fingerprint, state: healthFindings.state })
    .from(healthFindings)
    .where(and(scope, eq(healthFindings.toolKey, input.toolKey)));
  const known = new Map(existing.map((row) => [row.fingerprint, row.state]));
  const present = new Set(input.findings.map((finding) => finding.fingerprint));
  let created = 0;
  let persisting = 0;
  const added: CanonicalFinding[] = [];
  for (const finding of input.findings) {
    if (known.has(finding.fingerprint)) persisting += 1;
    else {
      created += 1;
      added.push(finding);
    }
  }
  for (let start = 0; start < input.findings.length; start += INSERT_CHUNK) {
    const chunk = input.findings.slice(start, start + INSERT_CHUNK);
    await options.db
      .insert(healthFindings)
      .values(
        chunk.map((finding) => ({
          workspaceId: options.workspaceId,
          projectId: input.projectId,
          branch: input.branch,
          fingerprint: finding.fingerprint,
          toolKey: input.toolKey,
          tool: finding.tool,
          ruleId: finding.ruleId,
          kind: finding.kind,
          severity: finding.severity,
          dimension: finding.dimension,
          path: finding.path,
          line: finding.line,
          message: finding.message,
          helpUri: finding.helpUri,
          fixAvailable: finding.fixAvailable,
          owner: input.ownerOf?.(finding.path) ?? null,
          firstSeenAt: input.now,
          lastSeenAt: input.now,
          lastReportId: input.reportId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          healthFindings.workspaceId,
          healthFindings.projectId,
          healthFindings.branch,
          healthFindings.fingerprint,
        ],
        set: {
          toolKey: sql`excluded.tool_key`,
          severity: sql`excluded.severity`,
          kind: sql`excluded.kind`,
          dimension: sql`excluded.dimension`,
          path: sql`excluded.path`,
          line: sql`excluded.line`,
          message: sql`excluded.message`,
          helpUri: sql`excluded.help_uri`,
          fixAvailable: sql`excluded.fix_available`,
          lastSeenAt: sql`excluded.last_seen_at`,
          lastReportId: sql`excluded.last_report_id`,
          // A person's assignment outlives CODEOWNERS; CODEOWNERS fills what nobody assigned.
          owner: sql`COALESCE(${healthFindings.owner}, excluded.owner)`,
          // A fixed finding that comes back is open again; a person's decision is kept.
          state: sql`CASE WHEN ${healthFindings.state} = 'fixed' THEN 'open' ELSE ${healthFindings.state} END`,
        },
      });
  }
  const gone = [...known.entries()]
    .filter(([fingerprint, state]) => state === 'open' && !present.has(fingerprint))
    .map(([fingerprint]) => fingerprint);
  for (let start = 0; start < gone.length; start += INSERT_CHUNK) {
    await options.db
      .update(healthFindings)
      .set({ state: 'fixed' })
      .where(
        and(scope, inArray(healthFindings.fingerprint, gone.slice(start, start + INSERT_CHUNK))),
      );
  }
  return { created, persisting, fixed: gone.length, added };
}

/** Days an automated acceptance (VEX, an SBOM producer's analysis) stands without being re-asserted. */
export const AUTOMATED_ACCEPTANCE_DAYS = 90;

/**
 * When an acceptance written by a machine expires: {@link AUTOMATED_ACCEPTANCE_DAYS} after it
 * was last asserted.
 *
 * The contract requires every accepted risk to carry an expiry, and an automated one keeps
 * that invariant honestly rather than with a far-future sentinel: the date is renewed every
 * time the statement behind it is applied again (each VEX, SBOM and SARIF upload), so it
 * lapses only when nothing has re-asserted it for that long — at which point the finding
 * counts again until the next upload re-decides it.
 */
export function automatedAcceptanceExpiry(now: Date): Date {
  return new Date(now.getTime() + AUTOMATED_ACCEPTANCE_DAYS * 86_400_000);
}
