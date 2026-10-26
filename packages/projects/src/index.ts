// @automate/projects — the project registry's pure half: ecosystem detection,
// the declared-override merge, and (later) the derived QA Health Score.
//
// Nothing here holds a database handle or a filesystem handle. `detectProject`
// takes a `RepositoryView` and the score takes a repository port, so the same
// code runs in the API, in the migration rehearsal, and in a fixture test
// without a container.

export {
  AUTOMATE_CONFIG_FILENAME,
  AutomateConfigSchema,
  ProjectProfileSchema,
  type AutomateConfig,
  type ProjectProfile,
  type ResolvedProfile,
} from './profile.js';
export { mergeConfig, profileFromDetection } from './config.js';
export { DETECTOR_VERSION, detectProject, type DetectResult } from './detect/index.js';
export { scanRepository } from './scan/index.js';
export {
  DEFAULT_IGNORED,
  fileSystemView,
  literalView,
  type RepositoryView,
} from './detect/repository-view.js';
export {
  ArtifactGlobSchema,
  COVERAGE_FORMATS,
  CommandCandidateSchema,
  CoverageFormatSchema,
  CoverageGlobSchema,
  ECOSYSTEMS,
  EcosystemDetectionSchema,
  EcosystemSchema,
  FrameworkSignalSchema,
  RESULT_FORMATS,
  ResultFormatSchema,
  type ArtifactGlob,
  type CommandCandidate,
  type CoverageFormat,
  type CoverageGlob,
  type Ecosystem,
  type EcosystemDetection,
  type FrameworkSignal,
  type ResultFormat,
} from './detect/types.js';
export {
  PYRAMID_LAYERS,
  PYRAMID_ROW,
  SCORE_CATEGORIES,
  SCORE_SURFACES,
  isScoreCategory,
  type PyramidLayer,
  type ScoreCategory,
  type ScoreRowId,
  type ScoreSurface,
} from './vocabulary.js';
export { score, type Gap, type QaScore, type ScoreProvenance } from './score/index.js';
export { diffScores } from './score/diff.js';
export {
  DEFAULT_WEIGHTS,
  cellKey,
  type CanonicalTestResult,
  type CoverageSummary,
  type RunRecord,
  type ScoreInputs,
  type ScoreWeights,
  type TestOutcome,
} from './score/types.js';
export type { CellComponents, CellInputs } from './score/cell.js';
export {
  HEALTH_OUTPUT_PREFIX,
  HEALTH_SCANNERS,
  healthScannersFor,
  type HealthScanner,
  type RepositorySource,
} from './health/scanners.js';
export { CODEOWNERS_PATHS, ownerOf, parseCodeowners, type OwnerRule } from './health/codeowners.js';
export {
  DEFAULT_MAX_NEW_CRITICAL,
  evaluateHealthGate,
  type GateAgents,
  type GateAiGovernance,
  type GateDelivery,
  type GateDiffCoverage,
  type GateEvalSuite,
  type GateVerdict,
} from './health/gate.js';
export {
  AGENT_CONFIG_PATHS,
  AGENT_CONFIG_RULES,
  AGENT_CONFIG_TOOL,
  isAgentConfigPath,
  scanAgentConfig,
  redactServerUrl,
  stripJsonc,
  type AgentConfigFile,
  type AgentConfigRule,
  type AgentConfigRuleId,
  type AgentConfigScan,
  type McpServerEntry,
  type McpTransport,
} from './health/agent-config-scan.js';
export type { GeneralScore, ScoreRow, WeightedTerm } from './score/geometric.js';
export { weightedGeometric } from './score/geometric.js';
export {
  DEFAULT_HEALTH_WEIGHTS,
  FINDINGS_DECAY,
  GATE_CEILING,
  LETTER_FLOORS,
  METRIC_TARGET,
  SEVERITY_PENALTY,
  findingsScore,
  grade,
  letterFor,
  type FindingObservation,
  type FindingToolRun,
  type HealthInputs,
} from './health/grade.js';
export type { HollowReason, HollowVerdict } from './score/hollow.js';
export type { PyramidVerdict } from './score/pyramid.js';
export type { StructuralFinding, StructuralKind } from './score/structural.js';
export type { FlakyVerdict, OutcomeObservation } from './score/flaky.js';
