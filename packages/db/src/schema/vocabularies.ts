/**
 * The controlled vocabularies, in a module that imports nothing.
 *
 * These constants used to live at the top of `execution.ts`, which meant `dashboard.ts`
 * could not use them: `execution.ts:18` imports `results`, `runs`, `runners` and
 * `workspaces` from `dashboard.ts`, so a reciprocal import would be a cycle. That is
 * why `runs.gateStatus` ended up with a hand-written three-value list that had drifted
 * from the contract — `passed`/`failed`/`skipped`, where the contract is
 * `passed`/`failed`/`warning`/`unknown`/`not_evaluated` (ledger P-5). The two lists
 * could not be compared by the compiler, so nothing noticed that `skipped` is not a
 * contract value and that three of the five contract values were rejected outright.
 *
 * A leaf module fixes it structurally rather than by a second hand-written list.
 * `execution.ts` re-exports every name from here, so nothing downstream of
 * `@automate/db` changes, and `dashboard.ts` can now import the same constant the
 * contract is generated from. One vocabulary, one place to widen it, and the compiler
 * compares the two columns instead of a reader doing it.
 *
 * **The contract is the authority.** These mirror `GateStatusSchema` and friends in
 * `@automate/shared-contracts`, which is what the API and the client both validate
 * against. A value here that the contract does not define is a value the product
 * cannot represent, and a value the contract defines that is missing here is a value
 * the database rejects — which is exactly the state this module exists to end.
 */

export const EXECUTION_JOB_STATES = [
  'queued',
  'leased',
  'completed',
  'failed',
  'cancelled',
  'requeued',
] as const;
export type ExecutionJobState = (typeof EXECUTION_JOB_STATES)[number];

export const ARTIFACT_KINDS = [
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
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const GATE_STATUSES = ['passed', 'failed', 'warning', 'unknown', 'not_evaluated'] as const;
export type GateStatus = (typeof GATE_STATUSES)[number];

export const RELEASE_DECISIONS = ['ready', 'ready_with_warnings', 'blocked', 'unknown'] as const;
export type ReleaseDecision = (typeof RELEASE_DECISIONS)[number];

export const QUALITY_DOMAINS = [
  'browser',
  'api',
  'mobile',
  'performance',
  'security',
  'accessibility',
  'other',
] as const;
export type QualityDomain = (typeof QUALITY_DOMAINS)[number];

export const DOMAIN_STATUSES = [
  'passed',
  'failed',
  'warning',
  'unknown',
  'not_configured',
  'not_implemented',
] as const;
export type DomainStatus = (typeof DOMAIN_STATUSES)[number];

export type QualityPolicyRule = {
  domain: QualityDomain;
  required: boolean;
  minimumPassRate?: number;
  requiredArtifactKinds: ArtifactKind[];
};
