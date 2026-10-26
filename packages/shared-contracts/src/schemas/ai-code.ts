import { z } from 'zod/v4';
import { ScorecardSchema } from './scorecard.js';

// ─── AI-written code ───────────────────────────────────────────────────────
//
// Every response here is about kinds of authorship and AI tools, never about people: no schema
// below has a field for an author login, an email address or a name, and the privacy test in
// `apps/api/src/routes/ai-code.test.ts` asserts that none of the fixtures' identities appears
// in any of them. A per-person AI-usage table is a surveillance instrument; the governance
// question does not need one.

export const AI_ATTRIBUTIONS = ['agent-authored', 'ai-assisted', 'human', 'unknown'] as const;
export type AiAttribution = (typeof AI_ATTRIBUTIONS)[number];
export const AiAttributionSchema = z.enum(AI_ATTRIBUTIONS);

export const AI_SIGNAL_KINDS = [
  'bot-login',
  'trailer',
  'branch-prefix',
  'author-email',
  'author-name',
  'message-marker',
  'label',
] as const;
export const AiSignalKindSchema = z.enum(AI_SIGNAL_KINDS);

/** One piece of evidence the classifier used. `detail` names a signature, never a person. */
export const AiAttributionSignalSchema = z.object({
  kind: AiSignalKindSchema,
  detail: z.string().min(1).max(300),
});
export type AiAttributionSignal = z.infer<typeof AiAttributionSignalSchema>;

const IntervalSchema = z.object({
  estimate: z.number(),
  low: z.number(),
  high: z.number(),
});

const RateStatSchema = z.object({
  successes: z.number().int().min(0),
  trials: z.number().int().min(0),
  rate: z.number().min(0).max(1).nullable(),
  interval: IntervalSchema.nullable(),
});

const ValueStatSchema = z.object({
  value: z.number().nullable(),
  sampleSize: z.number().int().min(0),
});

const RateComparisonSchema = z.enum(['higher', 'lower', 'same', 'insufficient']);

const VersusHumanSchema = z.object({
  revert: RateComparisonSchema,
  changeFailure: RateComparisonSchema,
  followUpFix14: RateComparisonSchema,
  followUpFix30: RateComparisonSchema,
  rubberStamp: RateComparisonSchema,
});

const OutcomeGroupSchema = z.object({
  n: z.number().int().min(0),
  revert: RateStatSchema,
  changeFailure: RateStatSchema,
  followUpFix14: RateStatSchema,
  followUpFix30: RateStatSchema,
  reviewDepth: ValueStatSchema,
  rubberStamp: RateStatSchema,
  diffCoverage: ValueStatSchema,
  newHighFindings: ValueStatSchema,
  vsHuman: VersusHumanSchema.nullable(),
});

/** `compareAiOutcomes`' result. Groups and tools, never changes or people. */
export const AiOutcomeComparisonSchema = z.object({
  evaluatedAt: z.iso.datetime({ offset: true }),
  windowDays: z.number().positive(),
  minSample: z.number().int().min(1),
  total: z.number().int().min(0),
  excluded: z.number().int().min(0),
  groups: z.object({
    'agent-authored': OutcomeGroupSchema,
    'ai-assisted': OutcomeGroupSchema,
    human: OutcomeGroupSchema,
    unknown: OutcomeGroupSchema,
  }),
  agents: z.array(OutcomeGroupSchema.extend({ agent: z.string().min(1) })).readonly(),
});
export type AiOutcomeComparisonRecord = z.infer<typeof AiOutcomeComparisonSchema>;

/** Merged pull requests per week, by attribution. `weekStart` is a Monday, UTC. */
export const AiShareWeekSchema = z.object({
  weekStart: z.iso.date(),
  agentAuthored: z.number().int().min(0),
  aiAssisted: z.number().int().min(0),
  human: z.number().int().min(0),
  unknown: z.number().int().min(0),
  total: z.number().int().min(0),
});
export type AiShareWeek = z.infer<typeof AiShareWeekSchema>;

/** `GET /api/v1/projects/:id/ai-code?days=`. */
export const AiCodeReportSchema = z.object({
  projectId: z.string().uuid(),
  windowDays: z.number().int().min(1).max(366),
  evaluatedAt: z.iso.datetime({ offset: true }),
  /** `AGENT_SIGNATURES.version`: the signature table the current classifier reads. */
  signatureVersion: z.string().min(1),
  /**
   * Merged pull requests in the window whose stored attribution was made against another
   * signature table or label set. The next delivery sync re-classifies them.
   */
  staleAttribution: z.number().int().min(0),
  scorecard: ScorecardSchema,
  comparison: AiOutcomeComparisonSchema,
  share: z.array(AiShareWeekSchema).readonly(),
});
export type AiCodeReport = z.infer<typeof AiCodeReportSchema>;

export const AiCodePullRequestSchema = z.object({
  number: z.number().int().min(1),
  title: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  attribution: AiAttributionSchema,
  agent: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  signals: z.array(AiAttributionSignalSchema).readonly(),
  /** The signature table version the row was classified against; `null` before the first. */
  attributionVersion: z.string().nullable(),
  openedAt: z.iso.datetime({ offset: true }),
  mergedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type AiCodePullRequest = z.infer<typeof AiCodePullRequestSchema>;

/** `GET /api/v1/projects/:id/ai-code/pull-requests`. */
export const AiCodePullRequestListSchema = z.object({
  items: z.array(AiCodePullRequestSchema).readonly(),
  total: z.number().int().min(0),
  offset: z.number().int().min(0),
  limit: z.number().int().min(1).max(200),
});
export type AiCodePullRequestList = z.infer<typeof AiCodePullRequestListSchema>;

/** `GET /api/v1/portfolio/ai-code?days=`: per project, how much change is AI-written. */
export const PortfolioAiCodeSchema = z.object({
  windowDays: z.number().int().min(1).max(366),
  evaluatedAt: z.iso.datetime({ offset: true }),
  projects: z
    .array(
      z.object({
        projectId: z.string().uuid(),
        name: z.string(),
        slug: z.string(),
        /** Merged pull requests in the window. */
        changes: z.number().int().min(0),
        /** 0–100; `null` with no change in the window. Agent-authored and AI-assisted pooled. */
        aiShare: z.number().min(0).max(100).nullable(),
        scorecard: z.object({
          status: ScorecardSchema.shape.status,
          score: z.number().nullable(),
        }),
      }),
    )
    .readonly(),
});
export type PortfolioAiCode = z.infer<typeof PortfolioAiCodeSchema>;
