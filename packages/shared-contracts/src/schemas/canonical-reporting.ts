import { z } from 'zod/v4';

/**
 * Canonical run/event wire contract (`automate.run@2`).
 *
 * This version is the authority for RunResult, ReporterEvent and
 * RealtimeEnvelope. It is intentionally independent of the runner protocol
 * version so a protocol bump can never silently change run/event meaning.
 */
export const RUN_CONTRACT_VERSION = '2' as const;
export const RUN_CONTRACT_ID = `automate.run@${RUN_CONTRACT_VERSION}` as const;

/** Runner protocol version — deliberately not the same number as the run contract. */
export const RUNNER_PROTOCOL_VERSION = '1' as const;

/** Time-boxed flat reporter decoder kept for backwards compatibility. */
export const LEGACY_FLAT_V1_CONTRACT_ID = 'legacy-flat-v1' as const;

const TimestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp');
const ParentTraversalPattern = /(?:^|[\\/])\.\.(?:[\\/]|$)/u;
const WindowsDrivePattern = /^[A-Za-z]:[\\/]/u;
const LocalFileSchemePattern = /^file:/iu;

/**
 * Single path-safety rule shared by canonical paths and evidence URIs.
 *
 * A value is safe only when it is relative and local-free: no absolute
 * POSIX (`/x`) or Windows (`\\host\x`, `\x`, `C:\x`) form, no `file:` scheme,
 * no parent-traversal segment, and no null byte.
 */
function isSafeRelativeReference(value: string): boolean {
  return (
    !value.includes('\0') &&
    !value.startsWith('/') &&
    !value.startsWith('\\') &&
    !WindowsDrivePattern.test(value) &&
    !LocalFileSchemePattern.test(value) &&
    !ParentTraversalPattern.test(value)
  );
}

const RelativePathSchema = z
  .string()
  .min(1)
  .refine(
    isSafeRelativeReference,
    'Path must be relative, non-local, null-byte free, and free of parent traversal',
  );
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a SHA-256 digest');
const StatusSchema = z.enum([
  // Product-result values.
  'passed',
  'failed',
  'flaky',
  'skipped',
  'timedOut',
  'unknown',
  'cancelled',
  // Non-product outcomes stay distinct from a product failure.
  'blocked',
  'configFailed',
  'infraFailed',
  'runnerFailed',
]);
const RetentionSchema = z.object({
  class: z.enum(['standard', 'quarantine', 'legal_hold', 'expired']),
  reason: z.string().min(1).optional(),
});
const EvidenceReferenceSchema = z.object({
  uri: z
    .string()
    .min(1)
    .refine(
      isSafeRelativeReference,
      'Evidence URI must not be a local file path or contain parent traversal',
    ),
  mediaType: z.string().min(1),
  byteSize: z.number().int().nonnegative(),
  digest: DigestSchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
});
const AttemptSchema = z.object({
  index: z.number().int().min(1),
  testId: z.string().min(1),
  specPath: RelativePathSchema,
  title: z.string().min(1),
  suite: z.string().min(1).optional(),
  status: StatusSchema,
  rawStatus: z.string().min(1),
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  error: z.object({ message: z.string().min(1), code: z.string().min(1).optional() }).optional(),
  evidence: z.array(EvidenceReferenceSchema),
  flakiness: z.enum(['unknown', 'observed']).default('unknown'),
});
const ProvenanceSchema = z.object({
  producer: z.enum(['playwright', 'junit', 'robot', 'k6', 'sarif', 'otel', 'generic', 'legacy']),
  producerVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  sourceDigest: DigestSchema,
  sourceUri: z.string().min(1),
  project: z.string().min(1).optional(),
  shard: z.object({ index: z.number().int().min(0), total: z.number().int().min(1) }).optional(),
});
const ProofSchema = z.object({
  state: z.enum([
    'verified',
    'unverified',
    'proven',
    'unproven',
    'inconclusive',
    'contradictory',
    'unavailable',
    'stale',
  ]),
  digest: DigestSchema,
  verifier: z.string().min(1),
  verifiedAt: TimestampSchema.optional(),
});
const CompletenessSchema = z.object({
  state: z.enum(['complete', 'partial', 'unknown', 'rejected']),
  missingShards: z.array(z.number().int().min(0)).default([]),
  duplicateShards: z.array(z.number().int().min(0)).default([]),
});
const RunIdentitySchema = z.object({
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  shard: z.object({ index: z.number().int().min(0), total: z.number().int().min(1) }).optional(),
});
type Step = {
  id: string;
  parentId?: string;
  ordinal: number;
  status: z.infer<typeof StatusSchema>;
  error?: { message: string; code?: string };
  evidence: z.infer<typeof EvidenceReferenceSchema>[];
  children: Step[];
};
const StepSchema: z.ZodType<Step> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    parentId: z.string().min(1).optional(),
    ordinal: z.number().int().min(0),
    status: StatusSchema,
    error: z.object({ message: z.string().min(1), code: z.string().min(1).optional() }).optional(),
    evidence: z.array(EvidenceReferenceSchema),
    children: z.array(StepSchema).default([]),
  }),
);
const RunResultSchema = z.object({
  contractVersion: z.literal(RUN_CONTRACT_VERSION),
  identity: RunIdentitySchema,
  status: StatusSchema,
  startedAt: TimestampSchema,
  finishedAt: TimestampSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  attempts: z.array(AttemptSchema).min(1),
  steps: z.array(StepSchema).default([]),
  evidence: z.array(EvidenceReferenceSchema),
  provenance: ProvenanceSchema,
  retention: RetentionSchema,
  proof: ProofSchema,
  completeness: CompletenessSchema,
  raw: z.record(z.string(), z.unknown()).default({}),
});
const EventBaseSchema = z.object({
  contractVersion: z.literal(RUN_CONTRACT_VERSION),
  eventId: z.string().min(1),
  occurredAt: TimestampSchema,
  runId: z.string().min(1),
  workspaceId: z.string().min(1),
});
const ReporterEventSchema = z.discriminatedUnion('type', [
  EventBaseSchema.extend({ type: z.literal('run.started'), data: RunIdentitySchema }),
  EventBaseSchema.extend({
    type: z.literal('check.started'),
    data: AttemptSchema.pick({ index: true, testId: true, specPath: true, title: true }),
  }),
  EventBaseSchema.extend({ type: z.literal('check.attempt'), data: AttemptSchema }),
  EventBaseSchema.extend({ type: z.literal('check.completed'), data: AttemptSchema }),
  EventBaseSchema.extend({
    type: z.literal('run.completed'),
    data: z.object({
      status: StatusSchema,
      finishedAt: TimestampSchema,
      resultDigest: DigestSchema,
    }),
  }),
  EventBaseSchema.extend({ type: z.literal('artifact.ready'), data: EvidenceReferenceSchema }),
]);
const RealtimeEnvelopeSchema = z.object({
  contractVersion: z.literal(RUN_CONTRACT_VERSION),
  cursor: z.string().min(1),
  eventType: z.string().min(1),
  runId: z.string().min(1).optional(),
  workspaceId: z.string().min(1).optional(),
  occurredAt: TimestampSchema,
  data: z.unknown(),
});
const InstallationSessionSchema = z.object({
  installationId: z.string().min(1),
  sessionId: z.string().min(1),
  issuedAt: TimestampSchema,
  expiresAt: TimestampSchema,
  lastUsedAt: TimestampSchema.optional(),
});

type Attempt = z.infer<typeof AttemptSchema>;
type Completeness = z.infer<typeof CompletenessSchema>;
type EvidenceReference = z.infer<typeof EvidenceReferenceSchema>;
type InstallationSession = z.infer<typeof InstallationSessionSchema>;
type Proof = z.infer<typeof ProofSchema>;
type RealtimeEnvelope = z.infer<typeof RealtimeEnvelopeSchema>;
type ReporterEvent = z.infer<typeof ReporterEventSchema>;
type ReporterEventType = ReporterEvent['type'];
type Retention = z.infer<typeof RetentionSchema>;
type RunResult = z.infer<typeof RunResultSchema>;

/**
 * Every versioned reporter event type this contract knows about. Ingestion
 * boundaries use it to reject unknown types instead of accepting-and-dropping.
 */
const REPORTER_EVENT_TYPES: ReporterEventType[] = ReporterEventSchema.options.map(
  (option) => option.shape.type.value,
);

export {
  AttemptSchema,
  CompletenessSchema,
  EvidenceReferenceSchema,
  InstallationSessionSchema,
  ProofSchema,
  REPORTER_EVENT_TYPES,
  RealtimeEnvelopeSchema,
  ReporterEventSchema,
  RetentionSchema,
  RunResultSchema,
  StatusSchema,
  StepSchema,
};
export type {
  Attempt,
  Completeness,
  EvidenceReference,
  InstallationSession,
  Proof,
  RealtimeEnvelope,
  ReporterEvent,
  ReporterEventType,
  Retention,
  RunResult,
  Step,
};
