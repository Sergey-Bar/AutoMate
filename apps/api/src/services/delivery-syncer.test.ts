import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import { githubAdapter } from '@automate/connectors-github';
import { AGENT_SIGNATURES } from '@automate/reporting';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  createDeliverySyncer,
  LOOKBACK_MS,
  type DeliverySyncerOptions,
} from './delivery-syncer.js';
import { requestDeliverySync } from './delivery-service.js';

/**
 * The delivery sync against the real migration graph and the real GitHub adapter, with only
 * `fetch` replaced: what GitHub would answer, routed by path, newest first as GitHub orders.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(closers.splice(0).map((close) => close()));
});

const NOW = new Date('2026-10-23T12:00:00.000Z');
const HOUR = 3_600_000;
const at = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();
const REPO = '/repos/octo/service';

interface Reply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** The GitHub this test talks to. A route answering a function can count, vary or page. */
function github(
  routes: Record<string, Reply | ((url: URL) => Reply)>,
  fallback: (url: URL) => Reply = () => ({ status: 404 }),
) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    const parsed = new URL(url);
    const { pathname } = parsed;
    calls.push(pathname);
    const route = routes[pathname];
    const reply = typeof route === 'function' ? route(parsed) : (route ?? fallback(parsed));
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      headers: new Headers(reply.headers ?? {}),
      json: () => Promise.resolve(reply.body ?? []),
    });
  });
  return calls;
}

/** One page of `items` as GitHub pages a list: `per_page`, `page`, and a `Link` to the next. */
function paged(items: readonly unknown[], url: URL, wrap?: (page: unknown[]) => unknown): Reply {
  const perPage = Number(url.searchParams.get('per_page') ?? '30');
  const page = Number(url.searchParams.get('page') ?? '1');
  const slice = items.slice((page - 1) * perPage, page * perPage);
  const next = new URL(url);
  next.searchParams.set('page', String(page + 1));
  return {
    status: 200,
    body: wrap === undefined ? slice : wrap(slice),
    headers: page * perPage < items.length ? { link: `<${next.toString()}>; rel="next"` } : {},
  };
}

const ok = (body: unknown): Reply => ({ status: 200, body });

/** A merged pull request with an author's self-review, a real review, a test file and a source file. */
const HAPPY: Record<string, Reply> = {
  [`${REPO}/pulls`]: ok([
    {
      id: 902,
      number: 12,
      state: 'open',
      draft: false,
      user: { login: 'carol' },
      head: { ref: 'feature/wip' },
      base: { ref: 'main' },
      labels: [],
      title: 'Work in progress',
      body: null,
      created_at: at(-30),
      updated_at: at(-2),
      closed_at: null,
      merged_at: null,
      merge_commit_sha: 'f00dfeed00',
    },
    {
      id: 901,
      number: 11,
      state: 'closed',
      draft: false,
      user: { login: 'alice' },
      head: { ref: 'hotfix/login' },
      base: { ref: 'main' },
      labels: [{ name: 'hotfix' }],
      title: 'Fix login',
      body: 'x'.repeat(5000),
      created_at: at(-48),
      updated_at: at(-20),
      closed_at: at(-20),
      merged_at: at(-20),
      merge_commit_sha: 'ABC1111',
    },
    { not: 'a pull request' },
  ]),
  [`${REPO}/pulls/11/reviews`]: ok([
    { user: { login: 'alice' }, state: 'COMMENTED', submitted_at: at(-47) },
    { user: { login: 'bob' }, state: 'COMMENTED', submitted_at: at(-40) },
    { user: { login: 'bob' }, state: 'APPROVED', submitted_at: at(-30) },
    { user: { login: 'dave' }, state: 'PENDING', submitted_at: null },
  ]),
  [`${REPO}/pulls/11/commits`]: ok([
    {
      sha: 'C0001',
      commit: {
        author: { name: 'Alice', email: 'alice@example.test', date: at(-60) },
        committer: { date: at(-59) },
        message: 'fix: login',
      },
      author: { login: 'alice' },
      committer: { login: 'web-flow' },
    },
  ]),
  [`${REPO}/pulls/11/files`]: ok([
    { filename: 'src/login.ts', additions: 10, deletions: 2 },
    { filename: 'src/login.test.ts', additions: 30, deletions: 0 },
  ]),
  [`${REPO}/pulls/12/reviews`]: ok([]),
  [`${REPO}/pulls/12/commits`]: ok([]),
  [`${REPO}/pulls/12/files`]: ok([{ filename: 'README.md', additions: 1, deletions: 0 }]),
  [`${REPO}/commits`]: ok([
    {
      sha: 'ABC1111',
      commit: {
        author: { name: 'Alice', email: 'alice@example.test', date: at(-20) },
        committer: null,
        message: 'Merge pull request #11',
      },
      author: null,
      committer: null,
    },
    {
      sha: 'C0001',
      commit: { author: { date: at(-60) }, committer: null, message: 'fix: login' },
      author: null,
      committer: null,
    },
  ]),
  [`${REPO}/deployments`]: ok([
    { id: 7002, sha: 'ffff000', environment: 'production', created_at: at(-1) },
    { id: 7001, sha: 'ABC1111', environment: 'production', created_at: at(-19) },
  ]),
  [`${REPO}/deployments/7001/statuses`]: ok([
    { state: 'success', environment_url: 'https://service.example.test' },
  ]),
  [`${REPO}/deployments/7002/statuses`]: ok([{ state: 'in_progress' }]),
  [`${REPO}/actions/runs`]: ok({
    workflow_runs: [
      {
        id: 55,
        name: 'Deploy',
        path: '.github/workflows/deploy.yml',
        head_sha: 'ABC1111',
        conclusion: 'success',
        created_at: at(-19.5),
        updated_at: at(-19),
        html_url: 'https://github.com/octo/service/actions/runs/55',
      },
      {
        id: 56,
        name: 'CI',
        head_sha: 'ABC1111',
        conclusion: 'success',
        created_at: at(-19.5),
        updated_at: at(-19),
      },
    ],
  }),
};

async function setup(
  options: {
    repositoryUrl?: string | null;
    workspaceId?: string;
    deployWorkflows?: string[];
    syncer?: Partial<DeliverySyncerOptions>;
  } = {},
) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const workspaceId = options.workspaceId ?? 'ws-1';
  const [project] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      name: 'Service',
      slug: 'service',
      defaultBranch: 'main',
      repositoryUrl:
        options.repositoryUrl === undefined
          ? 'https://github.com/octo/service.git'
          : options.repositoryUrl,
    })
    .returning({ id: schema.projects.id });
  const projectId = (project as { id: string }).id;
  await db.insert(schema.deliverySources).values({
    workspaceId,
    projectId,
    enabled: true,
    deployWorkflows: options.deployWorkflows ?? [],
  });
  const tokens: Array<[string, string]> = [];
  const syncer = createDeliverySyncer({
    db: db as never,
    vaultSecret: undefined,
    adapter: githubAdapter,
    now: () => NOW,
    tokenFor: async (ws, id) => {
      tokens.push([ws, id]);
      return 'ghp_synthetic';
    },
    ...options.syncer,
  });
  const queue = () =>
    requestDeliverySync({ db: db as never, workspaceId, now: () => NOW }, projectId);
  return { db, projectId, syncer, queue, tokens, workspaceId };
}

const source = async (db: MigratedDb) => (await db.select().from(schema.deliverySources))[0];
const sync = async (db: MigratedDb, id: string) =>
  (await db.select().from(schema.deliverySyncs).where(eq(schema.deliverySyncs.id, id)))[0];

describe('a sync, end to end against a stubbed GitHub', () => {
  it('writes pull requests, commits and decided deployments, and advances every cursor', async () => {
    github(HAPPY);
    const { db, syncer, queue, tokens, projectId } = await setup({ deployWorkflows: ['deploy'] });
    const { syncId } = await queue();
    expect(await syncer.runOnce()).toEqual([{ id: syncId, status: 'done', errorCode: null }]);
    expect(tokens).toEqual([['ws-1', projectId]]);

    const prs = await db.select().from(schema.pullRequests);
    const merged = prs.find((pr) => pr.number === 11);
    expect(merged).toMatchObject({
      state: 'merged',
      authorLogin: 'alice',
      headBranch: 'hotfix/login',
      labels: ['hotfix'],
      mergeCommitSha: 'abc1111',
      firstCommitAt: new Date(at(-60)),
      // The author's own comment is not a review; a pending review is not one either.
      firstReviewAt: new Date(at(-40)),
      approvedAt: new Date(at(-30)),
      reviewCount: 2,
      approvalCount: 1,
      commentCount: 1,
      additions: 40,
      deletions: 2,
      changedFiles: 2,
      testsTouched: true,
    });
    expect(merged?.body).toHaveLength(4000);
    // An open pull request's merge_commit_sha is GitHub's test merge, not a merge.
    expect(prs.find((pr) => pr.number === 12)).toMatchObject({
      state: 'open',
      mergeCommitSha: null,
      testsTouched: false,
    });

    const stored = await db.select().from(schema.commits);
    expect(stored.map((commit) => [commit.sha, commit.prNumber]).sort()).toEqual([
      ['abc1111', null],
      ['c0001', 11],
    ]);

    const deployed = await db.select().from(schema.deployments);
    // 7002 is still in progress: no row until GitHub decides. The Deploy run is a deployment;
    // the CI run is not.
    expect(deployed.map((row) => [row.externalId, row.status, row.sha]).sort()).toEqual([
      ['7001', 'success', 'abc1111'],
      ['run:55', 'success', 'abc1111'],
    ]);
    expect(deployed.find((row) => row.externalId === '7001')?.url).toBe(
      'https://service.example.test',
    );

    const after = await source(db);
    expect(after).toMatchObject({ lastStatus: 'ok', lastError: null, lastSyncedAt: NOW });
    expect(after?.cursors).toEqual({
      pullRequests: { cursor: at(-2), syncedAt: NOW.toISOString(), incomplete: null },
      commits: { cursor: at(-20), syncedAt: NOW.toISOString(), incomplete: null },
      deployments: { cursor: at(-1), syncedAt: NOW.toISOString(), incomplete: null },
      workflowRuns: { cursor: at(-19.5), syncedAt: NOW.toISOString(), incomplete: null },
    });
    expect((await sync(db, syncId))?.stats).toEqual({
      reclassified: 0,
      pullRequests: 2,
      commits: 2,
      deployments: 1,
      workflowRuns: 1,
    });
  });

  it('classifies each pull request from itself and its commits, and keeps head sha, paths and human approvals', async () => {
    const pulls = (HAPPY[`${REPO}/pulls`]?.body ?? []) as Array<Record<string, unknown>>;
    github({
      ...HAPPY,
      [`${REPO}/pulls`]: ok(
        pulls.map((pr) =>
          pr['number'] === 12 ? { ...pr, head: { ref: 'copilot/readme', sha: 'BEEF12' } } : pr,
        ),
      ),
      [`${REPO}/pulls/11/reviews`]: ok([
        { user: { login: 'bob' }, state: 'APPROVED', submitted_at: at(-30) },
        { user: { login: 'github-actions[bot]' }, state: 'APPROVED', submitted_at: at(-30) },
      ]),
      [`${REPO}/pulls/12/commits`]: ok([
        {
          sha: 'C0012',
          commit: {
            author: { name: 'Carol', email: 'carol@example.test', date: at(-29) },
            committer: { date: at(-29) },
            message: 'Update README\n\nCo-authored-by: Claude <noreply@anthropic.com>',
          },
          author: { login: 'carol' },
          committer: { login: 'carol' },
        },
      ]),
    });
    const { db, syncer, queue } = await setup();
    await queue();
    await syncer.runOnce();
    const prs = await db.select().from(schema.pullRequests);
    const human = prs.find((pr) => pr.number === 11);
    expect(human).toMatchObject({
      attribution: 'human',
      aiAgent: null,
      attributionConfidence: 0.5,
      attributionVersion: AGENT_SIGNATURES.version,
      headSha: null,
      changedPaths: ['src/login.ts', 'src/login.test.ts'],
      approvalCount: 2,
      humanApprovalCount: 1,
    });
    const agent = prs.find((pr) => pr.number === 12);
    // The branch says an agent pushed it; the commit's trailer says assisted. Authored wins.
    expect(agent).toMatchObject({
      attribution: 'agent-authored',
      aiAgent: 'github-copilot',
      headSha: 'beef12',
      changedPaths: ['README.md'],
    });
    expect(agent?.attributionConfidence).toBeGreaterThan(0.9);
    expect(agent?.attributionSignals.map((signal) => signal.kind).sort()).toEqual([
      'branch-prefix',
      'trailer',
    ]);
  });

  it('re-classifies stale rows from what is stored, before reading GitHub, in its own workspace only', async () => {
    github({
      [`${REPO}/pulls`]: ok([]),
      [`${REPO}/commits`]: ok([]),
      [`${REPO}/deployments`]: ok([]),
    });
    const { db, syncer, queue, projectId } = await setup();
    const other = await db
      .insert(schema.projects)
      .values({ workspaceId: 'ws-2', name: 'Other', slug: 'other', repositoryUrl: null })
      .returning({ id: schema.projects.id });
    const otherId = (other[0] as { id: string }).id;
    const row = (workspaceId: string, project: string, externalId: string) => ({
      workspaceId,
      projectId: project,
      externalId,
      number: 5,
      state: 'merged',
      authorLogin: 'alice',
      title: 'Add search',
      openedAt: new Date(at(-100)),
      mergedAt: new Date(at(-90)),
      lastActivityAt: new Date(at(-90)),
      attributionVersion: '2020-01-01',
    });
    await db
      .insert(schema.pullRequests)
      .values([row('ws-1', projectId, '5'), row('ws-2', otherId, '5')]);
    await db.insert(schema.commits).values({
      workspaceId: 'ws-1',
      projectId,
      sha: 'c5',
      prNumber: 5,
      authorLogin: 'alice',
      message: 'Add search\n\nCo-authored-by: Claude <noreply@anthropic.com>',
      committedAt: new Date(at(-95)),
    });
    const { syncId } = await queue();
    await syncer.runOnce();
    const stored = await db.select().from(schema.pullRequests);
    expect(stored.find((pr) => pr.workspaceId === 'ws-1')).toMatchObject({
      attribution: 'ai-assisted',
      aiAgent: 'claude-code',
      attributionVersion: AGENT_SIGNATURES.version,
    });
    expect(stored.find((pr) => pr.workspaceId === 'ws-2')).toMatchObject({
      attribution: 'unknown',
      attributionVersion: '2020-01-01',
    });
    expect((await sync(db, syncId))?.stats).toMatchObject({ reclassified: 1 });
  });

  it('writes nothing twice when it runs again, and asks about no decided deployment twice', async () => {
    const calls = github(HAPPY);
    const { db, syncer, queue } = await setup();
    await queue();
    await syncer.runOnce();
    const counts = async () =>
      Promise.all(
        [schema.pullRequests, schema.commits, schema.deployments].map(
          async (table) => (await db.select().from(table)).length,
        ),
      );
    const first = await counts();
    calls.length = 0;
    await queue();
    expect((await syncer.runOnce())[0]?.status).toBe('done');
    expect(await counts()).toEqual(first);
    expect(calls).not.toContain(`${REPO}/deployments/7001/statuses`);
    // The undecided one is asked again, within the look-back.
    expect(calls).toContain(`${REPO}/deployments/7002/statuses`);
    // The next read starts from the cursors, a day back for deployments.
    expect(calls).toContain(`${REPO}/pulls`);
    expect(LOOKBACK_MS).toBe(24 * HOUR);
  });

  it('keeps only the most recent commits of a project', async () => {
    github(HAPPY);
    const { db, syncer, queue } = await setup({ syncer: { commitRetention: 1 } });
    await queue();
    await syncer.runOnce();
    expect((await db.select().from(schema.commits)).map((commit) => commit.sha)).toEqual([
      'abc1111',
    ]);
  });
});

describe('a source that cannot sync says so', () => {
  it('records not_configured for a project with no token, without calling GitHub', async () => {
    const calls = github(HAPPY);
    const { db, queue, projectId } = await setup();
    const syncer = createDeliverySyncer({
      db: db as never,
      vaultSecret: undefined,
      adapter: githubAdapter,
      now: () => NOW,
      tokenFor: async () => null,
    });
    const { syncId } = await queue();
    expect(await syncer.runOnce()).toEqual([
      { id: syncId, status: 'failed', errorCode: 'not_configured' },
    ]);
    expect(calls).toEqual([]);
    expect(await source(db)).toMatchObject({ lastStatus: 'not_configured' });
    expect((await source(db))?.lastError).toMatch(/No GitHub token/u);
    expect((await sync(db, syncId))?.finishedAt).toEqual(NOW);
    expect(projectId).toBeTruthy();
  });

  it('treats a vault that will not open as no token', async () => {
    github(HAPPY);
    const { db, queue } = await setup();
    // The default reader, with no vault secret configured.
    const syncer = createDeliverySyncer({
      db: db as never,
      vaultSecret: undefined,
      adapter: githubAdapter,
      now: () => NOW,
    });
    await queue();
    expect((await syncer.runOnce())[0]?.errorCode).toBe('not_configured');
  });

  it('records not_configured for a repository that is not on GitHub', async () => {
    const calls = github(HAPPY);
    const { db, syncer, queue } = await setup({ repositoryUrl: 'https://gitlab.com/octo/service' });
    await queue();
    expect((await syncer.runOnce())[0]?.errorCode).toBe('not_configured');
    expect((await source(db))?.lastError).toMatch(/GitHub only/u);
    expect(calls).toEqual([]);
  });
});

describe('rate limits', () => {
  // The adapter waits `max(Date.now(), reset)`, reading the real clock. A reset fixed in the
  // real future is a clock bomb (it fails for good once that date passes), so only `Date` is
  // frozen at NOW - PGlite keeps its real timers - and the reset sits an hour after it.
  const RESET = at(1);
  beforeEach(() => {
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const limited: Reply = {
    status: 403,
    headers: {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(Date.parse(RESET) / 1000),
    },
  };

  it('puts the sync back until the reset, gives the attempt back, and holds the source', async () => {
    github({ ...HAPPY, [`${REPO}/pulls`]: limited });
    const { db, syncer, queue } = await setup();
    const { syncId } = await queue();
    expect(await syncer.runOnce()).toEqual([
      { id: syncId, status: 'queued', errorCode: 'github_rate_limited' },
    ]);
    expect(await sync(db, syncId)).toMatchObject({
      status: 'queued',
      attempts: 0,
      nextAttemptAt: new Date(RESET),
    });
    expect(await source(db)).toMatchObject({
      lastStatus: 'rate_limited',
      rateLimitedUntil: new Date(RESET),
      cursors: {},
    });
    // A new sync of the same source is not claimed while the limit holds.
    await db.update(schema.deliverySyncs).set({ nextAttemptAt: new Date(at(-1)) });
    expect(await syncer.runOnce()).toEqual([]);
  });

  it('keeps the cursor of a stream that finished before the limit, and only that one', async () => {
    github({ ...HAPPY, [`${REPO}/commits`]: limited });
    const { db, syncer, queue } = await setup();
    await queue();
    await syncer.runOnce();
    const cursors = (await source(db))?.cursors as Record<string, unknown>;
    expect(Object.keys(cursors)).toEqual(['pullRequests']);
  });
});

describe('the lease', () => {
  it('takes back a sync whose process died mid-run, once its lease lapsed', async () => {
    github(HAPPY);
    const { db, syncer, queue } = await setup();
    const { syncId } = await queue();
    await db
      .update(schema.deliverySyncs)
      .set({ status: 'running', attempts: 1, nextAttemptAt: new Date(at(-0.1)) });
    expect(await syncer.runOnce()).toEqual([{ id: syncId, status: 'done', errorCode: null }]);
    expect((await sync(db, syncId))?.attempts).toBe(2);
  });

  it('leaves a sync alone while another holds a live lease on the same source', async () => {
    github(HAPPY);
    const { db, syncer, queue, workspaceId } = await setup();
    const running = await queue();
    await db
      .update(schema.deliverySyncs)
      .set({ status: 'running', nextAttemptAt: new Date(at(1)) })
      .where(eq(schema.deliverySyncs.id, running.syncId));
    const waiting = await queue();
    expect(waiting.duplicate).toBe(false);
    expect(await syncer.runOnce()).toEqual([]);
    expect(
      (
        await db
          .select()
          .from(schema.deliverySyncs)
          .where(
            and(
              eq(schema.deliverySyncs.workspaceId, workspaceId),
              eq(schema.deliverySyncs.id, waiting.syncId),
            ),
          )
      )[0]?.status,
    ).toBe('queued');
  });
});

describe('the lease is owned, renewed and checked', () => {
  /** The real adapter, with a hook run before each operation it is asked for. */
  const hooked = (before: (operation: string) => Promise<void>) => ({
    manifest: githubAdapter.manifest,
    execute: async (...args: Parameters<typeof githubAdapter.execute>) => {
      await before(args[0].operation);
      return githubAdapter.execute(...args);
    },
  });

  it('writes nothing more once another process took the lease, and leaves its row alone', async () => {
    github(HAPPY);
    const box: { db?: MigratedDb } = {};
    let stolen = false;
    const harness = await setup({
      syncer: {
        adapter: hooked(async (operation) => {
          if (operation !== 'listCommits' || stolen) return;
          stolen = true;
          // A second process reclaims the row after this one's lease lapsed.
          await box.db?.update(schema.deliverySyncs).set({ leaseId: randomUUID() });
        }),
      },
    });
    box.db = harness.db;
    const { db } = harness;
    const { syncId } = await harness.queue();
    const [outcome] = await harness.syncer.runOnce();
    expect(outcome).toEqual({ id: syncId, status: 'abandoned', errorCode: 'lease_lost' });
    // The pull-request stream finished before the takeover; nothing after it was written.
    expect(Object.keys(((await source(db))?.cursors ?? {}) as object)).toEqual(['pullRequests']);
    expect(await sync(db, syncId)).toMatchObject({ status: 'running', finishedAt: null });
    expect((await source(db))?.lastStatus).toBeNull();
  });

  it('renews the lease after each stream, so a long sync is not taken back while it runs', async () => {
    github(HAPPY);
    let current = NOW;
    const box: { db?: MigratedDb } = {};
    let leaseDuringCommits: Date | undefined;
    const harness = await setup({
      syncer: {
        now: () => current,
        adapter: hooked(async (operation) => {
          if (operation === 'listPullRequests') current = new Date(NOW.getTime() + 5 * 60_000);
          if (operation === 'listCommits') {
            leaseDuringCommits = (await box.db?.select().from(schema.deliverySyncs))?.[0]
              ?.nextAttemptAt;
          }
        }),
      },
    });
    box.db = harness.db;
    await harness.queue();
    await harness.syncer.runOnce();
    expect(leaseDuringCommits).toEqual(new Date(NOW.getTime() + 15 * 60_000));
  });

  it('merges cursors per stream, so a stale writer cannot move one backwards', async () => {
    github(HAPPY);
    const box: { db?: MigratedDb } = {};
    const harness = await setup({
      syncer: {
        adapter: hooked(async (operation) => {
          if (operation !== 'listCommits') return;
          // Another sync of the source advanced the pull-request cursor meanwhile.
          await box.db?.update(schema.deliverySources).set({
            cursors: { pullRequests: { cursor: at(5), syncedAt: at(5) } },
          });
        }),
      },
    });
    box.db = harness.db;
    const { db } = harness;
    await harness.queue();
    await harness.syncer.runOnce();
    const cursors = (await source(db))?.cursors as Record<string, { cursor: string }>;
    expect(cursors['pullRequests']?.cursor).toBe(at(5));
    expect(cursors['commits']?.cursor).toBe(at(-20));
  });

  it('fails a sync that used every attempt rather than reclaiming it forever', async () => {
    github(HAPPY);
    const { db, syncer, queue } = await setup({ syncer: { maxAttempts: 3 } });
    const { syncId } = await queue();
    await db
      .update(schema.deliverySyncs)
      .set({ status: 'running', attempts: 3, nextAttemptAt: new Date(at(-0.1)) });
    expect(await syncer.runOnce()).toEqual([]);
    expect(await sync(db, syncId)).toMatchObject({
      status: 'failed',
      errorCode: 'attempts_exhausted',
      finishedAt: NOW,
    });
  });

  it('closes a sync it would requeue as superseded when another of its source is already queued', async () => {
    github({ ...HAPPY, [`${REPO}/pulls`]: { status: 502 } });
    let queueAgain: () => Promise<unknown> = async () => undefined;
    const harness = await setup({
      syncer: { adapter: hooked(async () => void (await queueAgain())) },
    });
    const { syncId } = await harness.queue();
    queueAgain = async () => {
      queueAgain = async () => undefined;
      await harness.queue();
    };
    expect(await harness.syncer.runOnce()).toEqual([
      { id: syncId, status: 'failed', errorCode: 'superseded' },
    ]);
    const queued = (await harness.db.select().from(schema.deliverySyncs)).filter(
      (row) => row.status === 'queued',
    );
    expect(queued).toHaveLength(1);
  });

  it('holds at most one queued sync per source, however the requests race', async () => {
    const { db, queue, projectId, workspaceId } = await setup();
    const [first, second] = await Promise.all([queue(), queue()]);
    expect(first.syncId).toBe(second.syncId);
    expect([first.duplicate, second.duplicate].sort()).toEqual([false, true]);
    const [row] = await db.select().from(schema.deliverySources);
    await expect(
      db.insert(schema.deliverySyncs).values({
        workspaceId,
        projectId,
        sourceId: (row as { id: string }).id,
        requestedBy: 'schedule',
        idempotencyKey: 'a-second-queued-row',
      }),
    ).rejects.toThrow();
    expect(
      (await db.select().from(schema.deliverySyncs)).filter((entry) => entry.status === 'queued'),
    ).toHaveLength(1);
  });
});

describe('a backfill larger than one sync can read', () => {
  const empty = (url: URL): Reply =>
    url.pathname.endsWith('/actions/runs') ? ok({ workflow_runs: [] }) : ok([]);

  it('reads every default-branch commit past the page cap, across syncs, before moving on', async () => {
    // 350 commits, newest first, an hour apart: more than one sync's three pages of 100.
    const listed = Array.from({ length: 350 }, (_, index) => ({
      sha: `c${String(index).padStart(5, '0')}`,
      commit: {
        author: { date: at(-1 - index) },
        committer: null,
        message: `commit ${String(index)}`,
      },
      author: null,
      committer: null,
    }));
    github({ [`${REPO}/commits`]: (url) => paged(listed, url) }, empty);
    const { db, syncer, queue } = await setup();
    await queue();
    await syncer.runOnce();
    const midway = (await source(db))?.cursors as Record<string, Record<string, unknown>>;
    // Incomplete: the cursor has not moved, and the next page is remembered.
    expect(midway['commits']).toMatchObject({ incomplete: { nextPage: 4 } });
    await queue();
    await syncer.runOnce();
    expect(await db.select().from(schema.commits)).toHaveLength(350);
    const done = (await source(db))?.cursors as Record<string, Record<string, unknown>>;
    expect(done['commits']).toMatchObject({ cursor: at(-1), incomplete: null });
  });

  it('reads every pull request when more were updated than one sync reads in full', async () => {
    const pulls = Array.from({ length: 12 }, (_, index) => ({
      id: 1000 + index,
      number: index + 1,
      state: 'open',
      user: { login: 'alice' },
      head: { ref: `feature/${String(index)}` },
      base: { ref: 'main' },
      labels: [],
      title: `PR ${String(index + 1)}`,
      body: null,
      created_at: at(-200),
      updated_at: at(-100 + index),
      closed_at: null,
      merged_at: null,
    })).reverse();
    github({ [`${REPO}/pulls`]: (url) => paged(pulls, url) }, empty);
    const { db, syncer, queue } = await setup({ syncer: { maxPullRequests: 5 } });
    for (let round = 0; round < 3; round += 1) {
      await queue();
      await syncer.runOnce();
    }
    const numbers = (await db.select().from(schema.pullRequests)).map((pr) => pr.number);
    expect(numbers.sort((left, right) => left - right)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    const cursors = (await source(db))?.cursors as Record<string, Record<string, unknown>>;
    expect(cursors['pullRequests']).toMatchObject({ cursor: at(-89), incomplete: null });
  });

  it('does not move the deployment cursor past a deployment still pending', async () => {
    let decided = false;
    github(
      {
        [`${REPO}/deployments`]: ok([
          { id: 8002, sha: 'bbbb', environment: 'production', created_at: at(-1) },
          { id: 8001, sha: 'aaaa', environment: 'production', created_at: at(-30) },
        ]),
        [`${REPO}/deployments/8002/statuses`]: ok([{ state: 'success' }]),
        [`${REPO}/deployments/8001/statuses`]: () =>
          ok([{ state: decided ? 'success' : 'in_progress' }]),
      },
      empty,
    );
    const { db, syncer, queue } = await setup();
    await queue();
    await syncer.runOnce();
    const first = (await source(db))?.cursors as Record<string, { cursor: string }>;
    expect(first['deployments']?.cursor).toBe(at(-30));
    // A day and more later, GitHub decides the old one; it is still read.
    decided = true;
    await queue();
    await syncer.runOnce();
    const stored = await db.select().from(schema.deployments);
    expect(stored.map((row) => row.externalId).sort()).toEqual(['8001', '8002']);
    const second = (await source(db))?.cursors as Record<string, { cursor: string }>;
    expect(second['deployments']?.cursor).toBe(at(-1));
  });
});

describe('failures', () => {
  it('retries a GitHub outage with a backoff, then gives up after the attempts', async () => {
    github({ ...HAPPY, [`${REPO}/pulls`]: { status: 502 } });
    const { db, syncer, queue } = await setup({ syncer: { maxAttempts: 2 } });
    const { syncId } = await queue();
    expect((await syncer.runOnce())[0]).toEqual({
      id: syncId,
      status: 'queued',
      errorCode: 'github_502',
    });
    expect((await sync(db, syncId))?.nextAttemptAt).toEqual(new Date(NOW.getTime() + 60_000));
    await db.update(schema.deliverySyncs).set({ nextAttemptAt: new Date(at(-1)) });
    expect((await syncer.runOnce())[0]?.status).toBe('failed');
    expect(await source(db)).toMatchObject({ lastStatus: 'failed', lastError: 'github_502' });
  });

  it('does not retry a refusal waiting cannot fix', async () => {
    github({ ...HAPPY, [`${REPO}/pulls`]: { status: 404 } });
    const { syncer, queue } = await setup();
    await queue();
    expect((await syncer.runOnce())[0]).toMatchObject({
      status: 'failed',
      errorCode: 'github_404',
    });
  });

  it('fails a malformed answer, and an unexpected error, without stopping the loop', async () => {
    github(HAPPY);
    const { db, queue } = await setup();
    await queue();
    const malformed = createDeliverySyncer({
      db: db as never,
      vaultSecret: undefined,
      now: () => NOW,
      tokenFor: async () => 'ghp_synthetic',
      maxAttempts: 1,
      adapter: {
        manifest: githubAdapter.manifest,
        execute: async () => ({ status: 'ok', data: { not: 'a list' }, attempts: 1 }),
      },
    });
    expect((await malformed.runOnce())[0]?.errorCode).toBe('github_malformed');
    await queue();
    const throwing = createDeliverySyncer({
      db: db as never,
      vaultSecret: undefined,
      now: () => NOW,
      tokenFor: async () => 'ghp_synthetic',
      maxAttempts: 1,
      adapter: {
        manifest: githubAdapter.manifest,
        execute: async () => {
          throw new Error('boom');
        },
      },
    });
    expect((await throwing.runOnce())[0]?.errorCode).toBe('delivery_sync_failed');
    const bare = createDeliverySyncer({
      db: db as never,
      vaultSecret: undefined,
      now: () => NOW,
      tokenFor: async () => 'ghp_synthetic',
      maxAttempts: 1,
      adapter: {
        manifest: githubAdapter.manifest,
        execute: async () => ({ status: 'error', attempts: 1 }),
      },
    });
    await queue();
    expect((await bare.runOnce())[0]?.errorCode).toBe('github_failed');
  });
});

describe('workspace isolation', () => {
  it('writes a sync of another workspace’s source into that workspace only', async () => {
    github(HAPPY);
    const { db, syncer, queue, tokens } = await setup({ workspaceId: 'ws-2' });
    await queue();
    await syncer.runOnce();
    for (const table of [schema.pullRequests, schema.commits, schema.deployments]) {
      const rows = await db.select().from(table);
      expect(rows.length).toBeGreaterThan(0);
      expect(new Set(rows.map((row) => row.workspaceId))).toEqual(new Set(['ws-2']));
    }
    expect(tokens[0]?.[0]).toBe('ws-2');
  });
});

describe('the loop', () => {
  it('starts once, runs on its interval, and stops cleanly', async () => {
    github(HAPPY);
    const { syncer, queue } = await setup();
    await queue();
    const log = vi.fn();
    const looped = createDeliverySyncer({
      ...{ db: undefined as never, vaultSecret: undefined, adapter: githubAdapter },
      log,
    });
    vi.useFakeTimers();
    try {
      const failures = () =>
        log.mock.calls.filter(([message]) => message === 'delivery sync failed').length;
      looped.start(1000);
      // A second start is the same loop, not a second one beside it.
      looped.start(1000);
      await vi.advanceTimersByTimeAsync(1000);
      // A database that is not there is a logged failure, not a crash.
      expect(log).toHaveBeenCalledWith('delivery sync failed', expect.any(Object));
      expect(failures()).toBe(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(failures()).toBe(2);
      await looped.stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(failures()).toBe(2);
    } finally {
      vi.useRealTimers();
    }
    syncer.start(60_000);
    await syncer.stop();
  });
});
