import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import {
  commits,
  deliverySources,
  deliverySyncs,
  deployments,
  pullRequests,
  type DeliverySourceRow,
  type DeliverySyncRow,
} from '@automate/db';
import type { ConnectorAdapter } from '@automate/connectors-sdk';
import { DeliveryStreamSchema } from '@automate/shared-contracts';
import { z } from 'zod/v4';
import { inChunksOf, withinBound } from './bounded-list.js';
import { readGitToken } from './git-credential-service.js';
import { projectRow, type ProjectRow } from './health-findings.js';
import { githubRepository } from './health-integrations.js';
import { healthPolicyOf } from './repo-health-service.js';
import type { ProjectRegistryServiceOptions } from './project-registry-service.js';
import { productionEnvironmentsOf } from './delivery-service.js';
import {
  GitHubCommitSchema,
  GitHubDeploymentSchema,
  GitHubDeploymentStatusSchema,
  GitHubFileSchema,
  GitHubPullSchema,
  GitHubReviewSchema,
  GitHubWorkflowRunSchema,
  PR_BODY_LIMIT,
  changeFacts,
  commitValues,
  deploymentOutcome,
  parseItems,
  reviewFacts,
  stateOf,
  workflowRunDeployment,
  type GitHubCommit,
  type GitHubFile,
  type GitHubPull,
  type GitHubReview,
} from './delivery-github.js';
import {
  attributionColumns,
  attributionOptionsOf,
  attributionVersionOf,
  classifyPullRequest,
} from './ai-code-attribution.js';
import type { AttributionOptions } from '@automate/reporting';

/**
 * Runs the delivery syncs the worker, an operator or a webhook queued.
 *
 * ## The lease
 *
 * The `report-dispatcher` pattern, on `delivery_syncs`: one statement moves up to `batch` due
 * rows to `running`, pushes `next_attempt_at` a lease into the future and gives each a fresh
 * `lease_id`, choosing them with `FOR UPDATE SKIP LOCKED`. A process that dies mid-sync leaves
 * a `running` row whose lease lapses, and the next claim takes it again — at most
 * `maxAttempts` times; then it is `failed` as `attempts_exhausted`. A sync is not claimed while
 * another sync of the same source holds a live lease, nor while the source is rate limited.
 *
 * The lease is renewed after every stream, and every write a sync makes to its row or its
 * source carries its `lease_id`: a sync that outlived its lease and was taken over writes
 * nothing more and ends `abandoned`. A source has at most one `queued` sync (a partial unique
 * index); a requeue that would be a second is closed as `superseded`.
 *
 * ## Cursors move only forward, and only on success
 *
 * Four streams — pull requests, default-branch commits, deployments, deploy-workflow runs —
 * each with its own cursor in `delivery_sources.cursors`. A stream's cursor is written when
 * that stream's read and writes all succeeded, and never otherwise, so a failure part-way
 * through re-reads from the same place next time; every write is an upsert, so a re-read
 * writes nothing twice. Each stream's cursor is merged into the stored ones in SQL, the later
 * one winning, so a slower writer cannot move it back. A first sync reads
 * {@link BACKFILL_DAYS} back; a read longer than one sync's pages continues from the next page
 * on the next sync before the cursor moves ({@link advanceStream}), so nothing between the old
 * cursor and the newest item is skipped. A deployment still pending holds its stream's cursor
 * at its creation until GitHub decides it.
 *
 * ## Rate limits
 *
 * A rate-limited read stops the sync at once. The sync goes back to `queued` with its next
 * attempt at GitHub's reset time — the attempt is not counted, a limit is not a failure — and
 * the source records `rate_limited` until then, which also keeps every other sync of it
 * unclaimed. Streams that finished before the limit keep their advanced cursors.
 *
 * ## Never silent
 *
 * A project that is not a github.com repository, or has no token in the vault, ends its sync
 * as `failed` with `not_configured`, and the source says why in `last_error`; the delivery
 * read shows it. Nothing is retried that cannot succeed by waiting.
 */
export interface DeliverySyncerOptions {
  db: ProjectRegistryServiceOptions['db'];
  vaultSecret: string | undefined;
  adapter: ConnectorAdapter;
  /** The project's GitHub token. Defaults to the vault entry `git:<projectId>`. */
  tokenFor?: (workspaceId: string, projectId: string) => Promise<string | null>;
  now?: () => Date;
  batch?: number;
  maxAttempts?: number;
  leaseMs?: number;
  /** Pull requests read in full per sync; the rest wait for the next one. */
  maxPullRequests?: number;
  /** Commits kept per project. Default {@link COMMIT_RETENTION}. */
  commitRetention?: number;
  log?: (message: string, details: Record<string, unknown>) => void;
}

export interface SyncOutcome {
  id: string;
  /** `abandoned`: another process took the lease; this one wrote nothing more to the row. */
  status: 'done' | 'failed' | 'queued' | 'abandoned';
  errorCode: string | null;
}

/** This process's lease was taken by another: stop, and write nothing more. */
class LeaseLost extends Error {
  constructor() {
    super('the delivery sync lease was taken by another process');
    this.name = 'LeaseLost';
  }
}

/** A Postgres unique violation, however the driver wrapped it. */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Object; depth += 1) {
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** How far back the first sync of a stream reads. */
export const BACKFILL_DAYS = 90;
/** Re-read window for deployments and runs whose outcome may have been decided since. */
export const LOOKBACK_MS = 24 * 3_600_000;
/** Commits kept per project; the oldest go first. */
export const COMMIT_RETENTION = 5000;
const MAX_DEPLOYMENTS = 100;
/**
 * The most syncs one claim moves to `running`. `batch` is an option, and an option is not a
 * bound: the claimed ids go into one `inArray`, so the cap is what keeps that statement sized.
 */
export const MAX_CLAIM_BATCH = 100;

/** The claim size: the configured `batch` (default 5), never more than {@link MAX_CLAIM_BATCH}. */
export function claimBatchOf(batch: number | undefined): number {
  return Math.min(batch ?? 5, MAX_CLAIM_BATCH);
}
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000];
const DAY_MS = 86_400_000;

const StreamsSchema = z.record(z.string(), DeliveryStreamSchema);
const ListSchema = z.object({ items: z.array(z.unknown()), nextPage: z.number().nullable() });

/** A stream read GitHub refused. `retryAt` is set for a rate limit. */
export class StreamFailure extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAt: Date | null,
  ) {
    super(`delivery sync stream failed: ${code}`);
    this.name = 'StreamFailure';
  }
}

interface StreamContext {
  adapter: ConnectorAdapter;
  token: string;
  owner: string;
  repo: string;
  project: ProjectRow;
  source: DeliverySourceRow;
  db: DeliverySyncerOptions['db'];
  workspaceId: string;
  now: Date;
  maxPullRequests: number;
  commitRetention: number;
  /** The policy's attribution labels, read once per sync. */
  attribution: AttributionOptions;
}

interface StreamResult {
  cursor: string;
  written: number;
  incomplete: Incomplete | null;
}

/** A read since the cursor that one sync could not finish: see `DeliveryStreamSchema`. */
interface Incomplete {
  nextPage: number;
  high: string;
  floor: string | null;
}

/** Where a stream stands at the start of a sync. */
interface StreamState {
  cursor: string;
  incomplete: Incomplete | null;
}

interface Listed {
  items: unknown[];
  nextPage: number | null;
}

async function list(
  context: StreamContext,
  operation: string,
  input: Record<string, unknown>,
): Promise<Listed> {
  const result = await context.adapter.execute(
    { operation, input: { owner: context.owner, repo: context.repo, ...input } },
    context.token,
  );
  if (result.status !== 'ok') {
    const retryAt = result.error?.retryAt;
    throw new StreamFailure(
      result.error?.code ?? 'github_failed',
      result.error?.retryable === true,
      retryAt === undefined ? null : new Date(retryAt),
    );
  }
  const parsed = ListSchema.safeParse(result.data);
  if (!parsed.success) throw new StreamFailure('github_malformed', false, null);
  return parsed.data;
}

const later = (left: string, right: string) =>
  Date.parse(right) > Date.parse(left) ? right : left;
const earlier = (left: string, right: string) =>
  Date.parse(right) < Date.parse(left) ? right : left;

function earliest(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return earlier(left, right);
}

/**
 * Where a stream's read stands after this sync's pages.
 *
 * GitHub lists newest first, and one sync reads a bounded number of pages. When the bound
 * stopped the walk (`nextPage`), everything older on the later pages is still unread, so the
 * cursor stays where it was and the stream is `incomplete`: the next sync continues from
 * `nextPage`, remembering the newest instant seen (`high`) and the oldest one still undecided
 * (`floor`). Walking forward through a newest-first list never skips an item — a change made
 * meanwhile moves an item to the front, to be read again, never past the walk. Once a sync
 * reaches the end, the cursor becomes `high`, held back to `floor` when something is still
 * undecided, and never earlier than it was.
 */
export function advanceStream(
  state: StreamState,
  nextPage: number | null,
  newest: string | null,
  floor: string | null,
): Omit<StreamResult, 'written'> {
  const seen = state.incomplete?.high ?? state.cursor;
  const high = newest === null ? seen : later(seen, newest);
  const low = earliest(state.incomplete?.floor ?? null, floor);
  if (nextPage !== null) {
    return { cursor: state.cursor, incomplete: { nextPage, high, floor: low } };
  }
  return {
    cursor: later(state.cursor, low === null ? high : earlier(high, low)),
    incomplete: null,
  };
}

const pageOf = (state: StreamState) => state.incomplete?.nextPage ?? 1;

/** The newest of some instants, or `null` for none. */
function newestOf(instants: Iterable<string>): string | null {
  let newest: string | null = null;
  for (const instant of instants) newest = newest === null ? instant : later(newest, instant);
  return newest;
}

async function upsertCommits(
  context: StreamContext,
  rows: readonly GitHubCommit[],
  prNumber: number | null,
): Promise<number> {
  const values = rows
    .map((commit) => commitValues(commit, prNumber))
    .filter((value): value is typeof value & { committedAt: Date } => value.committedAt !== null);
  if (values.length === 0) return 0;
  await context.db
    .insert(commits)
    .values(
      values.map((value) => ({
        ...value,
        workspaceId: context.workspaceId,
        projectId: context.project.id,
        source: 'github',
        syncedAt: context.now,
      })),
    )
    .onConflictDoUpdate({
      target: [commits.workspaceId, commits.projectId, commits.source, commits.sha],
      set: {
        // A default-branch read knows no pull request; it must not erase one a PR read found.
        prNumber: sql`COALESCE(excluded.pr_number, ${commits.prNumber})`,
        authorLogin: sql`excluded.author_login`,
        authorEmail: sql`excluded.author_email`,
        authorName: sql`excluded.author_name`,
        committerLogin: sql`excluded.committer_login`,
        message: sql`excluded.message`,
        committedAt: sql`excluded.committed_at`,
        syncedAt: sql`excluded.synced_at`,
      },
    });
  return values.length;
}

/**
 * A pull request as the `pull_requests` table holds it, with its attribution classified from
 * the pull request and its commits (`ai-code-attribution.ts` states the roll-up rule).
 */
function pullRequestValues(
  context: StreamContext,
  pr: GitHubPull,
  read: { reviews: GitHubReview[]; commits: GitHubCommit[]; files: GitHubFile[] },
) {
  const author = pr.user?.login ?? null;
  const state = stateOf(pr);
  const headBranch = pr.head?.ref ?? null;
  const labels = (pr.labels ?? []).map((label) => label.name);
  const body = pr.body === null || pr.body === undefined ? null : pr.body.slice(0, PR_BODY_LIMIT);
  const attribution = classifyPullRequest(
    { authorLogin: author, headBranch, labels, body },
    read.commits.map((commit) => commitValues(commit, pr.number)),
    context.attribution,
  );
  return {
    number: pr.number,
    state,
    draft: pr.draft ?? false,
    authorLogin: author,
    headBranch,
    baseBranch: pr.base?.ref ?? null,
    labels,
    title: pr.title.slice(0, 500),
    body,
    openedAt: new Date(pr.created_at),
    mergedAt: state === 'merged' ? new Date(pr.merged_at as string) : null,
    closedAt: pr.closed_at === null || pr.closed_at === undefined ? null : new Date(pr.closed_at),
    // GitHub fills this for an open pull request too — with a test merge, not a real one.
    mergeCommitSha: state === 'merged' ? (pr.merge_commit_sha?.toLowerCase() ?? null) : null,
    headSha: pr.head?.sha?.toLowerCase() ?? null,
    ...reviewFacts(read.reviews, author),
    ...changeFacts(read.commits, read.files),
    ...attributionColumns(attribution),
    lastActivityAt: new Date(pr.updated_at),
    syncedAt: context.now,
  };
}

/** Pull requests re-classified per sync when their stored attribution is stale. */
export const RECLASSIFY_BATCH = 200;

/**
 * Re-classify, from what is already stored, the pull requests whose attribution was made
 * against another signature table or label set (or never made — rows synced before
 * `0039_ai_code_governance.sql`). Run at the start of every sync, before any GitHub read, so a
 * signature-table release reaches stored rows without re-reading GitHub. Bounded to
 * {@link RECLASSIFY_BATCH} per sync; the rest wait for the next.
 */
async function reclassifyStale(context: StreamContext): Promise<number> {
  const version = attributionVersionOf(context.attribution);
  const scope = and(
    eq(pullRequests.workspaceId, context.workspaceId),
    eq(pullRequests.projectId, context.project.id),
  );
  const stale = await context.db
    .select({
      id: pullRequests.id,
      number: pullRequests.number,
      authorLogin: pullRequests.authorLogin,
      headBranch: pullRequests.headBranch,
      labels: pullRequests.labels,
      body: pullRequests.body,
    })
    .from(pullRequests)
    .where(
      and(
        scope,
        or(isNull(pullRequests.attributionVersion), ne(pullRequests.attributionVersion, version)),
      ),
    )
    .orderBy(desc(pullRequests.lastActivityAt))
    .limit(RECLASSIFY_BATCH);
  if (stale.length === 0) return 0;
  const stored = await context.db
    .select()
    .from(commits)
    .where(
      and(
        eq(commits.workspaceId, context.workspaceId),
        eq(commits.projectId, context.project.id),
        inArray(
          commits.prNumber,
          stale.map((row) => row.number),
        ),
      ),
    );
  for (const row of stale) {
    const result = classifyPullRequest(
      row,
      stored.filter((commit) => commit.prNumber === row.number),
      context.attribution,
    );
    await context.db
      .update(pullRequests)
      .set(attributionColumns(result))
      .where(and(scope, eq(pullRequests.id, row.id)));
  }
  return stale.length;
}

/** Reads one pull request in full and writes it with its commits. */
async function writePullRequest(context: StreamContext, pr: GitHubPull): Promise<void> {
  const number = String(pr.number);
  const reviews = parseItems(
    GitHubReviewSchema,
    (await list(context, 'listPullRequestReviews', { number, maxPages: 3 })).items,
  ).parsed;
  const prCommits = parseItems(
    GitHubCommitSchema,
    (await list(context, 'listPullRequestCommits', { number, maxPages: 3 })).items,
  ).parsed;
  const files = parseItems(
    GitHubFileSchema,
    (await list(context, 'listPullRequestFiles', { number, maxPages: 3 })).items,
  ).parsed;
  const values = pullRequestValues(context, pr, { reviews, commits: prCommits, files });
  await context.db
    .insert(pullRequests)
    .values({
      workspaceId: context.workspaceId,
      projectId: context.project.id,
      source: 'github',
      externalId: String(pr.id),
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        pullRequests.workspaceId,
        pullRequests.projectId,
        pullRequests.source,
        pullRequests.externalId,
      ],
      set: values,
    });
  await upsertCommits(context, prCommits, pr.number);
}

/**
 * Pull requests updated since the cursor, one page of `maxPullRequests` per sync, each read
 * in full. The list is newest first, so a backlog is walked page by page across syncs and the
 * cursor moves only once the walk reaches the cursor (see {@link advanceStream}).
 */
async function syncPullRequests(context: StreamContext, state: StreamState): Promise<StreamResult> {
  const page = await list(context, 'listPullRequests', {
    newerThan: state.cursor,
    perPage: context.maxPullRequests,
    page: pageOf(state),
    maxPages: 1,
  });
  const listed = parseItems(GitHubPullSchema, page.items).parsed;
  for (const pr of listed) await writePullRequest(context, pr);
  const newest = newestOf(listed.map((pr) => new Date(pr.updated_at).toISOString()));
  return { ...advanceStream(state, page.nextPage, newest, null), written: listed.length };
}

/**
 * The default branch's commits since the cursor, kept to {@link COMMIT_RETENTION}. GitHub's
 * `since` filters by commit date, which for a rebased or merged branch predates the push.
 */
async function syncCommits(context: StreamContext, state: StreamState): Promise<StreamResult> {
  const page = await list(context, 'listCommits', {
    sha: context.project.defaultBranch ?? 'main',
    since: state.cursor,
    page: pageOf(state),
    maxPages: 3,
  });
  const listed = parseItems(GitHubCommitSchema, page.items).parsed;
  const written = await upsertCommits(context, listed, null);
  const newest = newestOf(
    listed.flatMap((commit) => {
      const at = commitValues(commit, null).committedAt;
      return at === null ? [] : [at.toISOString()];
    }),
  );
  const scope = and(
    eq(commits.workspaceId, context.workspaceId),
    eq(commits.projectId, context.project.id),
  );
  const keep = context.db
    .select({ id: commits.id })
    .from(commits)
    .where(scope)
    .orderBy(desc(commits.committedAt), desc(commits.id))
    .limit(context.commitRetention);
  await context.db.delete(commits).where(and(scope, notInArray(commits.id, keep)));
  return { ...advanceStream(state, page.nextPage, newest, null), written };
}

/** The external ids of the listed deployments already stored: their outcome was decided. */
async function storedDeployments(context: StreamContext, ids: string[]): Promise<Set<string>> {
  const stored = new Set<string>();
  // One page is at most MAX_DEPLOYMENTS, but the page comes from the adapter: chunked, so a
  // page longer than asked for costs more statements rather than one unbounded one.
  for (const chunk of inChunksOf(ids, MAX_DEPLOYMENTS)) {
    const rows = await context.db
      .select({ externalId: deployments.externalId })
      .from(deployments)
      .where(
        and(
          eq(deployments.workspaceId, context.workspaceId),
          eq(deployments.projectId, context.project.id),
          eq(deployments.source, 'github'),
          inArray(deployments.externalId, withinBound(chunk, MAX_DEPLOYMENTS)),
        ),
      );
    for (const row of rows) stored.add(row.externalId);
  }
  return stored;
}

/** One deployment with its latest status; `false` while GitHub has not decided it. */
async function writeDeployment(
  context: StreamContext,
  deployment: z.infer<typeof GitHubDeploymentSchema>,
): Promise<boolean> {
  const [latest] = parseItems(
    GitHubDeploymentStatusSchema,
    (
      await list(context, 'listDeploymentStatuses', {
        deploymentId: String(deployment.id),
        perPage: 1,
        maxPages: 1,
      })
    ).items,
  ).parsed;
  const status = deploymentOutcome(latest?.state);
  if (status === null) return false;
  const values = {
    environment: deployment.environment,
    status,
    createdAt: new Date(deployment.created_at),
    sha: deployment.sha?.toLowerCase() ?? null,
    url: latest?.environment_url ?? latest?.log_url ?? null,
    receivedAt: context.now,
  };
  await context.db
    .insert(deployments)
    .values({
      workspaceId: context.workspaceId,
      projectId: context.project.id,
      source: 'github',
      externalId: String(deployment.id),
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        deployments.workspaceId,
        deployments.projectId,
        deployments.source,
        deployments.externalId,
      ],
      set: values,
    });
  return true;
}

/**
 * GitHub deployments created since the cursor, re-read a day back, each with its latest status.
 * A deployment already stored is not asked about again: its outcome was decided. One still
 * pending holds the cursor at its creation, so it stays inside the re-read window until GitHub
 * decides it, however long that takes.
 */
async function syncDeployments(context: StreamContext, state: StreamState): Promise<StreamResult> {
  const newerThan = new Date(Date.parse(state.cursor) - LOOKBACK_MS).toISOString();
  const page = await list(context, 'listDeployments', {
    newerThan,
    perPage: MAX_DEPLOYMENTS,
    page: pageOf(state),
    maxPages: 1,
  });
  const listed = parseItems(GitHubDeploymentSchema, page.items).parsed;
  const stored = await storedDeployments(
    context,
    listed.map((deployment) => String(deployment.id)),
  );
  let written = 0;
  const pending: string[] = [];
  for (const deployment of listed.filter((entry) => !stored.has(String(entry.id)))) {
    if (await writeDeployment(context, deployment)) written += 1;
    else pending.push(new Date(deployment.created_at).toISOString());
  }
  const newest = newestOf(listed.map((entry) => new Date(entry.created_at).toISOString()));
  const floor = pending.reduce<string | null>((low, at) => earliest(low, at), null);
  return { ...advanceStream(state, page.nextPage, newest, floor), written };
}

/** Completed runs of the source's deploy workflows on the default branch, as deployments. */
async function syncWorkflowRuns(context: StreamContext, state: StreamState): Promise<StreamResult> {
  const since = new Date(Date.parse(state.cursor) - LOOKBACK_MS).toISOString();
  const page = await list(context, 'listWorkflowRuns', {
    branch: context.project.defaultBranch ?? 'main',
    status: 'completed',
    since,
    page: pageOf(state),
    maxPages: 3,
  });
  const runs = parseItems(GitHubWorkflowRunSchema, page.items).parsed;
  const environment = productionEnvironmentsOf(
    healthPolicyOf(context.project)?.delivery ?? {},
    context.source,
  )[0] as string;
  const workflows = z.array(z.string()).catch([]).parse(context.source.deployWorkflows);
  let written = 0;
  for (const run of runs) {
    const deployment = workflowRunDeployment(run, workflows, environment);
    if (deployment === null) continue;
    const { externalId, ...values } = deployment;
    await context.db
      .insert(deployments)
      .values({
        workspaceId: context.workspaceId,
        projectId: context.project.id,
        source: 'github',
        externalId,
        ...values,
        receivedAt: context.now,
      })
      .onConflictDoUpdate({
        target: [
          deployments.workspaceId,
          deployments.projectId,
          deployments.source,
          deployments.externalId,
        ],
        set: { ...values, receivedAt: context.now },
      });
    written += 1;
  }
  const newest = newestOf(runs.map((run) => new Date(run.created_at).toISOString()));
  return { ...advanceStream(state, page.nextPage, newest, null), written };
}

const STREAMS: ReadonlyArray<{
  name: string;
  run: (context: StreamContext, state: StreamState) => Promise<StreamResult>;
  applies: (source: DeliverySourceRow) => boolean;
}> = [
  { name: 'pullRequests', run: syncPullRequests, applies: () => true },
  { name: 'commits', run: syncCommits, applies: () => true },
  { name: 'deployments', run: syncDeployments, applies: () => true },
  {
    name: 'workflowRuns',
    run: syncWorkflowRuns,
    applies: (source) => z.array(z.string()).catch([]).parse(source.deployWorkflows).length > 0,
  },
];

const rowsOf = (result: unknown): Array<Record<string, unknown>> =>
  (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];

export function createDeliverySyncer(options: DeliverySyncerOptions) {
  const clock = options.now ?? (() => new Date());
  const maxAttempts = options.maxAttempts ?? 3;
  const leaseMs = options.leaseMs ?? 10 * 60_000;
  const tokenFor =
    options.tokenFor ??
    ((workspaceId: string, projectId: string) =>
      readGitToken({ db: options.db, workspaceId, vaultSecret: options.vaultSecret }, projectId));

  /**
   * Fails the syncs that used every attempt and whose lease lapsed: a sync that kills its
   * process every time would otherwise be taken back forever.
   */
  async function exhaust(): Promise<void> {
    const at = clock().toISOString();
    await options.db.execute(sql`
      UPDATE delivery_syncs
      SET status = 'failed', error_code = 'attempts_exhausted', finished_at = ${at}::timestamptz
      WHERE status IN ('queued', 'running')
        AND next_attempt_at <= ${at}::timestamptz
        AND attempts >= ${maxAttempts}`);
  }

  async function claim(): Promise<DeliverySyncRow[]> {
    const at = clock().toISOString();
    const result = await options.db.execute(sql`
      UPDATE delivery_syncs
      SET status = 'running', attempts = attempts + 1, lease_id = gen_random_uuid(),
          started_at = ${at}::timestamptz,
          next_attempt_at = ${new Date(Date.parse(at) + leaseMs).toISOString()}::timestamptz
      WHERE id IN (
        SELECT d.id FROM delivery_syncs d
        JOIN delivery_sources s ON s.id = d.source_id AND s.workspace_id = d.workspace_id
        WHERE d.status IN ('queued', 'running')
          AND d.next_attempt_at <= ${at}::timestamptz
          AND d.attempts < ${maxAttempts}
          AND (s.rate_limited_until IS NULL OR s.rate_limited_until <= ${at}::timestamptz)
          AND NOT EXISTS (
            SELECT 1 FROM delivery_syncs o
            WHERE o.source_id = d.source_id AND o.id <> d.id
              AND o.status = 'running' AND o.next_attempt_at > ${at}::timestamptz
          )
        ORDER BY d.next_attempt_at
        LIMIT ${claimBatchOf(options.batch)}
        FOR UPDATE OF d SKIP LOCKED
      )
      RETURNING id`);
    const ids = rowsOf(result).map((row) => String(row['id']));
    if (ids.length === 0) return [];
    return options.db
      .select()
      .from(deliverySyncs)
      .where(inArray(deliverySyncs.id, withinBound(ids, MAX_CLAIM_BATCH)));
  }

  /** The predicate every write of a claimed sync carries: it still holds the lease. */
  const holdsLease = (row: DeliverySyncRow) =>
    sql`EXISTS (SELECT 1 FROM delivery_syncs l WHERE l.id = ${row.id}
      AND l.lease_id = ${row.leaseId} AND l.status = 'running')`;

  async function updateSource(row: DeliverySyncRow, values: Partial<DeliverySourceRow>) {
    const updated = await options.db
      .update(deliverySources)
      .set({ ...values, updatedAt: clock() })
      .where(
        and(
          eq(deliverySources.workspaceId, row.workspaceId),
          eq(deliverySources.id, row.sourceId),
          holdsLease(row),
        ),
      )
      .returning({ id: deliverySources.id });
    if (updated.length === 0) throw new LeaseLost();
  }

  /**
   * One stream's cursor, merged into the source's: the later cursor wins, so a writer that
   * read the source before another advanced it can never move that stream backwards, and no
   * stream's write touches another's.
   */
  async function writeCursor(row: DeliverySyncRow, name: string, entry: Record<string, unknown>) {
    const result = await options.db.execute(sql`
      UPDATE delivery_sources
      SET updated_at = ${clock().toISOString()}::timestamptz,
          cursors = jsonb_set(cursors, ARRAY[${name}::text],
            CASE WHEN cursors -> ${name}::text ->> 'cursor' IS NULL
                   OR (cursors -> ${name}::text ->> 'cursor')::timestamptz
                      <= ${String(entry['cursor'])}::timestamptz
                 THEN ${JSON.stringify(entry)}::jsonb
                 ELSE cursors -> ${name}::text END, true)
      WHERE workspace_id = ${row.workspaceId} AND id = ${row.sourceId} AND ${holdsLease(row)}
      RETURNING id`);
    if (rowsOf(result).length === 0) throw new LeaseLost();
  }

  /** Pushes the lease a full term from now; a sync renews it after every stream. */
  async function renew(row: DeliverySyncRow): Promise<void> {
    const renewed = await options.db
      .update(deliverySyncs)
      .set({ nextAttemptAt: new Date(clock().getTime() + leaseMs) })
      .where(
        and(
          eq(deliverySyncs.id, row.id),
          eq(deliverySyncs.leaseId, row.leaseId as string),
          eq(deliverySyncs.status, 'running'),
        ),
      )
      .returning({ id: deliverySyncs.id });
    if (renewed.length === 0) throw new LeaseLost();
  }

  async function writeFinish(
    row: DeliverySyncRow,
    values: Partial<DeliverySyncRow> & { status: Exclude<SyncOutcome['status'], 'abandoned'> },
  ): Promise<SyncOutcome> {
    const written = await options.db
      .update(deliverySyncs)
      .set({ ...values, ...(values.status === 'queued' ? {} : { finishedAt: clock() }) })
      .where(
        and(
          eq(deliverySyncs.workspaceId, row.workspaceId),
          eq(deliverySyncs.id, row.id),
          eq(deliverySyncs.leaseId, row.leaseId as string),
          eq(deliverySyncs.status, 'running'),
        ),
      )
      .returning({ id: deliverySyncs.id });
    if (written.length === 0) throw new LeaseLost();
    return { id: row.id, status: values.status, errorCode: values.errorCode ?? null };
  }

  /**
   * Ends the claim. Putting it back as `queued` while another sync of the source is already
   * queued would be a second queued row, which the unique index refuses: that one does the
   * same work, so this one is closed as `superseded`.
   */
  async function finish(
    row: DeliverySyncRow,
    values: Partial<DeliverySyncRow> & { status: Exclude<SyncOutcome['status'], 'abandoned'> },
  ): Promise<SyncOutcome> {
    try {
      return await writeFinish(row, values);
    } catch (error) {
      if (values.status !== 'queued' || !isUniqueViolation(error)) throw error;
      return writeFinish(row, {
        status: 'failed',
        errorCode: 'superseded',
        errorMessage: 'Another sync of this source is already queued.',
      });
    }
  }

  async function notConfigured(row: DeliverySyncRow, message: string): Promise<SyncOutcome> {
    await updateSource(row, { lastStatus: 'not_configured', lastError: message });
    return finish(row, { status: 'failed', errorCode: 'not_configured', errorMessage: message });
  }

  async function failed(row: DeliverySyncRow, error: unknown): Promise<SyncOutcome> {
    if (error instanceof LeaseLost) throw error;
    if (error instanceof StreamFailure && error.retryAt !== null) {
      await updateSource(row, {
        lastStatus: 'rate_limited',
        lastError: `GitHub rate limit; reading again at ${error.retryAt.toISOString()}`,
        rateLimitedUntil: error.retryAt,
      });
      // A limit is not a failure: the attempt it cost is given back.
      return finish(row, {
        status: 'queued',
        attempts: Math.max(0, row.attempts - 1),
        nextAttemptAt: error.retryAt,
        errorCode: error.code,
      });
    }
    const code = error instanceof StreamFailure ? error.code : 'delivery_sync_failed';
    const retryable = !(error instanceof StreamFailure) || error.retryable;
    await updateSource(row, { lastStatus: 'failed', lastError: code });
    if (retryable && row.attempts < maxAttempts) {
      const wait = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)] as number;
      return finish(row, {
        status: 'queued',
        nextAttemptAt: new Date(clock().getTime() + wait),
        errorCode: code,
      });
    }
    return finish(row, { status: 'failed', errorCode: code });
  }

  /** The stream context for a claimed sync, or the outcome when it cannot sync at all. */
  async function prepare(row: DeliverySyncRow): Promise<StreamContext | SyncOutcome> {
    const [source] = await options.db
      .select()
      .from(deliverySources)
      .where(
        and(eq(deliverySources.workspaceId, row.workspaceId), eq(deliverySources.id, row.sourceId)),
      )
      .limit(1);
    if (source === undefined) return finish(row, { status: 'failed', errorCode: 'source_missing' });
    const project = await projectRow(
      { db: options.db, workspaceId: row.workspaceId },
      row.projectId,
    );
    const repository = githubRepository(project.repositoryUrl);
    if (repository === null) {
      return notConfigured(
        row,
        'The project has no github.com repository URL. Delivery sync reads GitHub only; push deployments from CI instead.',
      );
    }
    const token = await tokenFor(row.workspaceId, project.id).catch(() => null);
    if (token === null) {
      return notConfigured(
        row,
        'No GitHub token is stored for this project, or the vault cannot open it. Save a token on the project to sync.',
      );
    }
    return {
      adapter: options.adapter,
      token,
      owner: repository.owner,
      repo: repository.repo,
      project,
      source,
      db: options.db,
      workspaceId: row.workspaceId,
      now: clock(),
      maxPullRequests: options.maxPullRequests ?? 30,
      commitRetention: options.commitRetention ?? COMMIT_RETENTION,
      attribution: attributionOptionsOf(healthPolicyOf(project)?.aiGovernance),
    };
  }

  /** Every stream in turn, each one's cursor saved and the lease renewed as it finishes. */
  async function runStreams(
    row: DeliverySyncRow,
    context: StreamContext,
  ): Promise<Record<string, number>> {
    const parsed = StreamsSchema.safeParse(context.source.cursors);
    const cursors = parsed.success ? parsed.data : {};
    const { now } = context;
    const backfill = new Date(now.getTime() - BACKFILL_DAYS * DAY_MS).toISOString();
    const stats: Record<string, number> = { reclassified: await reclassifyStale(context) };
    for (const stream of STREAMS.filter((entry) => entry.applies(context.source))) {
      const saved = cursors[stream.name];
      const result = await stream.run(context, {
        cursor: saved?.cursor ?? backfill,
        incomplete: saved?.incomplete ?? null,
      });
      stats[stream.name] = result.written;
      // Saved stream by stream, so a later stream's failure keeps this one's progress.
      await writeCursor(row, stream.name, {
        cursor: result.cursor,
        syncedAt: now.toISOString(),
        incomplete: result.incomplete,
      });
      await renew(row);
    }
    return stats;
  }

  async function sync(row: DeliverySyncRow): Promise<SyncOutcome> {
    const context = await prepare(row);
    if (!('adapter' in context)) return context;
    let stats: Record<string, number>;
    try {
      stats = await runStreams(row, context);
    } catch (error) {
      return failed(row, error);
    }
    await updateSource(row, {
      lastStatus: 'ok',
      lastError: null,
      lastSyncedAt: context.now,
      rateLimitedUntil: null,
    });
    return finish(row, { status: 'done', errorCode: null, errorMessage: null, stats });
  }

  /** A claimed sync to its outcome; a lost lease is `abandoned`, and nothing more is written. */
  async function settle(row: DeliverySyncRow): Promise<SyncOutcome> {
    try {
      try {
        return await sync(row);
      } catch (error) {
        return await failed(row, error);
      }
    } catch (error) {
      if (!(error instanceof LeaseLost)) throw error;
      return { id: row.id, status: 'abandoned', errorCode: 'lease_lost' };
    }
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  let running: Promise<unknown> = Promise.resolve();

  return {
    /** Exhausted syncs failed, one claim, and every claimed sync run. */
    async runOnce(): Promise<SyncOutcome[]> {
      await exhaust();
      const outcomes: SyncOutcome[] = [];
      for (const row of await claim()) outcomes.push(await settle(row));
      for (const outcome of outcomes) options.log?.('delivery sync', { ...outcome });
      return outcomes;
    },
    start(intervalMs: number): void {
      if (timer !== undefined) return;
      timer = setInterval(() => {
        running = running
          .then(() => this.runOnce())
          .catch((error: unknown) =>
            options.log?.('delivery sync failed', {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
      }, intervalMs);
      timer.unref();
    },
    async stop(): Promise<void> {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      await running;
    },
  };
}

export type DeliverySyncer = ReturnType<typeof createDeliverySyncer>;
