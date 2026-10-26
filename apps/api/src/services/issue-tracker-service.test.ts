import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import * as schema from '@automate/db';
import { githubAdapter } from '@automate/connectors-github';
import { jiraAdapter } from '@automate/connectors-jira';
import {
  IssueLinkSchema,
  IssueTrackerReadingSchema,
  type ClusterIssueBody,
} from '@automate/shared-contracts';
import { createErrorBoundary } from '../errors/boundary.js';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import type { CallerResolver } from '../http/roles.js';
import { createIssueTrackingRoutes } from '../routes/issue-tracking.js';
import type { Caller } from './access-service.js';
import { storeGitToken } from './git-credential-service.js';
import {
  STALE_CLAIM_MS,
  clusterKey,
  createClusterIssue,
  createFindingIssue,
  getIssueTracker,
  setIssueTracker,
  type IssueAdapters,
  type IssueTrackerOptions,
} from './issue-tracker-service.js';
import { migratedDatabase, type MigratedDb } from '../test-support/migrated-database.js';
import {
  syntheticGithubToken,
  syntheticVaultSecret,
} from '../test-support/synthetic-credentials.js';

/**
 * Issues from findings and failure clusters, through the **real** Jira and GitHub adapters
 * with HTTP stubbed at `fetch` — so the request a tracker would receive, the manifest's retry
 * policy and the vault-held token are all the production ones.
 */

const VAULT = syntheticVaultSecret();
const JIRA_TOKEN = ['jira', '-api-token-', 'for-tests'].join('');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const ADAPTERS: IssueAdapters = {
  jira: jiraAdapter,
  github: githubAdapter,
  detailsUrl: (projectId) => `https://automate.test/dashboard/repo/${projectId}`,
};

interface Sent {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

type Answer = { status: number; body?: unknown };

/** Answers each request with the next answer, and records what was sent. */
function stubHttp(answers: Answer[]): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      sent.push({
        url: String(url),
        method: init?.method ?? 'GET',
        authorization: headers.get('authorization'),
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      const answer = answers.shift() ?? { status: 500 };
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  return sent;
}

const closers: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
});
afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function project(db: MigratedDb, workspaceId: string, repositoryUrl: string | null) {
  const [row] = await db
    .insert(schema.projects)
    .values({
      workspaceId,
      name: 'service',
      slug: `service-${String(Math.random()).slice(2, 10)}`,
      defaultBranch: 'main',
      repositoryUrl,
      profile: {},
    })
    .returning({ id: schema.projects.id });
  return (row as { id: string }).id;
}

async function finding(db: MigratedDb, workspaceId: string, projectId: string) {
  const [row] = await db
    .insert(schema.healthFindings)
    .values({
      workspaceId,
      projectId,
      branch: 'main',
      fingerprint: `fp-${String(Math.random()).slice(2, 10)}`,
      toolKey: 'semgrep',
      tool: 'semgrep',
      ruleId: 'js/sql-injection',
      kind: 'vulnerability',
      severity: 'high',
      dimension: 'security',
      path: 'src/db.ts',
      line: 42,
      message: 'Untrusted input reaches a SQL query',
      firstSeenAt: NOW,
      lastSeenAt: NOW,
    })
    .returning({ id: schema.healthFindings.id });
  return (row as { id: string }).id;
}

async function setup(repositoryUrl: string | null = 'https://github.com/acme/app') {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const options: IssueTrackerOptions = { db: db as never, workspaceId: 'ws-1', vaultSecret: VAULT };
  const projectId = await project(db, 'ws-1', repositoryUrl);
  const findingId = await finding(db, 'ws-1', projectId);
  return { db, options, projectId, findingId };
}

async function configureJira(options: IssueTrackerOptions, projectId: string) {
  return setIssueTracker(
    options,
    projectId,
    {
      kind: 'jira',
      baseUrl: 'https://acme.atlassian.net/',
      projectKey: 'ACME',
      issueType: 'Bug',
      token: JIRA_TOKEN,
    },
    'token:admin',
  );
}

async function refusal(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

const CLUSTER: ClusterIssueBody = {
  projectId: '',
  target: 'jira',
  signature: 'TypeError: cannot read properties of undefined (reading <str>)',
  errorType: 'TypeError',
  sampleMessage: "TypeError: cannot read properties of undefined (reading 'id')\n    at load",
  tests: ['checkout › pays', 'checkout › refunds'],
  count: 12,
  runs: 4,
  branches: ['main'],
};

describe('issue tracker configuration', () => {
  it('seals the token in the vault and never returns it', async () => {
    const { db, options, projectId } = await setup();
    const saved = await configureJira(options, projectId);
    expect(saved).toMatchObject({ created: true, tokenChanged: true });
    expect(saved.tracker).toMatchObject({
      baseUrl: 'https://acme.atlassian.net',
      projectKey: 'ACME',
      hasCredential: true,
    });
    expect(JSON.stringify(saved)).not.toContain(JIRA_TOKEN);
    const [row] = await db.select().from(schema.issueTrackers);
    expect(JSON.stringify(row)).not.toContain(JIRA_TOKEN);
    const [entry] = await db.select().from(schema.vaultEntries);
    expect(entry?.connectorName).toBe(`tracker:${projectId}:jira`);
    expect(JSON.stringify(entry)).not.toContain(JIRA_TOKEN);
  });

  it('keeps the sealed token when a later change sends none, and needs one the first time', async () => {
    const { options, projectId } = await setup();
    const first = await refusal(
      setIssueTracker(
        options,
        projectId,
        {
          kind: 'jira',
          baseUrl: 'https://acme.atlassian.net',
          projectKey: 'ACME',
          issueType: 'Bug',
        },
        'a',
      ),
    );
    expect(first.code).toBe(ErrorCode.INVALID_REQUEST_BODY);
    await configureJira(options, projectId);
    const changed = await setIssueTracker(
      options,
      projectId,
      { kind: 'jira', baseUrl: 'https://acme.atlassian.net', projectKey: 'OPS', issueType: 'Task' },
      'a',
    );
    expect(changed).toMatchObject({ created: false, tokenChanged: false });
    expect(changed.tracker).toMatchObject({ projectKey: 'OPS', hasCredential: true });
  });

  it('needs a new token to point the tracker at another origin: the stored one never follows', async () => {
    const { options, projectId } = await setup();
    await configureJira(options, projectId);
    const moved = await refusal(
      setIssueTracker(
        options,
        projectId,
        { kind: 'jira', baseUrl: 'https://evil.example', projectKey: 'ACME', issueType: 'Bug' },
        'a',
      ),
    );
    expect(moved.code).toBe(ErrorCode.INVALID_REQUEST_BODY);
    expect(moved.message).toMatch(/new token/u);
    expect((await getIssueTracker(options, projectId))?.baseUrl).toBe('https://acme.atlassian.net');
    // The same origin with another path keeps the token; a new origin with one is accepted.
    await setIssueTracker(
      options,
      projectId,
      {
        kind: 'jira',
        baseUrl: 'https://acme.atlassian.net/jira/',
        projectKey: 'ACME',
        issueType: 'Bug',
      },
      'a',
    );
    const repointed = await setIssueTracker(
      options,
      projectId,
      {
        kind: 'jira',
        baseUrl: 'https://jira.acme.example',
        projectKey: 'ACME',
        issueType: 'Bug',
        token: JIRA_TOKEN,
      },
      'a',
    );
    expect(repointed).toMatchObject({ tokenChanged: true });
  });

  it('refuses to configure a token without VAULT_SECRET, and leaves no tracker behind', async () => {
    const { db, options, projectId } = await setup();
    const error = await refusal(configureJira({ ...options, vaultSecret: undefined }, projectId));
    expect(error.code).toBe(ErrorCode.NOT_CONFIGURED);
    expect(await db.select().from(schema.issueTrackers)).toHaveLength(0);
  });
});

describe('an issue from a finding', () => {
  it('creates a Jira issue with the finding and a link back, and stores the link', async () => {
    const { db, options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    const sent = stubHttp([{ status: 201, body: { id: '1', key: 'ACME-7' } }]);
    const link = await createFindingIssue(
      options,
      ADAPTERS,
      { projectId, findingId, target: 'jira' },
      'token:op',
    );
    expect(IssueLinkSchema.parse(link)).toMatchObject({
      key: 'ACME-7',
      url: 'https://acme.atlassian.net/browse/ACME-7',
      created: true,
      target: 'jira',
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      url: 'https://acme.atlassian.net/rest/api/3/issue',
      method: 'POST',
      authorization: `Bearer ${JIRA_TOKEN}`,
    });
    const fields = (sent[0]?.body as { fields: Record<string, unknown> }).fields;
    expect(fields['summary']).toBe('[high] js/sql-injection: Untrusted input reaches a SQL query');
    expect(fields['project']).toEqual({ key: 'ACME' });
    const text = JSON.stringify(fields['description']);
    expect(text).toContain('Location: src/db.ts:42');
    expect(text).toContain(`Open in Automate: https://automate.test/dashboard/repo/${projectId}`);
    const [row] = await db.select().from(schema.issueLinks);
    expect(row).toMatchObject({ state: 'created', issueKey: 'ACME-7', sourceKey: findingId });
  });

  it('returns the stored issue on a repeat without calling Jira again', async () => {
    const { options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    const sent = stubHttp([{ status: 201, body: { key: 'ACME-7' } }]);
    const input = { projectId, findingId, target: 'jira' as const };
    const first = await createFindingIssue(options, ADAPTERS, input, 'a');
    const again = await createFindingIssue(options, ADAPTERS, input, 'b');
    expect(again).toMatchObject({ id: first.id, key: 'ACME-7', created: false, createdBy: 'a' });
    expect(sent).toHaveLength(1);
  });

  it('repeats a refusal Jira said it did nothing for (429), as the manifest allows', async () => {
    const { options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    const sent = stubHttp([{ status: 429 }, { status: 201, body: { key: 'ACME-8' } }]);
    const link = await createFindingIssue(
      options,
      ADAPTERS,
      { projectId, findingId, target: 'jira' },
      'a',
    );
    expect(link.key).toBe('ACME-8');
    expect(sent).toHaveLength(2);
  });

  it('does not repeat an ambiguous 5xx for a non-idempotent create, and releases the claim', async () => {
    const { db, options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    const sent = stubHttp([{ status: 502 }]);
    const input = { projectId, findingId, target: 'jira' as const };
    const error = await refusal(createFindingIssue(options, ADAPTERS, input, 'a'));
    expect(error.code).toBe(ErrorCode.DEPENDENCY_UNAVAILABLE);
    expect(error.details).toMatchObject({ connectorCode: 'jira_502', attempts: 1 });
    // `createIssue` is declared `idempotent: false`: one request, never three.
    expect(sent).toHaveLength(1);
    expect(await db.select().from(schema.issueLinks)).toHaveLength(0);
    // The released claim lets a person ask again.
    stubHttp([{ status: 201, body: { key: 'ACME-9' } }]);
    expect((await createFindingIssue(options, ADAPTERS, input, 'a')).key).toBe('ACME-9');
  });

  it('answers a concurrent create with a conflict, and takes over a claim that died', async () => {
    const { db, options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    await db.insert(schema.issueLinks).values({
      workspaceId: 'ws-1',
      projectId,
      sourceKind: 'finding',
      sourceKey: findingId,
      target: 'jira',
      state: 'pending',
      createdBy: 'other',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const sent = stubHttp([{ status: 201, body: { key: 'ACME-10' } }]);
    const input = { projectId, findingId, target: 'jira' as const };
    expect((await refusal(createFindingIssue(options, ADAPTERS, input, 'a'))).code).toBe(
      ErrorCode.CONFLICT,
    );
    expect(sent).toHaveLength(0);
    vi.setSystemTime(new Date(NOW.getTime() + STALE_CLAIM_MS + 1));
    expect((await createFindingIssue(options, ADAPTERS, input, 'a')).key).toBe('ACME-10');
    expect(await db.select().from(schema.issueLinks)).toHaveLength(1);
  });

  it('lets one of two concurrent takers of a dead claim through, and opens one issue', async () => {
    const { db, options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    await db.insert(schema.issueLinks).values({
      workspaceId: 'ws-1',
      projectId,
      sourceKind: 'finding',
      sourceKey: findingId,
      target: 'jira',
      state: 'pending',
      createdBy: 'other',
      createdAt: NOW,
      updatedAt: NOW,
    });
    const sent = stubHttp([
      { status: 201, body: { key: 'ACME-11' } },
      { status: 201, body: { key: 'ACME-12' } },
    ]);
    vi.setSystemTime(new Date(NOW.getTime() + STALE_CLAIM_MS + 1));
    const input = { projectId, findingId, target: 'jira' as const };
    const results = await Promise.allSettled([
      createFindingIssue(options, ADAPTERS, input, 'a'),
      createFindingIssue(options, ADAPTERS, input, 'b'),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const [rejected] = results.filter((result) => result.status === 'rejected');
    expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: ErrorCode.CONFLICT });
    expect(sent).toHaveLength(1);
    expect(await db.select().from(schema.issueLinks)).toHaveLength(1);
  });

  it('releases the claim when the adapter throws, so the source is not blocked', async () => {
    const { db, options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    const throwing: IssueAdapters = {
      ...ADAPTERS,
      jira: {
        manifest: jiraAdapter.manifest,
        execute: async () => {
          throw new Error('socket hang up');
        },
      },
    };
    const input = { projectId, findingId, target: 'jira' as const };
    await expect(createFindingIssue(options, throwing, input, 'a')).rejects.toThrow(
      'socket hang up',
    );
    expect(await db.select().from(schema.issueLinks)).toHaveLength(0);
  });

  it('is NOT_CONFIGURED with no tracker, no token or no connector, and calls nothing', async () => {
    const { db, options, projectId, findingId } = await setup();
    const sent = stubHttp([]);
    const input = { projectId, findingId, target: 'jira' as const };
    expect((await refusal(createFindingIssue(options, ADAPTERS, input, 'a'))).code).toBe(
      ErrorCode.NOT_CONFIGURED,
    );
    await configureJira(options, projectId);
    expect(
      (await refusal(createFindingIssue(options, { ...ADAPTERS, jira: undefined }, input, 'a')))
        .code,
    ).toBe(ErrorCode.NOT_CONFIGURED);
    await db.delete(schema.vaultEntries);
    expect((await refusal(createFindingIssue(options, ADAPTERS, input, 'a'))).code).toBe(
      ErrorCode.NOT_CONFIGURED,
    );
    expect((await getIssueTracker(options, projectId))?.hasCredential).toBe(false);
    expect(sent).toHaveLength(0);
    expect(await db.select().from(schema.issueLinks)).toHaveLength(0);
  });

  it('creates a GitHub issue with the project git token when GitHub is the named target', async () => {
    const { options, projectId, findingId } = await setup();
    const token = syntheticGithubToken();
    await storeGitToken(options, projectId, token);
    const sent = stubHttp([
      { status: 201, body: { number: 31, html_url: 'https://github.com/acme/app/issues/31' } },
    ]);
    const link = await createFindingIssue(
      options,
      ADAPTERS,
      { projectId, findingId, target: 'github' },
      'a',
    );
    expect(link).toMatchObject({ key: '#31', url: 'https://github.com/acme/app/issues/31' });
    expect(sent[0]?.url).toBe('https://api.github.com/repos/acme/app/issues');
    expect(sent[0]?.authorization).toContain(token);
    expect(sent[0]?.body).toMatchObject({ labels: ['automate'] });
  });

  it('refuses a GitHub issue for a project that is not on github.com, or has no token', async () => {
    const elsewhere = await setup('https://gitlab.com/acme/app');
    stubHttp([]);
    const input = (setup: { projectId: string; findingId: string }) => ({
      projectId: setup.projectId,
      findingId: setup.findingId,
      target: 'github' as const,
    });
    expect(
      (await refusal(createFindingIssue(elsewhere.options, ADAPTERS, input(elsewhere), 'a'))).code,
    ).toBe(ErrorCode.NOT_CONFIGURED);
    const noToken = await setup();
    expect(
      (await refusal(createFindingIssue(noToken.options, ADAPTERS, input(noToken), 'a'))).code,
    ).toBe(ErrorCode.NOT_CONFIGURED);
  });

  it('keeps another workspace out: its tracker, its finding and its links', async () => {
    const { db, options, projectId, findingId } = await setup();
    await configureJira(options, projectId);
    stubHttp([{ status: 201, body: { key: 'ACME-7' } }]);
    await createFindingIssue(options, ADAPTERS, { projectId, findingId, target: 'jira' }, 'a');
    const other: IssueTrackerOptions = { ...options, workspaceId: 'ws-2' };
    const sent = stubHttp([]);
    expect((await refusal(getIssueTracker(other, projectId))).code).toBe(ErrorCode.NOT_FOUND);
    expect(
      (
        await refusal(
          createFindingIssue(other, ADAPTERS, { projectId, findingId, target: 'jira' }, 'a'),
        )
      ).code,
    ).toBe(ErrorCode.NOT_FOUND);
    // A ws-2 project cannot name a ws-1 finding either.
    const foreign = await project(db, 'ws-2', null);
    expect(
      (
        await refusal(
          createFindingIssue(
            other,
            ADAPTERS,
            { projectId: foreign, findingId, target: 'jira' },
            'a',
          ),
        )
      ).code,
    ).toBe(ErrorCode.NOT_FOUND);
    expect(sent).toHaveLength(0);
    const links = await db
      .select()
      .from(schema.issueLinks)
      .where(eq(schema.issueLinks.workspaceId, 'ws-2'));
    expect(links).toHaveLength(0);
  });
});

describe('an issue from a failure cluster', () => {
  it('copes with a bare finding, a tracker answer it cannot read, and a long cluster', async () => {
    const { db, options, projectId } = await setup();
    await configureJira(options, projectId);
    const [bare] = await db
      .insert(schema.healthFindings)
      .values({
        workspaceId: 'ws-1',
        projectId,
        branch: 'main',
        fingerprint: 'fp-bare',
        toolKey: 'scorecard',
        tool: 'scorecard',
        ruleId: 'Branch-Protection',
        kind: 'posture',
        severity: 'low',
        dimension: 'supply-chain',
        path: null,
        line: null,
        message: 'No branch protection',
        helpUri: 'https://example.test/rule',
      })
      .returning({ id: schema.healthFindings.id });
    const findingId = (bare as { id: string }).id;
    // 201 with no key: nothing to link, so the claim is released and the caller told.
    const sent = stubHttp([
      { status: 201, body: {} },
      { status: 201, body: { key: 'ACME-12' } },
    ]);
    const input = { projectId, findingId, target: 'jira' as const };
    expect((await refusal(createFindingIssue(options, ADAPTERS, input, 'a'))).code).toBe(
      ErrorCode.DEPENDENCY_UNAVAILABLE,
    );
    expect(await db.select().from(schema.issueLinks)).toHaveLength(0);
    await createFindingIssue(options, { ...ADAPTERS, detailsUrl: undefined }, input, 'a');
    const text = JSON.stringify((sent[1]?.body as { fields: Record<string, unknown> }).fields);
    expect(text).toContain('Location: none');
    expect(text).toContain('Reference: https://example.test/rule');
    expect(text).not.toContain('Open in Automate');
    // A malformed id is "no such finding", not a uuid syntax error.
    expect(
      (await refusal(createFindingIssue(options, ADAPTERS, { ...input, findingId: 'nope' }, 'a')))
        .code,
    ).toBe(ErrorCode.NOT_FOUND);

    const many = Array.from({ length: 25 }, (_, index) => `suite › case ${String(index)}`);
    const sentCluster = stubHttp([{ status: 201, body: { key: 'ACME-13' } }]);
    await createClusterIssue(
      options,
      ADAPTERS,
      {
        ...CLUSTER,
        projectId,
        errorType: null,
        sampleMessage: '',
        tests: many,
        branches: [],
      },
      'a',
    );
    const cluster = JSON.stringify(sentCluster[0]?.body);
    expect(cluster).toContain('…and 5 more');
    expect(cluster).toContain(`Failing tests: failure — ${CLUSTER.signature}`);
    expect(cluster).not.toContain('Branches:');
  });

  it('refuses a GitHub answer with no issue number', async () => {
    const { options, projectId, findingId } = await setup();
    await storeGitToken(options, projectId, syntheticGithubToken());
    stubHttp([{ status: 201, body: { html_url: 'https://github.com/acme/app/issues/1' } }]);
    expect(
      (
        await refusal(
          createFindingIssue(options, ADAPTERS, { projectId, findingId, target: 'github' }, 'a'),
        )
      ).details,
    ).toMatchObject({ connectorCode: 'unknown' });
  });

  it('describes the cluster, files it under the signature hash, and is idempotent', async () => {
    const { db, options, projectId } = await setup();
    await configureJira(options, projectId);
    const sent = stubHttp([{ status: 201, body: { key: 'ACME-11' } }]);
    const body = { ...CLUSTER, projectId };
    const link = await createClusterIssue(options, ADAPTERS, body, 'a');
    expect(link).toMatchObject({ key: 'ACME-11', sourceKind: 'cluster', created: true });
    expect(link.sourceKey).toBe(clusterKey(CLUSTER.signature));
    const fields = (sent[0]?.body as { fields: Record<string, unknown> }).fields;
    expect(fields['summary']).toBe(
      "Failing tests: TypeError — TypeError: cannot read properties of undefined (reading 'id')",
    );
    const text = JSON.stringify(fields['description']);
    expect(text).toContain('12 failures across 4 runs share one root cause.');
    expect(text).toContain('- checkout › refunds');
    expect((await createClusterIssue(options, ADAPTERS, body, 'b')).created).toBe(false);
    expect(sent).toHaveLength(1);
    const rows = await db
      .select()
      .from(schema.issueLinks)
      .where(and(eq(schema.issueLinks.sourceKind, 'cluster')));
    expect(rows).toHaveLength(1);
  });
});

describe('the issue tracking routes', () => {
  async function routes() {
    const context = await setup();
    const tokens: Record<string, Caller> = {
      amt_viewer: { actor: 'token:viewer', role: 'viewer', uploaderFor: null },
      amt_operator: { actor: 'token:operator', role: 'operator', uploaderFor: null },
      amt_admin: { actor: 'token:admin', role: 'admin', uploaderFor: null },
    };
    const access: CallerResolver = {
      mode: 'enforced',
      authenticateToken: async (token) => tokens[token] ?? null,
      hasSession: async () => false,
    };
    const { onError } = createErrorBoundary({
      log: () => undefined,
      reportError: () => undefined,
      requestId: () => 'NO_REQUEST',
    });
    const app = new Hono()
      .onError(onError)
      .route('/', createIssueTrackingRoutes({ ...context.options, access, adapters: ADAPTERS }));
    const call = (method: string, path: string, token?: string, body?: unknown) =>
      app.request(path, {
        method,
        headers: {
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { ...context, call };
  }

  const TRACKER = {
    baseUrl: 'https://acme.atlassian.net',
    projectKey: 'ACME',
    issueType: 'Bug',
    token: JIRA_TOKEN,
  };

  it('updates a tracker with 200 and an update audit, and audits a cluster issue as one', async () => {
    const { db, projectId, call } = await routes();
    const path = `/api/v1/projects/${projectId}/issue-tracker`;
    expect((await call('PUT', path, 'amt_admin', TRACKER)).status).toBe(201);
    const updated = await call('PUT', path, 'amt_admin', { ...TRACKER, issueType: 'Task' });
    expect(updated.status).toBe(200);
    expect(IssueTrackerReadingSchema.parse(await updated.json()).tracker?.issueType).toBe('Task');
    const [update] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'issue-tracker.update'));
    expect(update).toMatchObject({ actorId: 'token:admin', resourceId: projectId });
    expect(update?.details).toMatchObject({ host: 'acme.atlassian.net', issueType: 'Task' });
    expect(JSON.stringify(update)).not.toContain(JIRA_TOKEN);

    const issue = '/api/v1/dashboard/failure-clusters/issue';
    expect((await call('POST', issue, 'amt_operator', { projectId })).status).toBe(400);
    expect((await call('POST', issue, 'amt_operator')).status).toBe(400);
    stubHttp([{ status: 201, body: { key: 'ACME-9' } }]);
    const created = await call('POST', issue, 'amt_operator', { ...CLUSTER, projectId });
    expect(created.status).toBe(201);
    expect(IssueLinkSchema.parse(await created.json())).toMatchObject({
      sourceKind: 'cluster',
      key: 'ACME-9',
      created: true,
    });
    const [audited] = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.resourceType, 'failure_cluster'));
    expect(audited).toMatchObject({ action: 'issue.create', actorId: 'token:operator' });
  });

  it('lets only an admin configure a tracker, audits it without the token, and never returns it', async () => {
    const { db, projectId, call } = await routes();
    const path = `/api/v1/projects/${projectId}/issue-tracker`;
    expect(await (await call('DELETE', path, 'amt_admin')).json()).toEqual({
      ok: true,
      removed: false,
    });
    expect(await (await call('GET', path, 'amt_viewer')).json()).toEqual({ tracker: null });
    expect((await call('PUT', path, 'amt_operator', TRACKER)).status).toBe(403);
    expect((await call('PUT', path, undefined, TRACKER)).status).toBe(401);
    expect((await call('PUT', path, 'amt_admin', { ...TRACKER, baseUrl: 'http://x' })).status).toBe(
      400,
    );
    const created = await call('PUT', path, 'amt_admin', TRACKER);
    expect(created.status).toBe(201);
    const read = await call('GET', path, 'amt_viewer');
    const text = await read.text();
    expect(text).not.toContain(JIRA_TOKEN);
    expect(IssueTrackerReadingSchema.parse(JSON.parse(text)).tracker?.hasCredential).toBe(true);
    const trail = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.action, 'issue-tracker.create'));
    expect(trail[0]).toMatchObject({ actorId: 'token:admin', resourceId: projectId });
    expect(JSON.stringify(trail)).not.toContain(JIRA_TOKEN);
    expect((await call('DELETE', path, 'amt_operator')).status).toBe(403);
    const removed = await call('DELETE', path, 'amt_admin');
    expect(await removed.json()).toEqual({ ok: true, removed: true });
    expect(await db.select().from(schema.vaultEntries)).toHaveLength(0);
  });

  it('lets an operator, not a viewer, create an issue; 201 then 200, each audited', async () => {
    const { db, projectId, findingId, call } = await routes();
    await call('PUT', `/api/v1/projects/${projectId}/issue-tracker`, 'amt_admin', TRACKER);
    const sent = stubHttp([{ status: 201, body: { key: 'ACME-7' } }]);
    const path = `/api/v1/projects/${projectId}/health/findings/${findingId}/issue`;
    expect((await call('POST', path, 'amt_viewer', { target: 'jira' })).status).toBe(403);
    expect((await call('POST', path, 'amt_operator', { target: 'linear' })).status).toBe(400);
    expect((await call('POST', path, 'amt_operator', { target: 'jira' })).status).toBe(201);
    expect((await call('POST', path, 'amt_operator', { target: 'jira' })).status).toBe(200);
    expect(sent).toHaveLength(1);
    const actions = (
      await db
        .select({ action: schema.auditEvents.action })
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.resourceType, 'health_finding'))
    ).map((row) => row.action);
    expect(actions).toEqual(['issue.create', 'issue.create.existing']);
  });

  it('creates a cluster issue for an operator and answers NOT_CONFIGURED without a tracker', async () => {
    const { projectId, call } = await routes();
    stubHttp([]);
    const response = await call(
      'POST',
      '/api/v1/dashboard/failure-clusters/issue',
      'amt_operator',
      {
        ...CLUSTER,
        projectId,
      },
    );
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      ErrorCode.NOT_CONFIGURED,
    );
    expect(
      (
        await call('POST', '/api/v1/dashboard/failure-clusters/issue', 'amt_viewer', {
          ...CLUSTER,
          projectId,
        })
      ).status,
    ).toBe(403);
  });
});
