/**
 * schemas.ts — the request bodies and the options type for the execution API.
 *
 * These were the first 270-odd lines of `routes/execution.ts`, above every route
 * handler. Two reasons that is the wrong place for them:
 *
 * 1. **A schema is a contract, and it was unreadable as one.** Nine Zod declarations
 *    sat above 600 lines of handler code, so a change to a body shape meant reading a
 *    route module to find it — and the only test that could exercise them was a route
 *    test, which needs a store, a bus and a workspace.
 * 2. **Nothing else could reuse them.** The reporter and the job-claiming path validate
 *    the same shapes, and they could not reach them without importing the whole route
 *    module, which drags in the Hono app and every store the routes touch.
 *
 * They are exported here rather than kept private because the route modules import
 * them; what they are *for* is unchanged.
 */

import { z } from 'zod/v4';
import {
  ExecutionEventLineSchema,
  RunEventTypeSchema,
  type RunEventType,
} from '@automate/shared-contracts';
import type { RunRepository } from '../../repositories/run-repository.js';
import type { RealtimeBus } from '../../realtime/realtime-bus.js';
import type { ExecutionStore } from '../../execution/types.js';

export const CreateRunSchema = z
  .object({
    externalId: z.string().min(1).nullable().optional(),
    source: z.string().min(1).optional(),
    framework: z.string().min(1).optional(),
    adapterVersion: z.string().min(1).optional(),
    testType: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    environmentId: z.string().min(1).optional(),
    releaseId: z.string().min(1).optional(),
    branch: z.string().optional(),
    commit: z.string().optional(),
    suite: z.string().optional(),
    selection: z
      .union([
        z.array(z.string()),
        z.object({
          testIds: z.array(z.string()).default([]),
          paths: z.array(z.string()).default([]),
          tags: z.array(z.string()).default([]),
        }),
      ])
      .optional(),
    timeoutMs: z.number().int().positive().max(86_400_000).optional(),
    priority: z.number().int().optional(),
    requiredCapabilities: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional(),
    configuration: z.record(z.string(), z.unknown()).optional(),
    policyId: z.string().min(1).optional(),
    idempotencyKey: z.string().min(1).optional(),
  })
  .passthrough();

export const PolicySchema = z
  .object({
    name: z.string().min(1).default('Universal QA policy'),
    version: z.string().min(1).default('1'),
    requiredDomains: z
      .array(
        z.enum(['browser', 'api', 'mobile', 'performance', 'security', 'accessibility', 'other']),
      )
      .default(['browser']),
    browserPassRateThreshold: z.number().min(0).max(100).default(100),
    maxFlakyRate: z.number().min(0).max(100).default(0),
    maxDurationMs: z.number().int().nonnegative().nullable().optional().default(null),
    rules: z
      .array(
        z.object({
          domain: z.enum([
            'browser',
            'api',
            'mobile',
            'performance',
            'security',
            'accessibility',
            'other',
          ]),
          required: z.boolean().default(false),
          minimumPassRate: z.number().min(0).max(100).optional(),
          requiredArtifactKinds: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  })
  .passthrough();

export const RegistrationSchema = z
  .object({
    runnerId: z.string().min(1).optional(),
    name: z.string().min(1).default('runner'),
    version: z.string().min(1).default('unknown'),
    os: z.string().min(1).default(process.platform),
    arch: z.string().min(1).default(process.arch),
    capabilities: z.array(z.string().min(1)).default([]),
    labels: z.array(z.string().min(1)).default([]),
    slots: z.number().int().positive().max(1000).default(1),
    /**
     * The runner's current token, required to rotate the credential of an
     * already-registered runner id.
     */
    rotationToken: z.string().min(1).optional(),
    manifest: z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        version: z.string().min(1).optional(),
        os: z.string().min(1).optional(),
        arch: z.string().min(1).optional(),
        capabilities: z.array(z.string().min(1)).optional(),
        labels: z.array(z.string().min(1)).optional(),
        slots: z.number().int().positive().max(1000).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const HeartbeatSchema = z
  .object({
    activeJobIds: z.array(z.string().min(1)).optional(),
    activeJobs: z.array(z.string().min(1)).optional(),
    health: z.enum(['healthy', 'degraded', 'draining', 'offline']).optional(),
    leaseId: z.string().min(1).optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const ClaimSchema = z
  .object({
    capabilities: z.array(z.string().min(1)).optional(),
    requiredCapabilities: z.array(z.string().min(1)).optional(),
    labels: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

// The shape a runner writes and this API reads, from the contract both sides
// already depend on. The local copy was field-for-field identical but validated
// `occurredAt` as "any `Date.parse`-able string" while this handler's own batch
// schema demanded an offset — so a runner could pass its own parser and be
// rejected on ingest. One schema, one rule.
//
// `occurredAt` is relaxed to optional here, and only here: a *reader* may
// tolerate an absent timestamp because the store falls back to arrival time,
// while a producer that omits one is a bug. Tightening the reader would reject
// batches this API has always accepted.
export const EventSchema = ExecutionEventLineSchema.extend({
  occurredAt: z.string().datetime({ offset: true }).optional(),
}).passthrough();

export const EventBatchSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    leaseId: z.string().min(1).optional(),
    fencingToken: z.number().int().positive().optional(),
    events: z.array(EventSchema).min(1),
    nextSequence: z.number().int().positive().optional(),
    terminal: z.boolean().optional(),
    sentAt: z.string().min(1).optional(),
  })
  .passthrough();

export const ArtifactSchema = z
  .object({
    name: z.string().min(1),
    kind: z.string().min(1).default('raw'),
    contentType: z.string().min(1).default('application/octet-stream'),
    bytesBase64: z.string().optional(),
    contentBase64: z.string().optional(),
    bytes: z.string().optional(),
    leaseId: z.string().min(1).optional(),
    fencingToken: z.number().int().positive().optional(),
    checksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/iu)
      .optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    testId: z.string().min(1).nullable().optional(),
    expiresAt: z.string().min(1).nullable().optional(),
    legalHold: z.boolean().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/**
 * The event types this boundary forwards to the realtime bus. Anything outside
 * the set is still persisted — it is only not republished, so an unknown event
 * can never be laundered into a canonical one.
 */
export const CANONICAL_EVENT_TYPES: ReadonlySet<RunEventType> = new Set(RunEventTypeSchema.options);

/**
 * Membership guard for the derived set.
 *
 * `Set.prototype.has` takes a `string` here, so it cannot narrow — which is why
 * the call site needed `type as CanonicalRealtimeEvent['type']`, and why adding a
 * name to the contract was a silent no-op. A predicate carries the narrowing the
 * gate was missing, so the cast is gone and the type flows from the contract.
 *
 * A type predicate is required rather than a plain `boolean` return: TypeScript
 * only narrows through a signature that names the narrowed type in its return.
 */
export function isCanonicalEventType(value: string): value is RunEventType {
  return CANONICAL_EVENT_TYPES.has(value as RunEventType);
}

/**
 * A real object schema. `z.record(z.string(), z.unknown())` let a client send
 * `{ total: "many" }`, which reached `integer('total')` and surfaced as an
 * unhandled Postgres `22P02` 500.
 */
export const SummarySchema = z.object({
  total: z.number().int().nonnegative().optional(),
  passed: z.number().int().nonnegative().optional(),
  failed: z.number().int().nonnegative().optional(),
  flaky: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
  blocked: z.number().int().nonnegative().optional(),
  unknown: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().nullable().optional(),
});

export const CompleteSchema = z
  .object({
    jobId: z.string().min(1).optional(),
    runId: z.string().min(1).optional(),
    attempt: z.number().int().positive().optional(),
    leaseId: z.string().min(1),
    fencingToken: z.number().int().positive(),
    status: z.string().min(1).optional(),
    phase: z
      .enum([
        'queued',
        'assigned',
        'preparing',
        'running',
        'collecting',
        'normalizing',
        'analyzing',
        'gate_evaluation',
        'complete',
        'completed',
        'cancelled',
        'timed_out',
        'runner_lost',
        'infra_failed',
        'config_failed',
        'blocked',
        'partial',
      ])
      .optional(),
    outcome: z
      .enum([
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
      ])
      .nullable()
      .optional(),
    summary: SummarySchema.optional(),
    tests: z
      .array(
        z.object({
          id: z.string().min(1).optional(),
          testId: z.string().min(1).optional(),
          title: z.string().default(''),
          file: z.string().nullable().optional(),
          status: z.enum([
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
          ]),
          durationMs: z.number().nonnegative().nullable().optional(),
          error: z
            .object({ code: z.string().optional(), message: z.string() })
            .nullable()
            .optional(),
        }),
      )
      .optional(),
    error: z.object({ code: z.string().optional(), message: z.string() }).nullable().optional(),
  })
  .passthrough();

export interface ExecutionRoutesOptions {
  store: ExecutionStore;
  legacyRepository?: RunRepository;
  workspaceId?: string;
  runnerRegistrationSecret?: string;
  registrationSecret?: string;
  requireIdempotencyKey?: boolean;
  bus?: RealtimeBus;
  /** Largest decoded artifact a runner may upload. */
  maxArtifactBytes?: number;
}
