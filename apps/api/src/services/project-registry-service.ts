import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import path from 'node:path';
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
 * Canonical results and run history for a project, **up to and including `at`**.
 *
 * ## `at` is a filter, not a label
 *
 * This function used to take no time parameter at all, so `score(inputs, at)`'s
 * second argument was stamped onto the payload and nothing more — which made
 * `GET /qa/score/diff` subtract a number from itself on every request. `score()`
 * documents the other half: "inputs is the whole window, already read", so *this*
 * function is where a window has to be cut, and a caller that cannot ask for one
 * cannot have a diff.
 *
 * Omitting `at` reads everything, which is what every non-diff endpoint wants.
 *
 * ## Results are cut by their run's `started_at`, not their own clock
 *
 * A result is evidence about a **run**, so the window it belongs to is the window
 * that run started in. Cutting on `canonical_run_results.created_at` instead is
 * cheaper and wrong in a way fixtures find immediately: `created_at` is the
 * *ingestion* time, so a backdated run whose results landed today is excluded from a
 * reading taken before it started, and the score reports `presence: 0` about a run
 * that plainly happened.
 *
 * The join casts `runs.id` (a `uuid`) to `text` rather than the other way round,
 * because `canonical_run_results.run_id` is a `text` column and `text::uuid` throws
 * on a value that is not a uuid — a cast that turns a bad row into a 500 on the
 * dashboard. `uuid::text` cannot fail.
 */
export async function readScoreInputs(
  options: ProjectRegistryServiceOptions,
  projectId: string,
  at?: string,
): Promise<{ runs: unknown[]; results: unknown[] }> {
  // An unparseable instant reads everything rather than nothing: a caller who sent
  // nonsense should get an answer they can see is unfiltered, not an empty window
  // that reads as "nothing has run".
  const instant = at === undefined ? undefined : new Date(at);
  const cutoff = instant === undefined || Number.isNaN(instant.getTime()) ? undefined : instant;

  const projectScope = and(
    eq(canonicalRunResults.workspaceId, options.workspaceId),
    sql`${canonicalRunResults.result}->'identity'->>'projectId' = ${projectId}`,
  );
  const historyScope = and(
    eq(runs.workspaceId, options.workspaceId),
    eq(runs.projectId, projectId),
  );
  const inWindow = cutoff === undefined ? undefined : lte(runs.startedAt, cutoff);

  const canonical = await options.db
    .select({ result: canonicalRunResults.result })
    .from(canonicalRunResults)
    .where(
      cutoff === undefined
        ? projectScope
        : and(
            projectScope,
            inArray(
              canonicalRunResults.runId,
              options.db
                .select({ id: sql`${runs.id}::text` })
                .from(runs)
                .where(and(historyScope, inWindow as NonNullable<typeof inWindow>)),
            ),
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
    .where(inWindow === undefined ? historyScope : and(historyScope, inWindow))
    .orderBy(runs.startedAt);

  return { runs: history, results: canonical.map((row) => row.result) };
}

/**
 * The log surface discovery needs, and no more.
 *
 * Two levels, declared here rather than importing `Logger`, so this service has no
 * logging dependency: a boot-time hook that cannot emit a line is a hook an operator
 * cannot debug, and a boot-time hook that carries a logger through four signatures is
 * a dependency the tests have to fabricate.
 */
export interface ProjectDiscoveryLog {
  info(msg: string, context?: Record<string, unknown>): void;
  warn(msg: string, context?: Record<string, unknown>): void;
}

/** What boot-time discovery did, in the four shapes it can answer. */
export type ProjectDiscoveryOutcome =
  | { outcome: 'registered'; project: RegisteredProject; commands: number }
  | { outcome: 'refreshed'; project: RegisteredProject; commands: number }
  | { outcome: 'unrecognised'; repoPath: string }
  | { outcome: 'skipped'; repoPath: string; reason: string };

/**
 * A folder name turned into something `RegisterProjectBodySchema` accepts.
 *
 * ## It has to match that schema, and it must not inherit it
 *
 * The schema is `/^[a-z0-9][a-z0-9._-]*$/u` with a 64-character ceiling, and it is
 * right: a slug becomes a directory name in some installs and a URL segment in
 * others. But deriving a slug by *reading* the schema is how `My Project` 422s at
 * boot — the shape of a defect that only appears on the machine of somebody whose
 * folder has a space in its name.
 *
 * So the rules are stated here and asserted against the same regex in
 * `project-registry-service.test.ts`. One spelling, tested against the authority.
 *
 * ## What it does to a name
 *
 * Lowercase; every run of characters the schema refuses becomes a single `-`; leading
 * characters the schema refuses are dropped rather than replaced, because a slug
 * cannot start with `-`; then the 64-character ceiling. A name that slugifies to
 * nothing — `***`, an emoji — becomes `project`, because a boot hook that registers
 * an empty slug has to register *something* and there is no second chance to ask.
 */
export function slugifyProjectName(name: string): string {
  const collapsed = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '');
  const truncated = collapsed.slice(0, PROJECT_SLUG_MAX_LENGTH);
  return truncated === '' ? 'project' : truncated;
}

/** `RegisterProjectBodySchema`'s `slug` ceiling, restated because it is a number. */
const PROJECT_SLUG_MAX_LENGTH = 64;

/**
 * Registers the folder this install was pointed at, or re-reads the one it already knows.
 *
 * ## What it replaces
 *
 * Registering a repository was a thing a human did, by POSTing a name, a slug and a
 * `repoPath` and then pressing "detect". The *report* half of discovery already ran
 * by itself — the detector emits `artifactGlobs` and the runner globs the workspace
 * for them — so the only manual step left was the project half, and a dashboard that
 * cannot analyse the folder you are sitting in until you curl it is a dashboard with
 * an extra step in it.
 *
 * ## Re-detect, never duplicate
 *
 * A `package.json` that gained a test runner yesterday has to show up today with
 * nobody pressing a button, so an already-registered folder is **refreshed** rather
 * than registered again — `refreshProject` re-reads the manifests, and registering
 * again would collide with the row it is meant to update.
 *
 * ## Three failures, three different answers
 *
 * A folder nothing can be detected in is registered as **nothing**: a row with an
 * empty proposal would make the cockpit report fifteen zeroes about a folder that
 * has no suite in it, which is a confident answer to the wrong question. `POST
 * /projects` still registers such a folder, because that is an operator saying so.
 *
 * A slug collision is **skipped with a line**, never thrown: two folders slugifying
 * to one string is a real possibility and not a reason to refuse to start.
 *
 * Everything else is **rethrown**. `discoverProjectAtBoot` is where "never fatal"
 * lives; a function that swallowed a permission error would report a broken install
 * as an empty one, and the two look identical from the cockpit.
 */
export async function discoverProject(
  options: ProjectRegistryServiceOptions,
  input: { repoPath: string; log: ProjectDiscoveryLog },
): Promise<ProjectDiscoveryOutcome> {
  const repoPath = path.resolve(input.repoPath);

  const known = (await listProjects(options)).find(
    (candidate) => candidate.repoPath !== null && path.resolve(candidate.repoPath) === repoPath,
  );
  if (known !== undefined) {
    const refreshed = await refreshProject(options, known.id);
    const commands = refreshed.profile.commands.length;
    input.log.info('project discovery re-detected a registered folder', {
      repoPath,
      slug: known.slug,
      commands,
    });
    return { outcome: 'refreshed', project: known, commands };
  }

  const detected = await detectProject(options.viewFor(repoPath));
  if (!detected.recognised) {
    input.log.info('project discovery found no runnable suite', { repoPath });
    return { outcome: 'unrecognised', repoPath };
  }

  const name = path.basename(repoPath) || repoPath;
  const slug = slugifyProjectName(name);
  try {
    await ensureWorkspace(options);
    const project = await registerProject(options, { name, slug, repoPath });
    const commands = project.profile.commands.length;
    input.log.info('project discovery registered a folder', { repoPath, slug, commands });
    return { outcome: 'registered', project, commands };
  } catch (failure) {
    if (!(failure instanceof DomainError) || failure.code !== ErrorCode.CONFLICT) throw failure;
    const reason = failure.message;
    input.log.warn('project discovery skipped a folder whose slug is taken', {
      repoPath,
      slug,
      reason,
    });
    return { outcome: 'skipped', repoPath, reason };
  }
}

/**
 * The one call boot makes, and the whole of its failure policy.
 *
 * ## No default root
 *
 * `AUTOMATE_PROJECT_ROOT` is opt-in with **no fallback to the working directory**.
 * In compose the cwd is `/app`, which has a `package.json` — so a default would
 * register the container as the user's project, and the cockpit would confidently
 * analyse the wrong tree. Silence beats confident nonsense, and one environment
 * variable is the price of never having to guess which one it picked.
 *
 * ## Never fatal
 *
 * A discovery failure logs and returns. A dashboard that will not boot because a
 * folder lacked a `package.json` is worse than a dashboard with nothing in it, and
 * "nothing in it" is a state the client renders as onboarding.
 */
export async function discoverProjectAtBoot(
  options: ProjectRegistryServiceOptions,
  projectRoot: string | undefined,
  log: ProjectDiscoveryLog,
): Promise<void> {
  if (projectRoot === undefined || projectRoot.trim() === '') {
    log.info('project discovery is off; set AUTOMATE_PROJECT_ROOT to a folder to analyse');
    return;
  }
  try {
    await discoverProject(options, { repoPath: projectRoot, log });
  } catch (failure) {
    log.warn('project discovery failed; the API serves the onboarding state', {
      repoPath: projectRoot,
      reason: failure instanceof Error ? failure.message : String(failure),
    });
  }
}
