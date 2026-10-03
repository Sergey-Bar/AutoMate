export * from './adapter.js';
export {
  canonicalRunResult,
  runStatusFrom,
  type CanonicalAttempt,
  type CanonicalAttemptInput,
  type CanonicalRunResultInput,
} from './canonical-run-result.js';
export {
  canonicalRunStatusFrom,
  canonicalTestStatusFrom,
  flakinessFrom,
  INGESTED_PRODUCERS,
  TEST_STATUS_MAPPING,
  UNKNOWN_RAW_STATUS,
  type IngestedProducer,
} from './producer-status.js';
export * from './safe-path.js';
export * from './adapters/playwright-json.js';
export * from './adapters/junit-xml.js';
export * from './adapters/legacy-upload.js';
/**
 * k6 and ZAP are **run-result** adapters and go through `ProducerAdapter`, because a
 * load script's threshold breach and a scanner's high-risk alert are both verdicts about
 * a run.
 *
 * Coverage is deliberately **not** here in the same shape: `CoverageAdapter.parse`
 * returns a `CoverageReport` with no `status` and no `attempts`, because a percentage
 * is not a test and offering one to a result adapter produces a passing test that does
 * not exist. `packages/projects` records the same split on its side, in
 * `artifactGlobs` versus `coverageGlobs`.
 */
export * from './adapters/k6-json.js';
export * from './adapters/zap-xml.js';
export {
  COVERAGE_ADAPTERS,
  parseCoverage,
  surfaceCoverage,
  type CoverageAdapter,
  type CoverageFile,
  type CoverageFormat,
  type CoverageReport,
} from './adapters/coverage.js';
export * from './compatibility/legacy-reporter.js';
