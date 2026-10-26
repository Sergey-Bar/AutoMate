import { z } from 'zod/v4';

/**
 * Issue trackers, and issues created from a finding or a failure cluster.
 *
 * ## The credential goes in and never comes out
 *
 * `IssueTrackerBodySchema` carries the token; `IssueTrackerSchema`, which every read returns,
 * has no field that could hold it. The token is sealed in the vault on arrival.
 *
 * ## The target is named, never guessed
 *
 * Every create names `target`: `jira` (the project's configured tracker) or `github` (an
 * issue in the project's own github.com repository, with the project's git token). A project
 * with both is never sent to whichever the server happens to prefer.
 */

export const ISSUE_TRACKER_KINDS = ['jira'] as const;
export const IssueTrackerKindSchema = z.enum(ISSUE_TRACKER_KINDS);
export type IssueTrackerKind = z.infer<typeof IssueTrackerKindSchema>;

export const ISSUE_TARGETS = ['jira', 'github'] as const;
export const IssueTargetSchema = z.enum(ISSUE_TARGETS);
export type IssueTarget = z.infer<typeof IssueTargetSchema>;

/** An absolute `https` URL with no credentials in it: every request to it carries the token. */
const HttpsBaseUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === 'https:' && url.username === '' && url.password === '';
    },
    { message: 'The base URL must be an https URL with no credentials in it' },
  );

/** `PUT /api/v1/projects/:id/issue-tracker` (admin). */
export const IssueTrackerBodySchema = z.object({
  kind: IssueTrackerKindSchema.default('jira'),
  baseUrl: HttpsBaseUrl,
  /** Jira's project key: an upper-case letter, then letters, digits or underscores. */
  projectKey: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{0,49}$/u),
  issueType: z.string().trim().min(1).max(100).default('Bug'),
  /**
   * The bearer token. Required when the tracker is first configured; omitted on a later
   * change of key or issue type, the sealed one is kept.
   */
  token: z.string().min(1).max(4000).optional(),
});
export type IssueTrackerBody = z.infer<typeof IssueTrackerBodySchema>;

/** A configured tracker, as every read returns it: no token. */
export const IssueTrackerSchema = z.object({
  projectId: z.string().min(1),
  kind: IssueTrackerKindSchema,
  baseUrl: z.string().min(1),
  projectKey: z.string().min(1),
  issueType: z.string().min(1),
  /** Whether a token is sealed for it. `false` means every create answers `NOT_CONFIGURED`. */
  hasCredential: z.boolean(),
  updatedBy: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type IssueTracker = z.infer<typeof IssueTrackerSchema>;

/** `GET /api/v1/projects/:id/issue-tracker`: `null` until one is configured. */
export const IssueTrackerReadingSchema = z.object({ tracker: IssueTrackerSchema.nullable() });
export type IssueTrackerReading = z.infer<typeof IssueTrackerReadingSchema>;

/** `POST /api/v1/projects/:id/health/findings/:findingId/issue` (operator). */
export const FindingIssueBodySchema = z.object({ target: IssueTargetSchema });
export type FindingIssueBody = z.infer<typeof FindingIssueBodySchema>;

/** `POST /api/v1/dashboard/failure-clusters/issue` (operator): the cluster, as insights showed it. */
export const ClusterIssueBodySchema = z.object({
  /** The project whose tracker (or repository) the issue goes to. */
  projectId: z.string().uuid(),
  target: IssueTargetSchema,
  signature: z.string().min(1).max(1000),
  errorType: z.string().max(200).nullable().optional(),
  sampleMessage: z.string().max(4000),
  tests: z.array(z.string().min(1).max(500)).max(50).default([]),
  count: z.number().int().min(1),
  runs: z.number().int().min(1),
  branches: z.array(z.string().min(1).max(255)).max(20).default([]),
});
export type ClusterIssueBody = z.infer<typeof ClusterIssueBodySchema>;

/** The issue a finding or a cluster has, whether this call created it or an earlier one did. */
export const IssueLinkSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  sourceKind: z.enum(['finding', 'cluster']),
  sourceKey: z.string().min(1),
  target: IssueTargetSchema,
  key: z.string().min(1),
  url: z.string().min(1),
  /** `true` when this request created it; `false` when it already existed. */
  created: z.boolean(),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
});
export type IssueLink = z.infer<typeof IssueLinkSchema>;
