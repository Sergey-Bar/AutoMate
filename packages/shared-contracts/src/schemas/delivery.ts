import { z } from 'zod/v4';
import { ScorecardSchema } from './scorecard.js';

/**
 * Delivery performance: where the data comes from, the two doors it arrives through, and
 * the scorecards computed from it.
 *
 * **No person appears in any response here.** The sync stores a pull request's author login
 * for the next wave's attribution, and nothing in this file can carry it out: the reads are
 * repository-level aggregates, and the stale list names pull requests, not who opened them.
 */

// ─── The source ─────────────────────────────────────────────────────────────

export const DELIVERY_CADENCES = ['hourly', 'daily'] as const;
export const DeliveryCadenceSchema = z.enum(DELIVERY_CADENCES);

const Label = z.string().trim().min(1).max(100);
const EnvironmentName = z.string().trim().min(1).max(100);

/**
 * What marks a merged change a rollback or a hotfix: a label on its pull request, or its head
 * branch starting with a prefix. GitHub's own "Revert" button opens `revert-<n>-<branch>`.
 */
export const DeliveryMarkersSchema = z.object({
  rollbackLabels: z.array(Label).max(20).default(['rollback', 'revert']),
  hotfixLabels: z.array(Label).max(20).default(['hotfix']),
  rollbackBranchPrefixes: z.array(Label).max(20).default(['revert-']),
  hotfixBranchPrefixes: z.array(Label).max(20).default(['hotfix/']),
});
export type DeliveryMarkers = z.infer<typeof DeliveryMarkersSchema>;

/** `PUT /api/v1/projects/:id/delivery/source`. */
export const DeliverySourceBodySchema = z
  .object({
    enabled: z.boolean(),
    cadence: DeliveryCadenceSchema.default('daily'),
    productionEnvironments: z.array(EnvironmentName).min(1).max(20).default(['production']),
    markers: DeliveryMarkersSchema.partial().optional(),
    /**
     * Workflow names (as GitHub shows them) whose completed runs on the default branch are
     * deployments, for a repository that deploys from Actions without GitHub Deployments.
     */
    deployWorkflows: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  })
  .strict();
export type DeliverySourceBody = z.infer<typeof DeliverySourceBodySchema>;

export const DELIVERY_SOURCE_STATUSES = ['ok', 'failed', 'not_configured', 'rate_limited'] as const;
export const DeliverySourceStatusSchema = z.enum(DELIVERY_SOURCE_STATUSES);

export const DeliveryStreamSchema = z.object({
  /** The instant the next read starts from; `null` before the first successful read. */
  cursor: z.iso.datetime({ offset: true }).nullable(),
  syncedAt: z.iso.datetime({ offset: true }).nullable(),
  /**
   * Set while a read since `cursor` is longer than one sync reads: the page the next sync
   * continues from, the newest instant seen so far (the cursor once the read completes), and
   * the oldest instant still undecided. `null` or absent once the stream is caught up.
   */
  incomplete: z
    .object({
      nextPage: z.number().int().min(1),
      high: z.iso.datetime({ offset: true }),
      floor: z.iso.datetime({ offset: true }).nullable(),
    })
    .nullable()
    .optional(),
});

export const DeliverySourceSchema = z.object({
  projectId: z.string().uuid(),
  provider: z.literal('github'),
  /** `false` while nobody has saved a source for the project; the rest are then defaults. */
  configured: z.boolean(),
  enabled: z.boolean(),
  cadence: DeliveryCadenceSchema,
  productionEnvironments: z.array(z.string()).readonly(),
  markers: DeliveryMarkersSchema,
  deployWorkflows: z.array(z.string()).readonly(),
  /** The repository the sync reads, from the project's git URL; `null` for a non-GitHub one. */
  repository: z.object({ owner: z.string(), repo: z.string() }).nullable(),
  lastSyncedAt: z.iso.datetime({ offset: true }).nullable(),
  lastStatus: DeliverySourceStatusSchema.nullable(),
  lastError: z.string().nullable(),
  rateLimitedUntil: z.iso.datetime({ offset: true }).nullable(),
  nextSyncAt: z.iso.datetime({ offset: true }).nullable(),
  streams: z.record(z.string(), DeliveryStreamSchema),
});
export type DeliverySource = z.infer<typeof DeliverySourceSchema>;

export const DELIVERY_SYNC_REQUESTERS = ['schedule', 'operator', 'webhook'] as const;
export const DeliverySyncRequesterSchema = z.enum(DELIVERY_SYNC_REQUESTERS);
export const DELIVERY_SYNC_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const DeliverySyncStatusValueSchema = z.enum(DELIVERY_SYNC_STATUSES);

/** `POST /api/v1/projects/:id/delivery/sync` — 202. */
export const DeliverySyncQueuedSchema = z.object({
  syncId: z.string().uuid(),
  /** A sync of this source was already waiting, and this request joined it. */
  duplicate: z.boolean(),
  requestedBy: DeliverySyncRequesterSchema,
});
export type DeliverySyncQueued = z.infer<typeof DeliverySyncQueuedSchema>;

// ─── The push door ──────────────────────────────────────────────────────────

const ExternalId = z.string().trim().min(1).max(200);
const Sha = z
  .string()
  .regex(/^[0-9a-f]{7,64}$/iu)
  .transform((sha) => sha.toLowerCase());
const Instant = z.iso.datetime({ offset: true });

/** `POST /api/v1/projects/:id/delivery/deployments`: one deployment, from CI. */
export const PushDeploymentBodySchema = z
  .object({
    /** The pusher's own id for the deployment; a repeat with the same id replaces the row. */
    externalId: ExternalId,
    environment: EnvironmentName,
    status: z.enum(['success', 'failure']),
    createdAt: Instant,
    sha: Sha.optional(),
    /** Every commit the deployment carried, when CI knows them. */
    shas: z.array(Sha).max(1000).optional(),
    rollback: z.boolean().optional(),
    hotfix: z.boolean().optional(),
    unplanned: z.boolean().optional(),
    url: z.string().url().max(2000).optional(),
  })
  .strict();
export type PushDeploymentBody = z.infer<typeof PushDeploymentBodySchema>;

export const INCIDENT_SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/** `POST /api/v1/projects/:id/delivery/incidents`: one incident, opened or resolved. */
export const PushIncidentBodySchema = z
  .object({
    externalId: ExternalId,
    /** What raised it, as a short slug: `pagerduty`, `opsgenie`. Ids are unique per source. */
    source: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,49}$/u)
      .default('push'),
    openedAt: Instant,
    resolvedAt: Instant.nullable().optional(),
    severity: z.enum(INCIDENT_SEVERITIES).optional(),
    /** The causing deployment's `externalId`, as it was pushed or as GitHub numbers it. */
    deploymentId: ExternalId.optional(),
    /** Or the commit it was deployed at, when the deployment's id is not known. */
    sha: Sha.optional(),
    title: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    (body) =>
      body.resolvedAt === undefined ||
      body.resolvedAt === null ||
      Date.parse(body.resolvedAt) >= Date.parse(body.openedAt),
    { path: ['resolvedAt'], message: 'an incident is resolved after it opened' },
  );
export type PushIncidentBody = z.infer<typeof PushIncidentBodySchema>;

export const DeliveryPushResultSchema = z.object({
  id: z.string().uuid(),
  /** `false` when a row with the same external id was replaced. */
  created: z.boolean(),
});
export type DeliveryPushResult = z.infer<typeof DeliveryPushResultSchema>;

// ─── The results ────────────────────────────────────────────────────────────

export const DORA_TIER_VALUES = ['elite', 'high', 'medium', 'low'] as const;
export const DoraTierSchema = z.enum(DORA_TIER_VALUES);

export const DoraMetricResultSchema = z.object({
  value: z.number().finite().nullable(),
  sampleSize: z.number().int().min(0),
  band: DoraTierSchema.nullable(),
  status: z.enum(['measured', 'insufficient']),
  previous: z.number().finite().nullable(),
  previousSampleSize: z.number().int().min(0),
});

/** `computeDora`'s result, as returned. */
export const DoraResultSchema = z.object({
  windowDays: z.number().positive(),
  minSample: z.number().int().min(1),
  metrics: z.object({
    deploymentFrequency: DoraMetricResultSchema,
    changeLeadTime: DoraMetricResultSchema,
    changeFailureRate: DoraMetricResultSchema,
    recoveryTime: DoraMetricResultSchema,
    reworkRate: DoraMetricResultSchema,
  }),
});
export type DoraResultRecord = z.infer<typeof DoraResultSchema>;

export const FlowDurationSchema = z.object({
  medianHours: z.number().nullable(),
  p75Hours: z.number().nullable(),
  minHours: z.number().nullable(),
  maxHours: z.number().nullable(),
  sampleSize: z.number().int().min(0),
});

/** `computeFlow`'s result, as returned. It names pull requests by number and nobody else. */
export const FlowResultSchema = z.object({
  windowDays: z.number().positive(),
  staleAfterDays: z.number().positive(),
  merged: z.number().int().min(0),
  cycleTime: z.object({
    coding: FlowDurationSchema,
    pickup: FlowDurationSchema,
    review: FlowDurationSchema,
    deploy: FlowDurationSchema,
  }),
  reviewLatency: FlowDurationSchema,
  firstReviewWithinDay: z.object({ count: z.number().int(), total: z.number().int() }),
  sizes: z.object({
    XS: z.number().int(),
    S: z.number().int(),
    M: z.number().int(),
    L: z.number().int(),
    XL: z.number().int(),
  }),
  workInProgress: z.number().int().min(0),
  stale: z.array(z.object({ number: z.number().int(), daysIdle: z.number().int() })).readonly(),
  mergedWithoutReview: z.object({
    count: z.number().int(),
    merged: z.number().int(),
    rate: z.object({ estimate: z.number(), low: z.number(), high: z.number() }).nullable(),
  }),
});
export type FlowResultRecord = z.infer<typeof FlowResultSchema>;

export const DeliverySyncSummarySchema = z.object({
  configured: z.boolean(),
  enabled: z.boolean(),
  lastSyncedAt: z.iso.datetime({ offset: true }).nullable(),
  lastStatus: DeliverySourceStatusSchema.nullable(),
  lastError: z.string().nullable(),
  rateLimitedUntil: z.iso.datetime({ offset: true }).nullable(),
  latest: z
    .object({
      id: z.string().uuid(),
      status: DeliverySyncStatusValueSchema,
      requestedBy: DeliverySyncRequesterSchema,
      errorCode: z.string().nullable(),
      createdAt: z.iso.datetime({ offset: true }),
      finishedAt: z.iso.datetime({ offset: true }).nullable(),
    })
    .nullable(),
});
export type DeliverySyncSummary = z.infer<typeof DeliverySyncSummarySchema>;

/** `GET /api/v1/projects/:id/delivery?days=`. */
export const DeliveryReportSchema = z.object({
  projectId: z.string().uuid(),
  windowDays: z.number().int().min(1).max(366),
  evaluatedAt: z.iso.datetime({ offset: true }),
  productionEnvironments: z.array(z.string()).readonly(),
  dora: ScorecardSchema,
  flow: ScorecardSchema,
  doraResult: DoraResultSchema,
  flowResult: FlowResultSchema,
  /** Open, non-draft pull requests idle past `staleAfterDays`, longest idle first. */
  stalePullRequests: z
    .array(z.object({ number: z.number().int(), title: z.string(), daysIdle: z.number().int() }))
    .readonly(),
  /** What the metrics were computed over, after the push/GitHub dedupe. */
  counts: z.object({
    deployments: z.number().int().min(0),
    pullRequests: z.number().int().min(0),
    incidents: z.number().int().min(0),
  }),
  sync: DeliverySyncSummarySchema,
});
export type DeliveryReport = z.infer<typeof DeliveryReportSchema>;

/** `GET /api/v1/portfolio/delivery?days=`: the DORA tiers and both scores, per project. */
export const PortfolioDeliverySchema = z.object({
  windowDays: z.number().int().min(1).max(366),
  evaluatedAt: z.iso.datetime({ offset: true }),
  projects: z
    .array(
      z.object({
        projectId: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        dora: z.object({
          status: ScorecardSchema.shape.status,
          score: z.number().nullable(),
          cappedBy: z.string().nullable(),
          tiers: z.object({
            deploymentFrequency: DoraTierSchema.nullable(),
            changeLeadTime: DoraTierSchema.nullable(),
            changeFailureRate: DoraTierSchema.nullable(),
            recoveryTime: DoraTierSchema.nullable(),
          }),
        }),
        flow: z.object({ status: ScorecardSchema.shape.status, score: z.number().nullable() }),
      }),
    )
    .readonly(),
});
export type PortfolioDelivery = z.infer<typeof PortfolioDeliverySchema>;

/** `POST /api/v1/webhooks/github` — 202 for every verified delivery. */
export const GitHubWebhookAckSchema = z.object({
  status: z.enum(['queued', 'ignored']),
  event: z.string(),
  /** Why nothing was queued: `event`, `unknown-repository`, `not-enabled`. */
  reason: z.string().nullable(),
  queued: z.number().int().min(0),
});
export type GitHubWebhookAck = z.infer<typeof GitHubWebhookAckSchema>;
