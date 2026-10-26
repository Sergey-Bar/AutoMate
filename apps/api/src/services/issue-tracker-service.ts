import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  healthFindings,
  issueLinks,
  issueTrackers,
  type IssueLinkRow,
  type IssueTrackerRow,
} from '@automate/db';
import type { ConnectorAdapter, ConnectorResult } from '@automate/connectors-sdk';
import type {
  ClusterIssueBody,
  IssueLink,
  IssueTarget,
  IssueTracker,
  IssueTrackerBody,
} from '@automate/shared-contracts';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { readGitToken } from './git-credential-service.js';
import { githubRepository } from './health-integrations.js';
import { projectRow, type ProjectRow } from './health-findings.js';
import {
  deleteVaultSecret,
  hasVaultSecret,
  readVaultSecret,
  storeVaultSecret,
  type VaultOptions,
} from './vault-secrets.js';

/**
 * Issues from findings and failure clusters, created in Jira or GitHub through the vault.
 *
 * ## One project, one tracker, one token in the vault
 *
 * A project's Jira configuration is an `issue_trackers` row — base URL, project key, issue
 * type — and its token is the vault entry `tracker:<projectId>:jira`, never a column and never
 * in a response. GitHub needs no configuration: a project whose repository is on github.com
 * creates issues there with its own git token (`git:<projectId>`).
 *
 * ## Idempotent, by a claim row
 *
 * `issue_links` has one row per (project, source, target), unique. The row is written
 * `pending` **before** the tracker is called, so of two concurrent calls only one gets to
 * call it; the other is told one is being created. A successful create stamps the row
 * `created` with the key and URL, and every later call returns that issue without calling
 * the tracker. A failed create removes the claim, so the call can be made again.
 *
 * A create is not retried here or in the adapter after an ambiguous failure (a 5xx, no
 * answer at all), because `createIssue` is declared non-idempotent and repeating it could
 * open a second issue; a refusal (4xx, rate limit) is safe to repeat and the adapter does.
 * The caller is told which it was by `retryable` in the error's details.
 */
export type IssueTrackerOptions = VaultOptions & { now?: () => Date };

export interface IssueAdapters {
  jira?: ConnectorAdapter | undefined;
  github?: ConnectorAdapter | undefined;
  /** The dashboard page an issue links back to. */
  detailsUrl?: ((projectId: string) => string) | undefined;
}

/** A `pending` claim older than this is a create that died mid-call, and may be taken over. */
export const STALE_CLAIM_MS = 10 * 60_000;

const WHAT = 'An issue tracker token';
const UUID = /^[0-9a-f-]{36}$/iu;
const SUMMARY_MAX = 250;
const DESCRIPTION_MAX = 30_000;

const trackerSecretName = (projectId: string, kind: string): string =>
  `tracker:${projectId}:${kind}`;

function clock(options: IssueTrackerOptions): Date {
  return options.now?.() ?? new Date();
}

function notConfigured(message: string): DomainError {
  return new DomainError(ErrorCode.NOT_CONFIGURED, message, { callerSafe: true });
}

function trackerSummary(row: IssueTrackerRow, hasCredential: boolean): IssueTracker {
  return {
    projectId: row.projectId,
    kind: row.kind as IssueTracker['kind'],
    baseUrl: row.baseUrl,
    projectKey: row.projectKey,
    issueType: row.issueType,
    hasCredential,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function trackerRow(
  options: IssueTrackerOptions,
  projectId: string,
): Promise<IssueTrackerRow | undefined> {
  const [row] = await options.db
    .select()
    .from(issueTrackers)
    .where(
      and(
        eq(issueTrackers.workspaceId, options.workspaceId),
        eq(issueTrackers.projectId, projectId),
        eq(issueTrackers.kind, 'jira'),
      ),
    )
    .limit(1);
  return row;
}

/** The project's tracker, without its token; `null` when none is configured. */
export async function getIssueTracker(
  options: IssueTrackerOptions,
  projectId: string,
): Promise<IssueTracker | null> {
  const project = await projectRow(options, projectId);
  const row = await trackerRow(options, project.id);
  if (row === undefined) return null;
  return trackerSummary(
    row,
    await hasVaultSecret(options, trackerSecretName(project.id, row.kind)),
  );
}

/**
 * Saves the project's tracker. The token is sealed first, so a vault that is not configured
 * refuses the whole change and no tracker without a credential is left behind.
 */
export async function setIssueTracker(
  options: IssueTrackerOptions,
  projectId: string,
  body: IssueTrackerBody,
  actor: string,
): Promise<{ tracker: IssueTracker; created: boolean; tokenChanged: boolean }> {
  const project = await projectRow(options, projectId);
  const existing = await trackerRow(options, project.id);
  const name = trackerSecretName(project.id, body.kind);
  const baseUrl = body.baseUrl.replace(/\/+$/u, '');
  if (body.token === undefined && !(await hasVaultSecret(options, name))) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      'A token is required the first time a tracker is configured',
    );
  }
  // The stored token was given for one host. Pointing the tracker at another origin without
  // a new one would send it there: holding the admin role is not holding the credential.
  if (
    body.token === undefined &&
    existing !== undefined &&
    new URL(existing.baseUrl).origin !== new URL(baseUrl).origin
  ) {
    throw new DomainError(
      ErrorCode.INVALID_REQUEST_BODY,
      `The base URL moves the tracker from ${new URL(existing.baseUrl).origin} to ${new URL(baseUrl).origin}; send a new token for it — the stored one is never sent to another host`,
    );
  }
  if (body.token !== undefined) {
    await storeVaultSecret({ ...options, actor }, name, body.token, WHAT);
  }
  const now = clock(options);
  const values = {
    baseUrl,
    projectKey: body.projectKey,
    issueType: body.issueType,
    updatedBy: actor,
    updatedAt: now,
  };
  const [row] = await options.db
    .insert(issueTrackers)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      kind: body.kind,
      createdAt: now,
      ...values,
    })
    .onConflictDoUpdate({
      target: [issueTrackers.workspaceId, issueTrackers.projectId, issueTrackers.kind],
      set: values,
    })
    .returning();
  return {
    tracker: trackerSummary(row as IssueTrackerRow, true),
    created: existing === undefined,
    tokenChanged: body.token !== undefined,
  };
}

/** Removes the project's tracker and its token. Issue links already created are kept. */
export async function deleteIssueTracker(
  options: IssueTrackerOptions,
  projectId: string,
  actor: string,
): Promise<boolean> {
  const project = await projectRow(options, projectId);
  const removed = await options.db
    .delete(issueTrackers)
    .where(
      and(
        eq(issueTrackers.workspaceId, options.workspaceId),
        eq(issueTrackers.projectId, project.id),
      ),
    )
    .returning({ kind: issueTrackers.kind });
  await deleteVaultSecret({ ...options, actor }, trackerSecretName(project.id, 'jira'));
  return removed.length > 0;
}

// ─── Creating an issue ────────────────────────────────────────────────────────

interface IssueDraft {
  summary: string;
  description: string;
}

interface IssueSource {
  projectId: string;
  sourceKind: 'finding' | 'cluster';
  sourceKey: string;
}

/** A tracker call, ready to make: the adapter, its request, its token, and how to read it. */
interface PreparedTarget {
  adapter: ConnectorAdapter;
  token: string;
  input: Record<string, unknown>;
  read: (data: unknown) => { key: string; url: string } | null;
}

function clip(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function prepareJira(
  options: IssueTrackerOptions,
  adapters: IssueAdapters,
  project: ProjectRow,
  draft: IssueDraft,
): Promise<PreparedTarget> {
  const tracker = await trackerRow(options, project.id);
  if (tracker === undefined) {
    throw notConfigured('This project has no Jira tracker configured');
  }
  const token = await readVaultSecret(options, trackerSecretName(project.id, tracker.kind), WHAT);
  if (token === null) throw notConfigured("This project's Jira tracker has no token");
  if (adapters.jira === undefined) throw notConfigured('No Jira connector is composed');
  return {
    adapter: adapters.jira,
    token,
    input: {
      baseUrl: tracker.baseUrl,
      projectKey: tracker.projectKey,
      issueType: tracker.issueType,
      summary: draft.summary,
      description: draft.description,
    },
    read: (data) => {
      const key = record(data)['key'];
      return typeof key === 'string' && key !== ''
        ? { key, url: `${tracker.baseUrl}/browse/${encodeURIComponent(key)}` }
        : null;
    },
  };
}

async function prepareGitHub(
  options: IssueTrackerOptions,
  adapters: IssueAdapters,
  project: ProjectRow,
  draft: IssueDraft,
): Promise<PreparedTarget> {
  const repository = githubRepository(project.repositoryUrl);
  if (repository === null) {
    throw notConfigured('This project is not a github.com repository');
  }
  const token = await readGitToken(options, project.id);
  if (token === null) throw notConfigured('This project has no GitHub token in the vault');
  if (adapters.github === undefined) throw notConfigured('No GitHub connector is composed');
  return {
    adapter: adapters.github,
    token,
    input: { ...repository, title: draft.summary, body: draft.description, labels: ['automate'] },
    read: (data) => {
      const fields = record(data);
      const number = fields['number'];
      const url = fields['html_url'];
      return typeof number === 'number' && typeof url === 'string'
        ? { key: `#${String(number)}`, url }
        : null;
    },
  };
}

function linkOf(row: IssueLinkRow, created: boolean): IssueLink {
  return {
    id: row.id,
    projectId: row.projectId,
    sourceKind: row.sourceKind as IssueLink['sourceKind'],
    sourceKey: row.sourceKey,
    target: row.target as IssueTarget,
    key: row.issueKey as string,
    url: row.issueUrl as string,
    created,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function linkScope(options: IssueTrackerOptions, source: IssueSource, target: IssueTarget) {
  return and(
    eq(issueLinks.workspaceId, options.workspaceId),
    eq(issueLinks.projectId, source.projectId),
    eq(issueLinks.sourceKind, source.sourceKind),
    eq(issueLinks.sourceKey, source.sourceKey),
    eq(issueLinks.target, target),
  );
}

async function existingLink(
  options: IssueTrackerOptions,
  source: IssueSource,
  target: IssueTarget,
): Promise<IssueLinkRow | undefined> {
  const [row] = await options.db
    .select()
    .from(issueLinks)
    .where(linkScope(options, source, target))
    .limit(1);
  return row;
}

function inProgress(): DomainError {
  return new DomainError(
    ErrorCode.CONFLICT,
    'An issue for this is being created by another request; ask again in a moment',
  );
}

/**
 * Writes the `pending` claim, or answers with what another call already did: the created
 * issue, or a conflict while it is still being created.
 */
async function claim(
  options: IssueTrackerOptions,
  source: IssueSource,
  target: IssueTarget,
  actor: string,
): Promise<{ claimed: IssueLinkRow } | { existing: IssueLinkRow }> {
  const now = clock(options);
  const prior = await existingLink(options, source, target);
  if (prior?.state === 'created') return { existing: prior };
  if (prior !== undefined) {
    if (now.getTime() - prior.updatedAt.getTime() < STALE_CLAIM_MS) throw inProgress();
    // A claim whose create died with it is taken over, not left to block the source forever —
    // by compare-and-swap on the stale row, so of two takers exactly one wins.
    const [taken] = await options.db
      .update(issueLinks)
      .set({ updatedAt: now, createdBy: actor })
      .where(
        and(
          linkScope(options, source, target),
          eq(issueLinks.id, prior.id),
          eq(issueLinks.state, 'pending'),
          eq(issueLinks.updatedAt, prior.updatedAt),
        ),
      )
      .returning();
    if (taken === undefined) throw inProgress();
    return { claimed: taken };
  }
  const [row] = await options.db
    .insert(issueLinks)
    .values({
      workspaceId: options.workspaceId,
      projectId: source.projectId,
      sourceKind: source.sourceKind,
      sourceKey: source.sourceKey,
      target,
      state: 'pending',
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();
  if (row !== undefined) return { claimed: row };
  const raced = await existingLink(options, source, target);
  if (raced?.state === 'created') return { existing: raced };
  throw inProgress();
}

function trackerFailure(target: IssueTarget, result: ConnectorResult): DomainError {
  return new DomainError(
    ErrorCode.DEPENDENCY_UNAVAILABLE,
    `${target === 'jira' ? 'Jira' : 'GitHub'} did not create the issue`,
    {
      callerSafe: true,
      details: {
        connectorCode: result.error?.code ?? 'unknown',
        retryable: result.error?.retryable ?? false,
        attempts: result.attempts,
      },
    },
  );
}

async function createLinkedIssue(
  options: IssueTrackerOptions,
  adapters: IssueAdapters,
  input: { project: ProjectRow; source: IssueSource; target: IssueTarget; draft: IssueDraft },
  actor: string,
): Promise<IssueLink> {
  const prior = await existingLink(options, input.source, input.target);
  if (prior?.state === 'created') return linkOf(prior, false);
  // Resolved before the claim, so a target that is not configured leaves nothing behind.
  const prepared =
    input.target === 'jira'
      ? await prepareJira(options, adapters, input.project, input.draft)
      : await prepareGitHub(options, adapters, input.project, input.draft);
  const claimed = await claim(options, input.source, input.target, actor);
  if ('existing' in claimed) return linkOf(claimed.existing, false);
  const release = () =>
    options.db
      .delete(issueLinks)
      .where(and(eq(issueLinks.id, claimed.claimed.id), eq(issueLinks.state, 'pending')));
  let result: ConnectorResult;
  try {
    result = await prepared.adapter.execute(
      { operation: 'createIssue', input: prepared.input },
      prepared.token,
    );
  } catch (error) {
    // An adapter that throws rather than answering leaves no claim to block the source.
    await release();
    throw error;
  }
  const issue = result.status === 'ok' ? prepared.read(result.data) : null;
  if (issue === null) {
    await release();
    throw trackerFailure(input.target, result);
  }
  const [row] = await options.db
    .update(issueLinks)
    .set({ state: 'created', issueKey: issue.key, issueUrl: issue.url, updatedAt: clock(options) })
    .where(eq(issueLinks.id, claimed.claimed.id))
    .returning();
  return linkOf(row as IssueLinkRow, true);
}

function linkBack(adapters: IssueAdapters, projectId: string): string[] {
  const url = adapters.detailsUrl?.(projectId);
  return url === undefined ? [] : ['', `Open in Automate: ${url}`];
}

/** An issue from one finding of the project. */
export async function createFindingIssue(
  options: IssueTrackerOptions,
  adapters: IssueAdapters,
  input: { projectId: string; findingId: string; target: IssueTarget },
  actor: string,
): Promise<IssueLink> {
  const project = await projectRow(options, input.projectId);
  const [finding] = UUID.test(input.findingId)
    ? await options.db
        .select()
        .from(healthFindings)
        .where(
          and(
            eq(healthFindings.workspaceId, options.workspaceId),
            eq(healthFindings.projectId, project.id),
            eq(healthFindings.id, input.findingId),
          ),
        )
        .limit(1)
    : [];
  if (finding === undefined) {
    throw new DomainError(ErrorCode.NOT_FOUND, `No finding ${input.findingId}`);
  }
  const at = finding.line === null ? '' : `:${String(finding.line)}`;
  const description = [
    finding.message,
    '',
    `Tool: ${finding.tool}`,
    `Rule: ${finding.ruleId}`,
    `Severity: ${finding.severity}`,
    `Location: ${finding.path === null ? 'none' : `${finding.path}${at}`}`,
    `Branch: ${finding.branch}`,
    `First seen: ${finding.firstSeenAt.toISOString()}`,
    ...(finding.helpUri === null ? [] : [`Reference: ${finding.helpUri}`]),
    `Finding: ${finding.id}`,
    ...linkBack(adapters, project.id),
  ].join('\n');
  return createLinkedIssue(
    options,
    adapters,
    {
      project,
      source: { projectId: project.id, sourceKind: 'finding', sourceKey: finding.id },
      target: input.target,
      draft: {
        summary: clip(`[${finding.severity}] ${finding.ruleId}: ${finding.message}`, SUMMARY_MAX),
        description: clip(description, DESCRIPTION_MAX),
      },
    },
    actor,
  );
}

/** The key a cluster's issue is filed under: its signature, hashed to a bounded width. */
export function clusterKey(signature: string): string {
  return createHash('sha256').update(signature).digest('hex');
}

/** An issue from one failure cluster, filed against the project the body names. */
export async function createClusterIssue(
  options: IssueTrackerOptions,
  adapters: IssueAdapters,
  body: ClusterIssueBody,
  actor: string,
): Promise<IssueLink> {
  const project = await projectRow(options, body.projectId);
  const firstLine = body.sampleMessage.split(/\r?\n/u)[0]?.trim() || body.signature;
  const tests = body.tests.slice(0, 20).map((test) => `- ${test}`);
  const more = body.tests.length > 20 ? [`…and ${String(body.tests.length - 20)} more`] : [];
  const description = [
    `${String(body.count)} failures across ${String(body.runs)} runs share one root cause.`,
    '',
    `Signature: ${body.signature}`,
    ...(body.errorType == null ? [] : [`Error type: ${body.errorType}`]),
    ...(body.branches.length === 0 ? [] : [`Branches: ${body.branches.join(', ')}`]),
    '',
    'Sample message:',
    body.sampleMessage,
    ...(tests.length === 0 ? [] : ['', 'Tests:', ...tests, ...more]),
    ...linkBack(adapters, project.id),
  ].join('\n');
  return createLinkedIssue(
    options,
    adapters,
    {
      project,
      source: {
        projectId: project.id,
        sourceKind: 'cluster',
        sourceKey: clusterKey(body.signature),
      },
      target: body.target,
      draft: {
        summary: clip(`Failing tests: ${body.errorType ?? 'failure'} — ${firstLine}`, SUMMARY_MAX),
        description: clip(description, DESCRIPTION_MAX),
      },
    },
    actor,
  );
}
