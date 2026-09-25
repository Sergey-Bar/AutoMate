// Zod v4 schemas — canonical validation source for TypeScript consumers
export * from './zod.js';

// Domain schemas — expanded Automate contract surface
export * from './auth.js';
export * from './ai.js';
export * from './conversations.js';
export * from './connectors.js';
export * from './test-results.js';
export * from './durable-realtime.js';
export * from './reporter-events.js';
export * from './realtime-events.js';
export * from './agents.js';
export {
  LEGACY_FLAT_V1_CONTRACT_ID,
  RUN_CONTRACT_ID,
  RUN_CONTRACT_VERSION,
  RUNNER_PROTOCOL_VERSION,
} from './canonical-reporting.js';
export {
  AttemptSchema as CanonicalAttemptSchema,
  CompletenessSchema as CanonicalCompletenessSchema,
  EvidenceReferenceSchema as CanonicalEvidenceReferenceSchema,
  InstallationSessionSchema as InstallationSessionSchema,
  ProofSchema as CanonicalProofSchema,
  REPORTER_EVENT_TYPES as CANONICAL_REPORTER_EVENT_TYPES,
  RealtimeEnvelopeSchema as CanonicalRealtimeEnvelopeSchema,
  ReporterEventSchema as CanonicalReporterEventSchema,
  RetentionSchema as CanonicalRetentionSchema,
  RunResultSchema as CanonicalRunResultSchema,
  StatusSchema as CanonicalStatusSchema,
} from './canonical-reporting.js';
export type {
  Attempt as CanonicalAttempt,
  Completeness as CanonicalCompleteness,
  EvidenceReference as CanonicalEvidenceReference,
  InstallationSession,
  Proof as CanonicalProof,
  RealtimeEnvelope as CanonicalRealtimeEnvelope,
  ReporterEvent as CanonicalReporterEvent,
  ReporterEventType as CanonicalReporterEventType,
  Retention as CanonicalRetention,
  RunResult as CanonicalRunResult,
} from './canonical-reporting.js';
export * from './orchestration.js';
export * from './execution.js';
export * from './legacy-reporter-adapter.js';
