import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, or, sql } from 'drizzle-orm';
import {
  deliverySources,
  deliverySyncs,
  deployments,
  incidents,
  projects,
  pullRequests,
  type DeliverySourceRow,
  type DeploymentRow,
  type IncidentRow,
  type PullRequestRow,
} from '@automate/db';
import {
  computeDora,
  computeFlow,
  doraScorecard,
  firstProductionCarriers,
  productionMatcher,
  flowScorecard,
  type DoraChange,
  type DoraDeployment,
  type DoraIncident,
  type DoraPolicy,
  type FlowPullRequest,
  type ProductionCarrier,
} from '@automate/reporting';
import {
  DeliveryMarkersSchema,
  DeliveryStreamSchema,
  type DeliveryMarkers,
  type DeliveryPolicy,
  type DeliveryPushResult,
  type DeliveryReport,
  type DeliverySource,
  type DeliverySourceBody,
  type DeliverySyncQueued,
  type DeliverySyncSummary,
  type DimensionMetric,
  type PortfolioDelivery,
  type PushDeploymentBody,
  type PushIncidentBody,
  type Scorecard,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';
import { DomainError, ErrorCode } from '../errors/domain-error.js';
import { projectRow, type HealthStoreOptions, type ProjectRow } from './health-findings.js';
import { githubRepository } from './health-integrations.js';
import { healthPolicyOf, type DeliveryReading } from './repo-health-service.js';

/**
 * Delivery performance: the source a project syncs from, the push door, and the DORA and
 * flow scorecards computed from what both wrote.
 *
 * ## Two doors, one set of numbers
 *
 * Deployments arrive from the GitHub sync (`source = 'github'`) and from CI through the push
 * door (`source = 'push'`). Each door is idempotent on its own external id. A team that has
 * both will report most deployments twice, so the two are collapsed **when the metrics are
 * computed**, by {@link dedupeDeployments}: a pushed deployment of the same commit to the same
 * environment within {@link DEDUPE_WINDOW_MS} of a GitHub one is the same deployment, and the
 * GitHub row — whose outcome GitHub itself reported — is the one kept. Doing it on read means
 * the answer does not depend on which door was first, and nothing written is ever discarded.
 *
 * ## What a deployment carried
 *
 * A GitHub deployment names one commit. DORA's lead time needs every change a deployment
 * shipped, so a deployment with no explicit `shas` is credited with the merge commits of the
 * pull requests merged into the default branch after the previous successful production
 * deployment and no later than it ({@link attributeDeployments}). That is an approximation by
 * merge time, stated as one; CI that knows the exact list pushes it as `shas` and is used as is.
 *
 * ## Rollbacks and hotfixes
 *
 * A deployment is a rollback (hotfix) when CI said so, or when a pull request it carried has a
 * rollback (hotfix) label or a head branch with a rollback (hotfix) prefix — the source's
 * `markers`, `revert-` / `hotfix/` and the `rollback` / `revert` / `hotfix` labels by default.
 *
 * ## Nobody is named
 *
 * Every read here is a repository aggregate. A pull request's author is stored by the sync for
 * attribution (`ai-code-attribution.ts`) and never selected by anything in this file.
 */
export type DeliveryOptions = HealthStoreOptions & { now?: () => Date };

/** A pushed and a GitHub deployment this close together, of one commit to one place, are one. */
export const DEDUPE_WINDOW_MS = 10 * 60_000;
/** Rows a delivery read loads per table. A bound, not a sample: far above a 90-day window. */
export const DELIVERY_READ_LIMIT = 5000;
const DAY_MS = 86_400_000;

const StreamsSchema = z.record(z.string(), DeliveryStreamSchema);
const StringListSchema = z.array(z.string());

function markersOf(raw: unknown): DeliveryMarkers {
  const parsed = DeliveryMarkersSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : DeliveryMarkersSchema.parse({});
}

function stringList(raw: unknown, fallback: string[]): string[] {
  const parsed = StringListSchema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

const iso = (value: Date | null) => (value === null ? null : value.toISOString());

async function sourceRowOf(
  options: DeliveryOptions,
  projectId: string,
): Promise<DeliverySourceRow | null> {
  const rows = await options.db
    .select()
    .from(deliverySources)
    .where(
      and(
        eq(deliverySources.workspaceId, options.workspaceId),
        eq(deliverySources.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

function sourceRecord(project: ProjectRow, row: DeliverySourceRow | null): DeliverySource {
  const streams = StreamsSchema.safeParse(row?.cursors ?? {});
  return {
    projectId: project.id,
    provider: 'github',
    configured: row !== null,
    enabled: row?.enabled ?? false,
    cadence: (row?.cadence ?? 'daily') as DeliverySource['cadence'],
    productionEnvironments: stringList(row?.productionEnvironments, ['production']),
    markers: markersOf(row?.markers),
    deployWorkflows: stringList(row?.deployWorkflows, []),
    repository: githubRepository(project.repositoryUrl),
    lastSyncedAt: iso(row?.lastSyncedAt ?? null),
    lastStatus: (row?.lastStatus ?? null) as DeliverySource['lastStatus'],
    lastError: row?.lastError ?? null,
    rateLimitedUntil: iso(row?.rateLimitedUntil ?? null),
    nextSyncAt: row === null || !row.enabled ? null : row.nextSyncAt.toISOString(),
    streams: streams.success ? streams.data : {},
  };
}

/** `GET …/delivery/source`: the saved source, or the defaults when none was saved. */
export async function getDeliverySource(
  options: DeliveryOptions,
  projectId: string,
): Promise<DeliverySource> {
  const project = await projectRow(options, projectId);
  return sourceRecord(project, await sourceRowOf(options, project.id));
}

/**
 * `PUT …/delivery/source`. Enabling a source makes it due at once, so the worker's next poll
 * queues its first sync rather than waiting for the cadence to come round.
 */
export async function setDeliverySource(
  options: DeliveryOptions,
  projectId: string,
  body: DeliverySourceBody,
): Promise<DeliverySource> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const values = {
    enabled: body.enabled,
    cadence: body.cadence,
    productionEnvironments: body.productionEnvironments,
    markers: DeliveryMarkersSchema.parse(body.markers ?? {}),
    deployWorkflows: body.deployWorkflows,
    updatedAt: now,
  };
  await options.db
    .insert(deliverySources)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      ...values,
      nextSyncAt: now,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: [deliverySources.workspaceId, deliverySources.projectId],
      set: {
        ...values,
        // Turning a source on is "sync now"; editing an enabled one keeps its schedule.
        nextSyncAt: sql`CASE WHEN ${deliverySources.enabled} THEN ${deliverySources.nextSyncAt} ELSE ${now.toISOString()}::timestamptz END`,
      },
    });
  return sourceRecord(project, await sourceRowOf(options, project.id));
}

/** The source row, created disabled with defaults when the project has none. */
async function ensureSource(
  options: DeliveryOptions,
  project: ProjectRow,
): Promise<DeliverySourceRow> {
  await options.db
    .insert(deliverySources)
    .values({ workspaceId: options.workspaceId, projectId: project.id })
    .onConflictDoNothing({ target: [deliverySources.workspaceId, deliverySources.projectId] });
  return (await sourceRowOf(options, project.id)) as DeliverySourceRow;
}

/**
 * Queues one sync of a project's source and returns it.
 *
 * A sync of the same source that is still `queued` absorbs the request — ten webhooks in a
 * second are one sync, not ten — and the new row's idempotency key is the requester plus a
 * fresh id otherwise. The scheduled key, `delivery:<sourceId>:<slot>`, is the worker's.
 */
export async function queueDeliverySync(
  options: DeliveryOptions,
  source: Pick<DeliverySourceRow, 'id' | 'projectId'>,
  requestedBy: 'operator' | 'webhook',
): Promise<DeliverySyncQueued> {
  // One queued sync per source is a unique index, not a check-then-insert: of two racing
  // requests, the second inserts nothing and is answered with the first one's sync. That one
  // may be claimed between the two statements, so the pair is tried twice.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const [row] = await options.db
      .insert(deliverySyncs)
      .values({
        workspaceId: options.workspaceId,
        projectId: source.projectId,
        sourceId: source.id,
        requestedBy,
        idempotencyKey: `delivery:${source.id}:${requestedBy}:${randomUUID()}`,
        nextAttemptAt: options.now?.() ?? new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: deliverySyncs.id });
    if (row !== undefined) return { syncId: row.id, duplicate: false, requestedBy };
    const [waiting] = await options.db
      .select({ id: deliverySyncs.id })
      .from(deliverySyncs)
      .where(
        and(
          eq(deliverySyncs.workspaceId, options.workspaceId),
          eq(deliverySyncs.sourceId, source.id),
          eq(deliverySyncs.status, 'queued'),
        ),
      )
      .limit(1);
    if (waiting !== undefined) return { syncId: waiting.id, duplicate: true, requestedBy };
  }
  throw new DomainError(ErrorCode.CONFLICT, 'The sync queue changed while queueing; try again');
}

/** `POST …/delivery/sync`: an operator's sync now, whether or not the schedule is on. */
export async function requestDeliverySync(
  options: DeliveryOptions,
  projectId: string,
): Promise<DeliverySyncQueued> {
  const project = await projectRow(options, projectId);
  return queueDeliverySync(options, await ensureSource(options, project), 'operator');
}

/** The enabled sources of the projects whose GitHub repository is `fullName`. */
export async function enabledSourcesForRepository(
  options: DeliveryOptions,
  fullName: string,
): Promise<DeliverySourceRow[]> {
  const wanted = fullName.toLowerCase();
  const rows = await options.db
    .select({ source: deliverySources, repositoryUrl: projects.repositoryUrl })
    .from(deliverySources)
    .innerJoin(
      projects,
      and(
        eq(projects.id, deliverySources.projectId),
        eq(projects.workspaceId, deliverySources.workspaceId),
      ),
    )
    .where(
      and(eq(deliverySources.workspaceId, options.workspaceId), eq(deliverySources.enabled, true)),
    );
  return rows
    .filter((row) => {
      const repository = githubRepository(row.repositoryUrl);
      return (
        repository !== null && `${repository.owner}/${repository.repo}`.toLowerCase() === wanted
      );
    })
    .map((row) => row.source);
}

// ─── The push door ──────────────────────────────────────────────────────────

const inserted = sql<boolean>`(xmax = 0)`;

/** `POST …/delivery/deployments`: one deployment, replaced when its external id repeats. */
export async function pushDeployment(
  options: DeliveryOptions,
  projectId: string,
  body: PushDeploymentBody,
): Promise<DeliveryPushResult> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const values = {
    environment: body.environment,
    status: body.status,
    createdAt: new Date(body.createdAt),
    sha: body.sha ?? null,
    shas: body.shas ?? [],
    rollback: body.rollback ?? false,
    hotfix: body.hotfix ?? false,
    unplanned: body.unplanned ?? false,
    url: body.url ?? null,
    receivedAt: now,
  };
  const [row] = await options.db
    .insert(deployments)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      source: 'push',
      externalId: body.externalId,
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
    })
    .returning({ id: deployments.id, created: inserted });
  return { id: (row as { id: string }).id, created: (row as { created: boolean }).created };
}

/** `POST …/delivery/incidents`: one incident, replaced when its source and id repeat. */
export async function pushIncident(
  options: DeliveryOptions,
  projectId: string,
  body: PushIncidentBody,
): Promise<DeliveryPushResult> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const values = {
    openedAt: new Date(body.openedAt),
    resolvedAt:
      body.resolvedAt === undefined || body.resolvedAt === null ? null : new Date(body.resolvedAt),
    severity: body.severity ?? null,
    deploymentExternalId: body.deploymentId ?? null,
    sha: body.sha ?? null,
    title: body.title,
    receivedAt: now,
  };
  const [row] = await options.db
    .insert(incidents)
    .values({
      workspaceId: options.workspaceId,
      projectId: project.id,
      source: body.source,
      externalId: body.externalId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [incidents.workspaceId, incidents.projectId, incidents.source, incidents.externalId],
      set: values,
    })
    .returning({ id: incidents.id, created: inserted });
  return { id: (row as { id: string }).id, created: (row as { created: boolean }).created };
}

// ─── The computation ────────────────────────────────────────────────────────

/**
 * Pushed deployments that GitHub also reported, removed; and, for each removed row, the row
 * that stands for it, so an incident naming the pushed id still finds its deployment.
 */
export function dedupeDeployments(rows: readonly DeploymentRow[]): {
  kept: DeploymentRow[];
  replacedBy: Map<string, DeploymentRow>;
} {
  const github = rows.filter((row) => row.source === 'github' && row.sha !== null);
  const replacedBy = new Map<string, DeploymentRow>();
  const kept = rows.filter((row) => {
    if (row.source !== 'push' || row.sha === null) return true;
    const twin = github.find(
      (candidate) =>
        candidate.sha === row.sha &&
        candidate.environment.toLowerCase() === row.environment.toLowerCase() &&
        Math.abs(candidate.createdAt.getTime() - row.createdAt.getTime()) <= DEDUPE_WINDOW_MS,
    );
    if (twin === undefined) return true;
    replacedBy.set(row.externalId, twin);
    return false;
  });
  return { kept, replacedBy };
}

const lower = (values: readonly string[]) => values.map((value) => value.toLowerCase());

/** Whether a pull request is a rollback or a hotfix by the source's markers. */
export function remediationOf(
  pr: Pick<PullRequestRow, 'labels' | 'headBranch'>,
  markers: DeliveryMarkers,
): { rollback: boolean; hotfix: boolean } {
  const labels = new Set(lower(stringList(pr.labels, [])));
  const branch = (pr.headBranch ?? '').toLowerCase();
  const matches = (wanted: readonly string[], prefixes: readonly string[]) =>
    lower(wanted).some((label) => labels.has(label)) ||
    lower(prefixes).some((prefix) => branch.startsWith(prefix));
  return {
    rollback: matches(markers.rollbackLabels, markers.rollbackBranchPrefixes),
    hotfix: matches(markers.hotfixLabels, markers.hotfixBranchPrefixes),
  };
}

/**
 * Each deployment as DORA reads it: the commits it carried and whether it remediated.
 *
 * A deployment with explicit `shas` keeps them. Otherwise it carries its own commit plus the
 * merge commits of pull requests merged into `baseBranch` after the previous successful
 * production deployment and no later than this one.
 */
export function attributeDeployments(
  rows: readonly DeploymentRow[],
  merged: readonly PullRequestRow[],
  context: { production: readonly string[]; baseBranch: string; markers: DeliveryMarkers },
): DoraDeployment[] {
  const isProductionEnvironment = productionMatcher(context.production);
  const intoBase = merged
    .filter(
      (pr) =>
        pr.mergedAt !== null && pr.mergeCommitSha !== null && pr.baseBranch === context.baseBranch,
    )
    .sort((left, right) => (left.mergedAt as Date).getTime() - (right.mergedAt as Date).getTime());
  const bySha = new Map(
    merged.flatMap((pr) => (pr.mergeCommitSha === null ? [] : [[pr.mergeCommitSha, pr]])),
  );
  const ordered = [...rows].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  let previous = Number.NEGATIVE_INFINITY;
  return ordered.map((row) => {
    const at = row.createdAt.getTime();
    const isProduction = isProductionEnvironment(row.environment);
    const explicit = stringList(row.shas, []);
    const shas =
      explicit.length > 0 || !isProduction
        ? explicit
        : intoBase
            .filter((pr) => {
              const mergedAt = (pr.mergedAt as Date).getTime();
              return mergedAt > previous && mergedAt <= at;
            })
            .map((pr) => pr.mergeCommitSha as string);
    if (isProduction && row.status === 'success') previous = at;
    const carried = [...shas, ...(row.sha === null ? [] : [row.sha])]
      .map((sha) => bySha.get(sha))
      .filter((pr): pr is PullRequestRow => pr !== undefined)
      .map((pr) => remediationOf(pr, context.markers));
    return {
      id: row.id,
      environment: row.environment,
      status: row.status as DoraDeployment['status'],
      createdAt: row.createdAt.toISOString(),
      sha: row.sha,
      shas,
      rollback: row.rollback || carried.some((entry) => entry.rollback),
      hotfix: row.hotfix || carried.some((entry) => entry.hotfix),
      unplanned: row.unplanned,
    };
  });
}

/** Each incident linked to the deployment its id or commit names, or to none. */
export function linkIncidents(
  rows: readonly IncidentRow[],
  kept: readonly DeploymentRow[],
  replacedBy: ReadonlyMap<string, DeploymentRow>,
  production: readonly string[],
): DoraIncident[] {
  const isProduction = productionMatcher(production);
  return rows.map((incident) => {
    const byId =
      incident.deploymentExternalId === null
        ? undefined
        : (replacedBy.get(incident.deploymentExternalId) ??
          kept.find((row) => row.externalId === incident.deploymentExternalId));
    const bySha =
      incident.sha === null
        ? undefined
        : kept
            .filter(
              (row) =>
                isProduction(row.environment) &&
                (row.sha === incident.sha ||
                  stringList(row.shas, []).includes(incident.sha as string)) &&
                row.createdAt.getTime() <= incident.openedAt.getTime(),
            )
            .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    return {
      id: incident.id,
      openedAt: incident.openedAt.toISOString(),
      resolvedAt: iso(incident.resolvedAt),
      deploymentId: (byId ?? bySha)?.id ?? null,
    };
  });
}

export interface DeliveryInputs {
  project: Pick<ProjectRow, 'id' | 'defaultBranch'>;
  deployments: readonly DeploymentRow[];
  pullRequests: readonly PullRequestRow[];
  incidents: readonly IncidentRow[];
  production: readonly string[];
  markers: DeliveryMarkers;
  policy: DeliveryPolicy;
  now: Date;
  windowDays: number;
}

function doraPolicyOf(policy: DeliveryPolicy): DoraPolicy {
  const limits: DoraPolicy = {};
  if (policy.maxChangeFailureRate !== undefined) {
    limits.maxChangeFailureRate = policy.maxChangeFailureRate;
  }
  if (policy.maxLeadTimeHours !== undefined) limits.maxLeadTimeHours = policy.maxLeadTimeHours;
  if (policy.minDeploysPerWeek !== undefined) limits.minDeploysPerWeek = policy.minDeploysPerWeek;
  if (policy.maxRecoveryHours !== undefined) limits.maxRecoveryHours = policy.maxRecoveryHours;
  return limits;
}

/** The two scorecards and the results under them, from rows already read. Pure. */
export function computeDelivery(inputs: DeliveryInputs) {
  const { kept, replacedBy } = dedupeDeployments(inputs.deployments);
  const baseBranch = inputs.project.defaultBranch ?? 'main';
  const doraDeployments = attributeDeployments(kept, inputs.pullRequests, {
    production: inputs.production,
    baseBranch,
    markers: inputs.markers,
  });
  const changes: DoraChange[] = inputs.pullRequests.flatMap((pr) =>
    pr.mergeCommitSha === null || pr.mergedAt === null
      ? []
      : [
          {
            sha: pr.mergeCommitSha,
            firstCommitAt: (pr.firstCommitAt ?? pr.openedAt).toISOString(),
            mergedAt: pr.mergedAt.toISOString(),
          },
        ],
  );
  const doraResult = computeDora({
    deployments: doraDeployments,
    changes,
    incidents: linkIncidents(inputs.incidents, kept, replacedBy, inputs.production),
    productionEnvironments: inputs.production,
    now: inputs.now,
    windowDays: inputs.windowDays,
  });
  const dora = doraScorecard(doraResult, {
    now: inputs.now,
    windowDays: inputs.windowDays,
    policy: doraPolicyOf(inputs.policy),
  });

  // When each merge commit first reached production, for the flow's deploy phase.
  const isProduction = productionMatcher(inputs.production);
  const deployedAt = new Map<string, string>();
  for (const deployment of [...doraDeployments].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  )) {
    if (deployment.status !== 'success' || !isProduction(deployment.environment)) {
      continue;
    }
    for (const sha of [
      ...(deployment.shas ?? []),
      ...(deployment.sha === null ? [] : [deployment.sha]),
    ]) {
      if (!deployedAt.has(sha)) deployedAt.set(sha, deployment.createdAt);
    }
  }
  const flowInput: FlowPullRequest[] = inputs.pullRequests.map((pr) => ({
    number: pr.number,
    state: pr.state as FlowPullRequest['state'],
    draft: pr.draft,
    createdAt: pr.openedAt.toISOString(),
    firstCommitAt: iso(pr.firstCommitAt),
    firstReviewAt: iso(pr.firstReviewAt),
    approvedAt: iso(pr.approvedAt),
    mergedAt: iso(pr.mergedAt),
    closedAt: iso(pr.closedAt),
    deployedAt: pr.mergeCommitSha === null ? null : (deployedAt.get(pr.mergeCommitSha) ?? null),
    lastActivityAt: pr.lastActivityAt.toISOString(),
    additions: pr.additions,
    deletions: pr.deletions,
    reviewCount: pr.reviewCount,
    approvals: pr.approvalCount,
  }));
  const flowResult = computeFlow(flowInput, {
    now: inputs.now,
    windowDays: inputs.windowDays,
    staleAfterDays: inputs.policy.staleAfterDays ?? 7,
  });
  const flow = flowScorecard(flowResult, { now: inputs.now, windowDays: inputs.windowDays });
  const titles = new Map(inputs.pullRequests.map((pr) => [pr.number, pr.title]));
  return {
    dora,
    flow,
    doraResult,
    flowResult,
    stalePullRequests: flowResult.stale.map((entry) => ({
      number: entry.number,
      title: titles.get(entry.number) ?? '',
      daysIdle: entry.daysIdle,
    })),
    counts: {
      deployments: kept.length,
      pullRequests: inputs.pullRequests.length,
      incidents: inputs.incidents.length,
    },
  };
}

/**
 * For each merge commit, the first production deployment that carried it and DORA's verdict on
 * that deployment — through the same dedupe, attribution and incident linking the DORA
 * scorecard reads, and `firstProductionCarriers`' failure rule, so a pull request's "caused a
 * failure" and the change-failure rate cannot disagree. Pure.
 */
export function productionCarriersOf(inputs: DeliveryInputs): Map<string, ProductionCarrier> {
  const { kept, replacedBy } = dedupeDeployments(inputs.deployments);
  return firstProductionCarriers({
    deployments: attributeDeployments(kept, inputs.pullRequests, {
      production: inputs.production,
      baseBranch: inputs.project.defaultBranch ?? 'main',
      markers: inputs.markers,
    }),
    incidents: linkIncidents(inputs.incidents, kept, replacedBy, inputs.production),
    productionEnvironments: inputs.production,
  });
}

/** Production environments: the versioned policy's, else the source's, else `production`. */
export function productionEnvironmentsOf(
  policy: DeliveryPolicy,
  source: Pick<DeliverySourceRow, 'productionEnvironments'> | null,
): string[] {
  return (
    policy.productionEnvironments ?? stringList(source?.productionEnvironments, ['production'])
  );
}

/** The rows a delivery read computes over: two windows back, every table bounded. */
export async function loadInputs(
  options: DeliveryOptions,
  project: ProjectRow,
  windowDays: number,
  now: Date,
): Promise<{ inputs: DeliveryInputs; source: DeliverySourceRow | null }> {
  // Two windows: the metrics compare this one with the one before it.
  const since = new Date(now.getTime() - 2 * windowDays * DAY_MS);
  const scope = <T extends typeof deployments | typeof incidents | typeof pullRequests>(table: T) =>
    and(eq(table.workspaceId, options.workspaceId), eq(table.projectId, project.id));
  const [source, deploymentRows, prRows, incidentRows] = await Promise.all([
    sourceRowOf(options, project.id),
    options.db
      .select()
      .from(deployments)
      .where(and(scope(deployments), gte(deployments.createdAt, since)))
      .orderBy(desc(deployments.createdAt))
      .limit(DELIVERY_READ_LIMIT),
    options.db
      .select()
      .from(pullRequests)
      .where(
        and(
          scope(pullRequests),
          or(gte(pullRequests.lastActivityAt, since), eq(pullRequests.state, 'open')),
        ),
      )
      .orderBy(desc(pullRequests.lastActivityAt))
      .limit(DELIVERY_READ_LIMIT),
    options.db
      .select()
      .from(incidents)
      .where(and(scope(incidents), gte(incidents.openedAt, since)))
      .orderBy(desc(incidents.openedAt))
      .limit(DELIVERY_READ_LIMIT),
  ]);
  const policy = healthPolicyOf(project)?.delivery ?? {};
  return {
    source,
    inputs: {
      project,
      deployments: deploymentRows,
      pullRequests: prRows,
      incidents: incidentRows,
      production: productionEnvironmentsOf(policy, source),
      markers: markersOf(source?.markers),
      policy,
      now,
      windowDays,
    },
  };
}

async function syncSummary(
  options: DeliveryOptions,
  source: DeliverySourceRow | null,
): Promise<DeliverySyncSummary> {
  const latest =
    source === null
      ? []
      : await options.db
          .select()
          .from(deliverySyncs)
          .where(
            and(
              eq(deliverySyncs.workspaceId, options.workspaceId),
              eq(deliverySyncs.sourceId, source.id),
            ),
          )
          .orderBy(desc(deliverySyncs.createdAt))
          .limit(1);
  const sync = latest[0];
  return {
    configured: source !== null,
    enabled: source?.enabled ?? false,
    lastSyncedAt: iso(source?.lastSyncedAt ?? null),
    lastStatus: (source?.lastStatus ?? null) as DeliverySyncSummary['lastStatus'],
    lastError: source?.lastError ?? null,
    rateLimitedUntil: iso(source?.rateLimitedUntil ?? null),
    latest:
      sync === undefined
        ? null
        : {
            id: sync.id,
            status: sync.status as 'queued',
            requestedBy: sync.requestedBy as 'schedule',
            errorCode: sync.errorCode,
            createdAt: sync.createdAt.toISOString(),
            finishedAt: iso(sync.finishedAt),
          },
  };
}

/** `GET …/delivery?days=`: both scorecards, their results, the stale list, the sync state. */
export async function deliveryReport(
  options: DeliveryOptions,
  projectId: string,
  windowDays: number,
): Promise<DeliveryReport> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const { inputs, source } = await loadInputs(options, project, windowDays, now);
  const computed = computeDelivery(inputs);
  return {
    projectId: project.id,
    windowDays,
    evaluatedAt: now.toISOString(),
    productionEnvironments: inputs.production,
    ...computed,
    sync: await syncSummary(options, source),
  };
}

const PORTFOLIO_LIMIT = 200;

/** `GET /api/v1/portfolio/delivery?days=`: every project's DORA tiers and both scores. */
export async function portfolioDelivery(
  options: DeliveryOptions,
  windowDays: number,
): Promise<PortfolioDelivery> {
  const now = options.now?.() ?? new Date();
  const ids = await options.db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.workspaceId, options.workspaceId))
    .orderBy(projects.name)
    .limit(PORTFOLIO_LIMIT);
  const entries: PortfolioDelivery['projects'][number][] = [];
  for (const { id } of ids) {
    const project = await projectRow(options, id);
    const { dora, flow } = computeDelivery(
      (await loadInputs(options, project, windowDays, now)).inputs,
    );
    const band = (key: string) =>
      (dora.metrics.find((metric) => metric.key === key)?.band ?? null) as
        'elite' | 'high' | 'medium' | 'low' | null;
    entries.push({
      projectId: project.id,
      name: project.name,
      slug: project.slug,
      dora: {
        status: dora.status,
        score: dora.score,
        cappedBy: dora.cappedBy,
        tiers: {
          deploymentFrequency: band('deployment-frequency'),
          changeLeadTime: band('change-lead-time'),
          changeFailureRate: band('change-failure-rate'),
          recoveryTime: band('failed-deployment-recovery-time'),
        },
      },
      flow: { status: flow.status, score: flow.score },
    });
  }
  return { windowDays, evaluatedAt: now.toISOString(), projects: entries };
}

/** The window the grade and the gate read delivery over. */
export const DELIVERY_GRADE_WINDOW_DAYS = 30;

/** The DORA scorecard as the `delivery` dimension's metric, and as the gate reads it. */
export async function deliveryReading(
  options: DeliveryOptions,
  projectId: string,
): Promise<DeliveryReading> {
  const project = await projectRow(options, projectId);
  const now = options.now?.() ?? new Date();
  const { inputs } = await loadInputs(options, project, DELIVERY_GRADE_WINDOW_DAYS, now);
  const { dora } = computeDelivery(inputs);
  return {
    metric: metricOf(dora),
    dora,
    gateOnDelivery: inputs.policy.gateOnDelivery === true,
  };
}

function metricOf(dora: Scorecard): DimensionMetric | null {
  if (dora.score === null) return null;
  return {
    dimension: 'delivery',
    metric: 'dora',
    tool: { name: 'automate-delivery', version: null },
    score: dora.score,
    summary: `DORA ${String(dora.score)} / 100 over ${String(dora.windowDays)} days, limited by ${String(dora.cappedBy)}`,
  };
}
