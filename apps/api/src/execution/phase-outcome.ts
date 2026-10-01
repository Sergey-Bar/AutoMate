/**
 * Re-exported from `@automate/orchestration`, where it now lives.
 *
 * It was here alone until `apps/worker`'s `completeJob` was found writing
 * `runs.phase`, `runs.outcome` and `runs.status` from a hand-written table while
 * this file held the derivation that makes the pair unreachable by construction.
 * Two copies of one rule meant nothing compared them, so the fix was to have one.
 *
 * The import path is not the defect. Every existing importer and both test files
 * keep it; changing six call sites to buy nothing is not a fix.
 */
export {
  COMPLETE_OUTCOMES,
  deriveRunState,
  isRequestablePhase,
  isTerminalPhase,
  PHASE_OUTCOME,
  RUN_PHASES,
  TERMINAL_PHASES,
  type ContractRunStatus,
  type DerivedRunState,
  type RunStatus,
} from '@automate/orchestration';
