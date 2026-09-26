import {
  ArtifactDescriptorSchema as CanonicalArtifactDescriptorSchema,
  JobCompletionSchema as CanonicalJobCompletionSchema,
  RunEventEnvelopeSchema,
  type ArtifactDescriptor,
  type JobCompletion,
  type RunEventEnvelope,
} from '@automate/shared-contracts';
import { z } from 'zod/v4';

const IdSchema = z.string().min(1);
const IsoSchema = z.string().refine((value) => !Number.isNaN(Date.parse(value)));

export const RunnerRegistrationRequestSchema = z.object({
  runnerId: IdSchema.optional(),
  name: z.string().min(1),
  version: z.string().min(1),
  os: z.string().min(1),
  arch: z.string().min(1),
  capabilities: z.array(IdSchema),
  labels: z.array(IdSchema).default([]),
  slots: z.number().int().min(1).max(32),
  /**
   * The credential currently held for this runner id. The API refuses to
   * rotate an already-registered runner without it, so a restart sends the
   * token it already has and an impersonator cannot claim the id.
   */
  rotationToken: z.string().min(1).optional(),
  protocolVersion: z.literal('1').default('1'),
});

export const RunnerManifestSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  version: z.string().min(1),
  os: z.string().min(1),
  arch: z.string().min(1),
  capabilities: z.array(IdSchema),
  labels: z.array(IdSchema),
  slots: z.number().int().min(1),
});

export const RunnerRegistrationSchema = z.object({
  runnerId: IdSchema,
  token: z.string().min(1),
  expiresAt: IsoSchema,
  manifest: RunnerManifestSchema,
});

export const RunnerHeartbeatRequestSchema = z.object({
  leaseId: z.string().min(1).optional(),
  activeJobs: z.array(IdSchema).default([]),
  metrics: z.record(z.string(), z.unknown()).optional(),
});

export const RunnerHeartbeatSchema = z
  .object({
    runnerId: IdSchema,
    health: z.enum(['healthy', 'degraded', 'draining', 'offline', 'revoked']),
    lastHeartbeatAt: IsoSchema,
    activeJobIds: z.array(IdSchema).default([]),
    cancelledJobIds: z.array(IdSchema).default([]),
    cancelRequestedJobIds: z.array(IdSchema).default([]),
  })
  .passthrough();

export const RunnerClaimRequestSchema = z.object({
  capabilities: z.array(IdSchema).default([]),
  labels: z.array(IdSchema).default([]),
  availableAt: IsoSchema.optional(),
});

export const JobClaimSchema = z.object({
  jobId: IdSchema,
  runId: IdSchema,
  attempt: z.number().int().min(1),
  leaseId: IdSchema,
  fencingToken: z.number().int().min(1),
  timeoutMs: z.number().int().positive(),
  spec: z.record(z.string(), z.unknown()),
  availableAt: IsoSchema,
  leaseExpiresAt: IsoSchema,
});

export const ExecutionEventInputSchema = RunEventEnvelopeSchema;

export const JobEventBatchSchema = z.object({
  jobId: IdSchema,
  runId: IdSchema,
  leaseId: IdSchema,
  fencingToken: z.number().int().min(1),
  events: z.array(ExecutionEventInputSchema).min(1).max(100),
  sentAt: IsoSchema.optional(),
});

export const EventApplyResultSchema = z.object({
  eventId: IdSchema,
  sequence: z.number().int().min(1),
  status: z.enum(['accepted', 'duplicate', 'conflict']),
  hash: z.string().optional(),
  reason: z.string().optional(),
});

export const JobEventBatchResponseSchema = z.object({
  results: z.array(EventApplyResultSchema),
});

export const ArtifactUploadSchema = z.object({
  leaseId: IdSchema,
  fencingToken: z.number().int().min(1),
  kind: z.string().min(1),
  name: z.string().min(1),
  testId: z.string().min(1).nullable().default(null),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  metadata: z.record(z.string(), z.unknown()).default({}),
  contentBase64: z.string(),
});

export const ArtifactDescriptorSchema = CanonicalArtifactDescriptorSchema;
export const JobCompletionSchema = CanonicalJobCompletionSchema;

export type RunnerRegistrationRequest = z.infer<typeof RunnerRegistrationRequestSchema>;
export type RunnerRegistration = z.infer<typeof RunnerRegistrationSchema>;
export type RunnerHeartbeatRequest = z.infer<typeof RunnerHeartbeatRequestSchema>;
export type RunnerHeartbeat = z.infer<typeof RunnerHeartbeatSchema>;
export type RunnerClaimRequest = z.infer<typeof RunnerClaimRequestSchema>;
export type JobClaim = z.infer<typeof JobClaimSchema>;
export type ExecutionEventInput = RunEventEnvelope;
export type EventApplyResult = z.infer<typeof EventApplyResultSchema>;
export type ArtifactUpload = z.infer<typeof ArtifactUploadSchema>;
export type { ArtifactDescriptor, JobCompletion };

export class RunnerApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Runner API request failed (${status}, ${code})`);
    this.name = 'RunnerApiError';
  }
}
