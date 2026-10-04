import { z } from 'zod/v4';
import { ReportProducerSchema } from './report-formats.js';

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
  /**
   * The run is still going.
   *
   * It is here because the product's own upload door has always accepted it — a reporter
   * SDK streams partial uploads and says so — and it was being smuggled in as
   * `runs.status = 'running'` while the canonical row said the run had reached a verdict
   * derived from whatever tests had reported so far. So a streaming uploader's dashboard row
   * went red at the first failure of a run that was still passing, and the canonical row
   * and the projection disagreed about the same run.
   *
   * `policy.ts` classifies it as indeterminate, which is what it is: no outcome has been
   * produced. Additive, so a reader of contract v2 without this member still parses every
   * result it could before.
   */
  'running',
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
  producer: ReportProducerSchema,
  producerVersion: z.string().min(1),
  adapterVersion: z.string().min(1),
  sourceDigest: DigestSchema,
  sourceUri: z.string().min(1),
  project: z.string().min(1).optional(),
  /**
   * The cohort this result belongs to.
   *
   * These three were carried in the upload wire format from the first version of it and
   * written to `runs.branch` / `runs.commitSha` — so the *projection* could filter by
   * them while the *authority* could not, which meant a per-branch cohort comparison was
   * answerable only by reading a table derived from the row that is supposed to be the
   * authority. Declared here, optionally and additively: a producer that sends none is
   * still a valid result, because an adapter that has parsed a JUnit file has no branch
   * to report and inventing one would be a claim about the code that is false.
   */
  branch: z.string().min(1).optional(),
  commitSha: z.string().min(1).optional(),
  environment: z.string().min(1).optional(),
  shard: z.object({ index: z.number().int().min(0), total: z.number().int().min(1) }).optional(),
  /**
   * The producer's own measurements, verbatim.
   *
   * Present because a performance run's *numbers* are the result. The k6 adapter
   * puts every metric here — `http_req_duration.p(95)`, `http_req_failed.value` —
   * and the thresholds they were judged against, so the score and the dashboard
   * read the same figures the producer reported rather than a verdict with the
   * measurement discarded.
   *
   * `z.record(z.string(), z.unknown())` rather than a k6-specific shape: the
   * contract does not know what a load generator will measure next, and a closed
   * shape here would strip every field an adapter adds after it.
   */
  metrics: z.record(z.string(), z.unknown()).optional(),
  thresholds: z.record(z.string(), z.unknown()).optional(),
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
/**
 * One test's attempts must be numbered 1..n with no gap and no repeat.
 *
 * F-4. `testId` is built by two adapters from two different key pairs —
 * `classname:name` for JUnit, `file:title` for Playwright — so two distinct tests can
 * arrive carrying the same `testId`. Nothing in the contract noticed.
 *
 * **The rule is on the attempt sequence, not on `testId` uniqueness, and that is
 * deliberate.** A retried test is one test with several attempts: the Playwright adapter
 * emits one attempt per `test.results` entry with the same `testId` and
 * `index: attemptIndex + 1`, and JUnit says the same thing with `flakyFailure`. So
 * `testId` cannot be unique — a uniqueness check on it would reject every flaky run,
 * which is a normal case. Demanding 1..n per `testId` accepts retries by construction
 * and rejects a collision, because two tests that landed on one identity arrive as
 * `[1, 2, 1, 2]` rather than 1..2.
 *
 * The identity a consumer can rely on is therefore the pair `(testId, index)`, and this
 * is what makes that pair an identity rather than a coincidence.
 */
const uniqueAttemptIdentity = (
  attempts: ReadonlyArray<{ testId: string; index: number }>,
  ctx: z.RefinementCtx,
): void => {
  const byTestId = new Map<string, number[]>();
  for (const attempt of attempts) {
    const seen = byTestId.get(attempt.testId);
    if (seen) seen.push(attempt.index);
    else byTestId.set(attempt.testId, [attempt.index]);
  }
  for (const [testId, indexes] of byTestId) {
    const sorted = [...indexes].sort((a, b) => a - b);
    const expected = sorted.map((_, position) => position + 1);
    if (sorted.every((value, position) => value === expected[position])) continue;
    ctx.addIssue({
      code: 'custom',
      message: `attempts for testId "${testId}" must be numbered 1..${sorted.length} with no gap and no repeat; got [${sorted.join(', ')}]. Two distinct tests carrying the same testId are indistinguishable to a consumer that keys on it.`,
      path: ['attempts'],
    });
  }
};

const RunResultSchema = z
  .object({
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
  })
  .superRefine((result, ctx) => uniqueAttemptIdentity(result.attempts, ctx));
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
