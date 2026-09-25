import { z } from 'zod/v4';

export const QA_CONTRACT_VERSION = '1' as const;

const TimestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Invalid timestamp');
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/u, 'Expected a SHA-256 digest');
const MetadataSchema = z.record(z.string(), z.unknown());
const IdSchema = z.string().min(1);
const NullableIdSchema = IdSchema.nullable();

export const RunPhaseSchema = z.enum([
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
  'complete',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
  'partial',
]);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const RunOutcomeValueSchema = z.enum([
  'passed',
  'failed',
  'unknown',
  'partial',
  'cancelled',
  'timed_out',
  'runner_lost',
  'infra_failed',
  'config_failed',
  'blocked',
]);
export const RunOutcomeSchema = RunOutcomeValueSchema.nullable();
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;
export type KnownRunOutcome = z.infer<typeof RunOutcomeValueSchema>;

export const CanonicalTestStatusSchema = z.enum([
  'queued',
  'running',
  'passed',
  'failed',
  'flaky',
  'skipped',
  'blocked',
  'unknown',
  'cancelled',
  'timed_out',
]);
export type CanonicalTestStatus = z.infer<typeof CanonicalTestStatusSchema>;

export const TerminalCanonicalTestStatusSchema = CanonicalTestStatusSchema.exclude([
  'queued',
  'running',
]);
export type TerminalCanonicalTestStatus = z.infer<typeof TerminalCanonicalTestStatusSchema>;

export const GateStatusSchema = z.enum(['passed', 'failed', 'warning', 'unknown', 'not_evaluated']);
export type GateStatus = z.infer<typeof GateStatusSchema>;

export const RunErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: MetadataSchema.optional(),
});
export type RunError = z.infer<typeof RunErrorSchema>;

export const ArtifactKindSchema = z.enum([
  'report',
  'junit',
  'json',
  'log',
  'stdout',
  'stderr',
  'screenshot',
  'video',
  'trace',
  'html',
  'attachment',
  'other',
]);
export type ArtifactKind = z.infer<typeof ArtifactKindSchema>;

export const ArtifactDescriptorSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  jobId: IdSchema.nullable(),
  testId: IdSchema.nullable(),
  attempt: z.number().int().min(1).optional(),
  kind: z.string().min(1),
  name: z.string().min(1),
  contentType: z.string().min(1),
  storageKey: z.string().min(1),
  checksum: DigestSchema,
  sizeBytes: z.number().int().nonnegative(),
  createdAt: TimestampSchema,
  expiresAt: TimestampSchema.nullable(),
  legalHold: z.boolean(),
  metadata: MetadataSchema.default({}),
});
export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;

export const RunSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  blocked: z.number().int().nonnegative().default(0),
  unknown: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().nullable(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;

export const QualityDomainSchema = z.enum([
  'browser',
  'api',
  'mobile',
  'performance',
  'security',
  'accessibility',
  'other',
]);
export type QualityDomain = z.infer<typeof QualityDomainSchema>;

export const QualityPolicyRuleSchema = z.object({
  domain: QualityDomainSchema,
  required: z.boolean().default(false),
  minimumPassRate: z.number().min(0).max(100).optional(),
  requiredArtifactKinds: z.array(ArtifactKindSchema).default([]),
});
export type QualityPolicyRule = z.infer<typeof QualityPolicyRuleSchema>;

export const QualityPolicySchema = z.object({
  id: IdSchema,
  workspaceId: IdSchema,
  name: z.string().min(1),
  version: z.string().min(1),
  hash: DigestSchema,
  requiredDomains: z.array(QualityDomainSchema).min(1).default(['browser']),
  browserPassRateThreshold: z.number().min(0).max(100).default(100),
  maxFlakyRate: z.number().min(0).max(100).default(0),
  maxDurationMs: z.number().nonnegative().nullable(),
  rules: z.array(QualityPolicyRuleSchema).default([]),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type QualityPolicy = z.infer<typeof QualityPolicySchema>;

export const GateReasonSchema = z.string().min(1);
export type GateReason = z.infer<typeof GateReasonSchema>;

export const DomainStatusSchema = z.enum([
  'passed',
  'failed',
  'warning',
  'unknown',
  'not_configured',
  'not_implemented',
]);
export type DomainStatus = z.infer<typeof DomainStatusSchema>;

export const GateEvaluationSchema = z.object({
  id: IdSchema,
  runId: IdSchema,
  releaseId: IdSchema.nullable(),
  policyId: IdSchema,
  policyVersion: z.string().min(1),
  policyHash: DigestSchema,
  status: GateStatusSchema,
  decision: z.enum(['ready', 'ready_with_warnings', 'blocked', 'unknown']),
  reasons: z.array(GateReasonSchema).default([]),
  evidenceRefs: z.array(IdSchema).default([]),
  domainStatuses: z.record(QualityDomainSchema, DomainStatusSchema),
  evaluatedAt: TimestampSchema,
});
export type GateEvaluation = z.infer<typeof GateEvaluationSchema>;

export const ReleaseDecisionSchema = z.enum(['ready', 'ready_with_warnings', 'blocked', 'unknown']);
export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;

export const DomainReadinessStatusSchema = DomainStatusSchema;
export type DomainReadinessStatus = DomainStatus;

export const ReleaseReadinessSchema = z.object({
  releaseId: IdSchema,
  decision: ReleaseDecisionSchema,
  browser: DomainStatusSchema,
  domains: z.record(QualityDomainSchema, DomainStatusSchema),
  latestRunId: IdSchema.nullable(),
  gate: GateEvaluationSchema.nullable(),
  evaluatedAt: TimestampSchema,
});
export type ReleaseReadiness = z.infer<typeof ReleaseReadinessSchema>;

export const IntegrationMaturityLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
export type IntegrationMaturityLevel = z.infer<typeof IntegrationMaturityLevelSchema>;

export const IntegrationEvidenceStatusSchema = z.enum([
  'not_configured',
  'catalogued',
  'implemented',
  'verified',
  'unsupported',
]);
export type IntegrationEvidenceStatus = z.infer<typeof IntegrationEvidenceStatusSchema>;

export const IntegrationMaturitySchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  domain: z.string().min(1),
  level: IntegrationMaturityLevelSchema,
  capabilities: z.array(z.string().min(1)).default([]),
  adapterVersion: z.string().min(1).nullable(),
  evidenceStatus: IntegrationEvidenceStatusSchema,
  evidence: z.array(IdSchema).default([]),
  testStatus: CanonicalTestStatusSchema.default('unknown'),
  updatedAt: TimestampSchema.optional(),
});
export type IntegrationMaturity = z.infer<typeof IntegrationMaturitySchema>;

export const AttemptResultSchema = z.object({
  attempt: z.number().int().min(1),
  status: CanonicalTestStatusSchema,
  startedAt: TimestampSchema.optional().nullable(),
  finishedAt: TimestampSchema.optional().nullable(),
  durationMs: z.number().nonnegative().optional().nullable(),
  error: RunErrorSchema.optional().nullable(),
  artifactIds: z.array(IdSchema).default([]),
  rawStatus: z.string().min(1).optional(),
  metadata: MetadataSchema.default({}),
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

export const CanonicalTestResultSchema = z.object({
  id: IdSchema,
  testId: IdSchema.optional(),
  title: z.string().min(1),
  suite: z.string().min(1).optional().nullable(),
  file: z.string().min(1).optional().nullable(),
  status: CanonicalTestStatusSchema,
  startedAt: TimestampSchema.optional().nullable(),
  finishedAt: TimestampSchema.optional().nullable(),
  durationMs: z.number().nonnegative().optional().nullable(),
  error: RunErrorSchema.optional().nullable(),
  attempts: z.array(AttemptResultSchema).default([]),
  artifactIds: z.array(IdSchema).default([]),
  metadata: MetadataSchema.default({}),
});
export type CanonicalTestResult = z.infer<typeof CanonicalTestResultSchema>;

export const RunTestStatusSchema = CanonicalTestStatusSchema;
export type RunTestStatus = CanonicalTestStatus;
export const RunTestResultSchema = CanonicalTestResultSchema;
export type RunTestResult = CanonicalTestResult;

export const TestSelectionSchema = z.object({
  testIds: z.array(IdSchema).default([]),
  paths: z.array(z.string().min(1)).default([]),
  tags: z.array(z.string().min(1)).default([]),
});
export type TestSelection = z.infer<typeof TestSelectionSchema>;

export const CreateRunRequestSchema = z.object({
  externalId: IdSchema.optional().nullable(),
  source: z.string().min(1).default('api'),
  projectId: IdSchema,
  environmentId: IdSchema,
  releaseId: IdSchema,
  branch: z.string().min(1),
  commit: z.string().min(1),
  testType: z.string().min(1).default('browser'),
  framework: z.string().min(1).optional(),
  adapterVersion: z.string().min(1).optional(),
  suite: z.string().min(1).optional(),
  selection: z.union([z.array(IdSchema), TestSelectionSchema]).default([]),
  timeoutMs: z.number().int().positive().default(1_800_000),
  idempotencyKey: IdSchema,
  retryOfRunId: IdSchema.optional(),
  priority: z.number().int().default(0),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  labels: z.array(z.string().min(1)).default([]),
  configuration: MetadataSchema.default({}),
  policyId: IdSchema.optional(),
  availableAt: TimestampSchema.optional(),
  metadata: MetadataSchema.default({}),
});
export type CreateRunRequest = z.infer<typeof CreateRunRequestSchema>;

export const RunRunnerReferenceSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  os: z.string().min(1).optional(),
  arch: z.string().min(1).optional(),
  health: z.enum(['healthy', 'degraded', 'draining', 'offline', 'revoked']),
  lastHeartbeatAt: TimestampSchema.nullable(),
  capabilities: z.array(z.string().min(1)).default([]),
});
export type RunRunnerReference = z.infer<typeof RunRunnerReferenceSchema>;

export const NormalizedRunSchema = z.object({
  id: IdSchema,
  externalId: NullableIdSchema,
  source: z.string().min(1),
  framework: z.string().min(1).nullable(),
  adapterVersion: z.string().min(1).nullable(),
  testType: z.string().min(1),
  projectId: NullableIdSchema,
  environmentId: NullableIdSchema,
  releaseId: NullableIdSchema,
  branch: z.string().min(1).nullable(),
  commit: z.string().min(1).nullable(),
  suite: z.string().min(1).nullable(),
  selection: z.union([z.array(IdSchema), TestSelectionSchema]),
  timeoutMs: z.number().int().positive(),
  priority: z.number().int(),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  labels: z.array(z.string().min(1)).default([]),
  configuration: MetadataSchema.default({}),
  policyId: IdSchema.nullable(),
  idempotencyKey: IdSchema,
  workspaceId: IdSchema,
  attempt: z.number().int().min(1),
  retryOfRunId: IdSchema.nullable(),
  tests: z.array(CanonicalTestResultSchema).default([]),
  summary: RunSummarySchema,
  total: z.number().int().nonnegative().optional(),
  phase: RunPhaseSchema,
  outcome: RunOutcomeSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
  startedAt: TimestampSchema.nullable(),
  completedAt: TimestampSchema.nullable(),
  finishedAt: TimestampSchema.optional().nullable(),
  runner: RunRunnerReferenceSchema.nullable(),
  error: RunErrorSchema.nullable(),
  rawEvidenceRefs: z.array(IdSchema).default([]),
  artifacts: z.array(ArtifactDescriptorSchema).default([]),
  policyEvaluation: GateEvaluationSchema.nullable(),
  status: z.string().min(1).optional(),
});
export type NormalizedRun = z.infer<typeof NormalizedRunSchema>;

const RunEventBaseSchema = z.object({
  version: z.literal(QA_CONTRACT_VERSION),
  eventId: IdSchema,
  sequence: z.number().int().min(1),
  occurredAt: TimestampSchema,
  runId: IdSchema,
});

export const RunQueuedEventPayloadSchema = z.object({
  externalId: IdSchema.optional(),
  phase: z.literal('queued'),
  outcome: z.null(),
  requestedAt: TimestampSchema,
});
export type RunQueuedEventPayload = z.infer<typeof RunQueuedEventPayloadSchema>;

export const RunAssignedEventPayloadSchema = z.object({
  phase: z.literal('assigned'),
  outcome: z.null(),
  jobId: IdSchema,
  runnerId: IdSchema,
});
export type RunAssignedEventPayload = z.infer<typeof RunAssignedEventPayloadSchema>;

export const RunStartedEventPayloadSchema = z.object({
  externalId: IdSchema.optional(),
  phase: z.literal('running'),
  outcome: z.null(),
  startedAt: TimestampSchema,
  branch: z.string().min(1).optional(),
  commit: z.string().min(1).optional(),
  total: z.number().int().nonnegative().optional(),
});
export type RunStartedEventPayload = z.infer<typeof RunStartedEventPayloadSchema>;

export const RunPhaseChangedEventPayloadSchema = z.object({
  previousPhase: RunPhaseSchema.optional(),
  phase: RunPhaseSchema,
  outcome: RunOutcomeSchema,
});
export type RunPhaseChangedEventPayload = z.infer<typeof RunPhaseChangedEventPayloadSchema>;

export const TestQueuedEventPayloadSchema = z.object({
  testId: IdSchema,
  attempt: z.number().int().min(1),
  status: z.literal('queued'),
});
export type TestQueuedEventPayload = z.infer<typeof TestQueuedEventPayloadSchema>;

export const TestStartedEventPayloadSchema = z.object({
  testId: IdSchema,
  attempt: z.number().int().min(1),
  status: z.literal('running'),
  title: z.string().min(1).optional(),
  suite: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  startedAt: TimestampSchema,
});
export type TestStartedEventPayload = z.infer<typeof TestStartedEventPayloadSchema>;

export const TestCompletedEventPayloadSchema = z.object({
  testId: IdSchema,
  attempt: z.number().int().min(1),
  status: TerminalCanonicalTestStatusSchema,
  title: z.string().min(1).optional(),
  suite: z.string().min(1).optional(),
  file: z.string().min(1).optional(),
  finishedAt: TimestampSchema,
  durationMs: z.number().nonnegative().optional(),
  error: RunErrorSchema.nullable().optional(),
  artifactIds: z.array(IdSchema).default([]),
});
export type TestCompletedEventPayload = z.infer<typeof TestCompletedEventPayloadSchema>;

export const RunCompletedEventPayloadSchema = z.object({
  phase: z.enum([
    'complete',
    'cancelled',
    'timed_out',
    'runner_lost',
    'infra_failed',
    'config_failed',
    'blocked',
    'partial',
  ]),
  outcome: RunOutcomeValueSchema,
  finishedAt: TimestampSchema,
  summary: RunSummarySchema.optional(),
  error: RunErrorSchema.nullable().optional(),
  artifactIds: z.array(IdSchema).default([]),
});
export type RunCompletedEventPayload = z.infer<typeof RunCompletedEventPayloadSchema>;

export const ArtifactCreatedEventPayloadSchema = z.object({
  artifact: ArtifactDescriptorSchema,
});
export type ArtifactCreatedEventPayload = z.infer<typeof ArtifactCreatedEventPayloadSchema>;

export const GateEvaluatedEventPayloadSchema = z.object({
  evaluation: GateEvaluationSchema,
});
export type GateEvaluatedEventPayload = z.infer<typeof GateEvaluatedEventPayloadSchema>;

export const RunEventTypeSchema = z.enum([
  'run.queued',
  'run.assigned',
  'run.started',
  'run.phase_changed',
  'test.queued',
  'test.started',
  'test.completed',
  'run.completed',
  'artifact.created',
  'gate.evaluated',
]);
export type RunEventType = z.infer<typeof RunEventTypeSchema>;

export const RunEventEnvelopeSchema = z.discriminatedUnion('type', [
  RunEventBaseSchema.extend({
    type: z.literal('run.queued'),
    payload: RunQueuedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('run.assigned'),
    payload: RunAssignedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('run.started'),
    payload: RunStartedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('run.phase_changed'),
    payload: RunPhaseChangedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('test.queued'),
    payload: TestQueuedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('test.started'),
    payload: TestStartedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('test.completed'),
    payload: TestCompletedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('run.completed'),
    payload: RunCompletedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('artifact.created'),
    payload: ArtifactCreatedEventPayloadSchema,
  }),
  RunEventBaseSchema.extend({
    type: z.literal('gate.evaluated'),
    payload: GateEvaluatedEventPayloadSchema,
  }),
]);
export type RunEventEnvelope = z.infer<typeof RunEventEnvelopeSchema>;
export const CanonicalRunEventEnvelopeSchema = RunEventEnvelopeSchema;
export type CanonicalRunEventEnvelope = RunEventEnvelope;

export const RunnerManifestSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  version: z.string().min(1),
  os: z.string().min(1),
  arch: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1),
  labels: z.array(z.string().min(1)).default([]),
  slots: z.number().int().min(1),
  protocolVersion: z.literal(QA_CONTRACT_VERSION).default(QA_CONTRACT_VERSION),
});
export type RunnerManifest = z.infer<typeof RunnerManifestSchema>;

export const RunnerRegistrationSchema = z.object({
  runnerId: IdSchema,
  manifest: RunnerManifestSchema,
  token: z.string().min(1),
  expiresAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema.optional(),
});
export type RunnerRegistration = z.infer<typeof RunnerRegistrationSchema>;

export const RunnerHeartbeatSchema = z.object({
  runnerId: IdSchema,
  health: z.enum(['healthy', 'degraded', 'draining', 'offline', 'revoked']),
  lastHeartbeatAt: TimestampSchema,
  activeJobIds: z.array(IdSchema).default([]),
  metrics: MetadataSchema.optional(),
  leaseId: IdSchema.optional(),
  availableSlots: z.number().int().nonnegative().optional(),
  capabilities: z.array(z.string().min(1)).optional(),
  occurredAt: TimestampSchema.optional(),
});
export type RunnerHeartbeat = z.infer<typeof RunnerHeartbeatSchema>;

export const JobClaimSchema = z.object({
  jobId: IdSchema,
  runId: IdSchema,
  attempt: z.number().int().min(1),
  leaseId: IdSchema,
  fencingToken: z.number().int().min(1),
  timeoutMs: z.number().int().positive(),
  spec: MetadataSchema,
  availableAt: TimestampSchema,
  leaseExpiresAt: TimestampSchema,
  runnerId: IdSchema.optional(),
  claimedAt: TimestampSchema.optional(),
  requiredCapabilities: z.array(z.string().min(1)).default([]),
  input: MetadataSchema.default({}),
});
export type JobClaim = z.infer<typeof JobClaimSchema>;

export const JobEventBatchSchema = z.object({
  jobId: IdSchema,
  runId: IdSchema,
  leaseId: IdSchema,
  fencingToken: z.number().int().min(1),
  events: z.array(RunEventEnvelopeSchema).min(1),
  sentAt: TimestampSchema.optional(),
});
export type JobEventBatch = z.infer<typeof JobEventBatchSchema>;

export const JobCompletionSchema = z.object({
  jobId: IdSchema,
  runId: IdSchema,
  leaseId: IdSchema,
  fencingToken: z.number().int().min(1),
  attempt: z.number().int().min(1),
  phase: RunCompletedEventPayloadSchema.shape.phase,
  outcome: RunOutcomeValueSchema,
  summary: RunSummarySchema.optional(),
  error: RunErrorSchema.optional().nullable(),
  artifactIds: z.array(IdSchema).default([]),
  tests: z.array(CanonicalTestResultSchema).optional(),
  status: z.string().min(1).optional(),
  finishedAt: TimestampSchema,
});
export type JobCompletion = z.infer<typeof JobCompletionSchema>;
