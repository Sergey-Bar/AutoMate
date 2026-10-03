import { and, eq, sql } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { PgliteQueryResultHKT } from 'drizzle-orm/pglite';
import { canonicalRunResults, projects, runs, workspaces } from '@automate/db';
import {
  AUTOMATE_CONFIG_FILENAME,
  detectProject,
  mergeConfig,
  profileFromDetection,
  ProjectProfileSchema,
  type ProjectProfile,
  type RepositoryView,
} from '@automate/projects';
import { RunCommandSchema, type RunCommand } from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';

type AnyPgDb =
  | PgDatabase<PgQueryResultHKT, Record<string, unknown>>
  | PgDatabase<PgliteQueryResultHKT, Record<string, unknown>>;

/**
 * The repository of record for the project registry.
 *
 * ## The row and the file are separate on purpose
 *
 * `projects.repo_path` is where the repository lives on this host, and it is a
 * **claim**. The manifests inside it are the evidence, and they are read fresh on
 * every detection: a stored `profile` is a proposal from whenever the detector last
 * ran, and re-deriving it is what makes `detectorVersion` meaningful rather than
 * decorative. A row whose detector version is older than the code now running is
 * detected again rather than trusted, because reading a version-1 profile under
 * version-2 rules is exactly the ambiguity `detector_version` exists to prevent.
 */
export interface ProjectRegistryServiceOptions {
  db: AnyPgDb;
  workspaceId: string;
  /**
   * Resolves a stored repo path to a view of it.
   *
   * Injected so the detector's I/O is a seam rather than a filesystem walk buried
   * in a service, and so a test can drive detection from a literal map. It is
   * also the boundary a multi-tenant install would use to confine each project's
   * path to its own root.
   */
  viewFor: (repoPath: string) => RepositoryView;
}

export interface RegisteredProject {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  repoPath: string | null;
  detectorVersion: number;
  profile: ProjectProfile;
  /** The manifest lines the profile was derived from, when it was derived here. */
  evidence: readonly string[];
  createdAt: string;
}

/**
 * Registers a repository and reads what it says about itself.
 *
 * Detection runs **before** the row is written, so an unreadable repository never
 * becomes a registry entry — a project row that cannot be detected is a row every
 * later command will fail against, and it is better to have no row than one that
 * promises something unreadable.
 */
export async function registerProject(
  options: ProjectRegistryServiceOptions,
  input: { name: string; slug: string; repoPath: string },
): Promise<RegisteredProject> {
  const view = options.viewFor(input.repoPath);
  const detected = await detectProject(view);
  const override = await readOverride(view);
  const resolved =
    override === null
      ? { profile: profileFromDetection(detected), source: 'detected' as const, overriddenKeys: [] }
      : mergeConfig(profileFromDetection(detected), override);

  const inserted = await options.db
    .insert(projects)
    .values({
      workspaceId: options.workspaceId,
      name: input.name,
      slug: input.slug,
      repoPath: input.repoPath,
      profile: resolved.profile as unknown as Record<string, unknown>,
      detectorVersion: detected.detectorVersion,
    })
    .onConflictDoNothing()
    .returning({
      id: projects.id,
      createdAt: projects.createdAt,
    });

  const row = inserted[0];
  if (row === undefined) {
    throw new DomainError(ErrorCode.CONFLICT, 'A project with that slug is already registered');
  }
  return {
    id: row.id,
    workspaceId: options.workspaceId,
    name: input.name,
    slug: input.slug,
    repoPath: input.repoPath,
    detectorVersion: detected.detectorVersion,
    profile: resolved.profile,
    evidence: evidenceFrom(detected),
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Reads `automate.config.json`, or `null` when there is none.
 *
 * `null` and `{}` are the same thing here on purpose: an operator who wrote a file
 * with nothing but `$schema` and `version` has overridden nothing, and reporting
 * `source: 'override'` for it would make the provenance panel lie about a
 * detection that ran unimpeded.
 */
async function readOverride(view: RepositoryView): Promise<unknown | null> {
  const text = await view.read(AUTOMATE_CONFIG_FILENAME);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      `${AUTOMATE_CONFIG_FILENAME} is not valid JSON, so it cannot override the detector`,
    );
  }
}

function evidenceFrom(detected: {
  recognised: boolean;
  candidateCommands?: readonly { evidence: string }[];
}): string[] {
  if (!detected.recognised) return [];
  return (detected.candidateCommands ?? []).map((candidate) => candidate.evidence);
}

/**
 * Re-reads a project's manifests and replaces its stored proposal.
 *
 * **Separate from `registerProject`, and that separation is the fix.**
 * `POST /detect` originally called `registerProject` with the project's own slug,
 * which is guaranteed to collide with the row it is meant to update — so the
 * endpoint answered 422 for every project, always. It was not a rare path: it is
 * the button a reader presses when they have changed their `package.json`.
 *
 * Returning the row it read is deliberate: the caller gets the profile that is
 * **stored now**, not the one that was stored a moment ago.
 */
export async function refreshProject(
  options: ProjectRegistryServiceOptions,
  projectId: string,
): Promise<{ profile: ProjectProfile; evidence: readonly string[] }> {
  const existing = await getProject(options, projectId);
  if (existing.repoPath === null) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST,
      'This project has no repository path, so there is nothing to re-read',
    );
  }
  const view = options.viewFor(existing.repoPath);
  const detected = await detectProject(view);
  const override = await readOverride(view);
  const resolved =
    override === null
      ? { profile: profileFromDetection(detected), source: 'detected' as const, overriddenKeys: [] }
      : mergeConfig(profileFromDetection(detected), override);

  await options.db
    .update(projects)
    .set({
      profile: resolved.profile as unknown as Record<string, unknown>,
      detectorVersion: detected.detectorVersion,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)));

  return { profile: resolved.profile, evidence: evidenceFrom(detected) };
}

export async function listProjects(
  options: ProjectRegistryServiceOptions,
): Promise<RegisteredProject[]> {
  const rows = await options.db
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId));
  return rows.map(toRegistered);
}

export async function getProject(
  options: ProjectRegistryServiceOptions,
  projectId: string,
): Promise<RegisteredProject> {
  const rows = await options.db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, options.workspaceId), eq(projects.id, projectId)));
  const row = rows[0];
  if (row === undefined) {
    throw new DomainError(ErrorCode.NOT_FOUND, 'No such project');
  }
  return toRegistered(row);
}

function toRegistered(row: typeof projects.$inferSelect): RegisteredProject {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    slug: row.slug,
    repoPath: row.repoPath,
    detectorVersion: row.detectorVersion,
    // Re-validated on read rather than trusted: the column is JSONB, and a row
    // written by an older build can carry a shape this one does not know. Parsing
    // here turns that into a 500 at the boundary instead of a `undefined` halfway
    // through scoring.
    profile: ProjectProfileSchema.parse(row.profile),
    evidence: [],
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * The runnable commands a project has, newest detection first.
 *
 * Parsed through `RunCommandSchema` rather than cast, so a profile written by a
 * detector this build does not understand cannot put a malformed argv in front of
 * a runner. This is the **typed command registry** the plan's D7 depends on: the
 * set of things that can be executed is exactly what this function returns, and
 * it is derived from a stored profile rather than from a request.
 */
export async function listCommands(
  options: ProjectRegistryServiceOptions,
  projectId: string,
): Promise<RunCommand[]> {
  const project = await getProject(options, projectId);
  return project.profile.commands.map((command) =>
    RunCommandSchema.parse({
      id: command.id,
      argv: command.argv,
      category: command.category,
      evidence: command.evidence,
      confidence: command.confidence,
      artifactGlobs: project.profile.artifactGlobs
        .filter((glob) => glob.category === command.category)
        .map((glob) => glob.glob),
      env: [],
    }),
  );
}

/**
 * Ensures the workspace row exists.
 *
 * `projects.workspace_id` is `NOT NULL` with a foreign key, so a caller that has
 * not provisioned a workspace gets a database error rather than a useful message.
 * `ON CONFLICT DO NOTHING` makes this idempotent — it is called on every registry
 * mutation, and a second call must not fail because the workspace is already there.
 */
export async function ensureWorkspace(options: ProjectRegistryServiceOptions): Promise<void> {
  await options.db
    .insert(workspaces)
    .values({
      id: options.workspaceId,
      name: 'default',
      configPath: 'config',
      // Supplied rather than left to the column default, because the column's
      // `defaultNow()` is a *SQL* default and Drizzle only knows about the ones it
      // can see on the column — so omitting it here is a type error rather than a
      // silent omission, and the type error is the point.
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

/**
 * Canonical results for a project, newest window first.
 *
 * Reads the `result` JSONB and projects the handful of fields the score needs. The
 * projection is explicit rather than a cast so a producer that starts sending a
 * field the score has no opinion about does not silently change the score, and so
 * a field the score *does* need cannot go missing without a parse failure.
 */
export async function readScoreInputs(
  options: ProjectRegistryServiceOptions,
  projectId: string,
): Promise<{ runs: unknown[]; results: unknown[] }> {
  const canonical = await options.db
    .select({ result: canonicalRunResults.result })
    .from(canonicalRunResults)
    .where(
      and(
        eq(canonicalRunResults.workspaceId, options.workspaceId),
        sql`${canonicalRunResults.result}->'identity'->>'projectId' = ${projectId}`,
      ),
    );
  const history = await options.db
    .select({
      id: runs.id,
      startedAt: runs.startedAt,
      outcome: runs.outcome,
      phase: runs.phase,
    })
    .from(runs)
    .where(and(eq(runs.workspaceId, options.workspaceId), eq(runs.projectId, projectId)))
    .orderBy(runs.startedAt);

  return { runs: history, results: canonical.map((row) => row.result) };
}
