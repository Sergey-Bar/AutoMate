import { z } from 'zod/v4';

const StateSchema = z.enum([
  'queued',
  'leased',
  'running',
  'waiting_approval',
  'cancelling',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
]);
const Timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)));
const Digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const AutomationDefinitionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  tool: z.enum(['playwright', 'api', 'load', 'security', 'mobile', 'generic']),
  toolVersion: z.string().min(1),
  imageDigest: Digest,
  input: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int().positive(),
  maxAttempts: z.number().int().min(1).max(10),
  requiredCapabilities: z.array(z.string().min(1)),
});
export const ScheduleSchema = z.object({
  id: z.string().min(1),
  automationId: z.string().min(1),
  cron: z.string().min(1),
  timezone: z.string().min(1),
  enabled: z.boolean(),
  nextRunAt: Timestamp.optional(),
  misfirePolicy: z.enum(['skip', 'run_once', 'catch_up']),
});
export const JobEnvelopeSchema = z.object({
  executionId: z.string().min(1),
  attempt: z.number().int().min(1),
  workspaceId: z.string().min(1),
  automationId: z.string().min(1),
  definitionHash: Digest,
  scheduledFor: Timestamp,
  state: StateSchema,
  cancelRequested: z.boolean(),
});
export const RunnerSyncRequestSchema = z.object({
  runnerId: z.string().min(1),
  instanceId: z.string().min(1),
  protocolVersion: z.literal('1'),
  capabilities: z.array(z.string().min(1)),
  activeJobIds: z.array(z.string().min(1)),
});
export const RunnerEventSchema = z.object({
  eventId: z.string().min(1),
  jobId: z.string().min(1),
  leaseId: z.string().min(1),
  fencingToken: z.number().int().min(1),
  sequence: z.number().int().min(1),
  type: z.enum(['progress', 'artifact', 'terminal']),
  payload: z.record(z.string(), z.unknown()),
});
export const JobStateSchema = StateSchema;
export type AutomationDefinition = z.infer<typeof AutomationDefinitionSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;
export type RunnerSyncRequest = z.infer<typeof RunnerSyncRequestSchema>;
export type RunnerEvent = z.infer<typeof RunnerEventSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export { Digest, StateSchema, Timestamp };
