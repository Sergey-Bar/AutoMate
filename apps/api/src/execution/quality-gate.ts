import { createHash } from 'node:crypto';
import type {
  DomainName,
  DomainStatus,
  ExecutionRun,
  GateEvaluation,
  QualityPolicy,
} from './types.js';

export const DEFAULT_REQUIRED_DOMAINS: DomainName[] = ['browser'];

export const DEFAULT_QUALITY_POLICY: Omit<QualityPolicy, 'id' | 'createdAt' | 'updatedAt'> = {
  workspaceId: 'default-workspace',
  name: 'Universal QA default',
  version: '1',
  hash: '',
  requiredDomains: DEFAULT_REQUIRED_DOMAINS,
  browserPassRateThreshold: 100,
  maxFlakyRate: 0,
  maxDurationMs: null,
  rules: [],
};

export type GatePolicy = Omit<QualityPolicy, 'id' | 'hash' | 'createdAt' | 'updatedAt'> &
  Partial<Pick<QualityPolicy, 'id' | 'hash'>>;

export interface QualityGateInput {
  run: Pick<ExecutionRun, 'outcome'> & Partial<ExecutionRun>;
  domainStatuses?: Partial<Record<DomainName, DomainStatus>>;
  policy: GatePolicy;
  evaluatedAt?: string;
}

export interface QualityGateResult {
  status: GateEvaluation['status'];
  decision: GateEvaluation['decision'] | 'not_ready';
  reasons: string[];
  evidenceRefs: string[];
  domainStatuses: Record<DomainName, DomainStatus>;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .filter((key) => object[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
    .join(',')}}`;
}

export function policyDigest(
  policy: Pick<
    QualityPolicy,
    | 'workspaceId'
    | 'name'
    | 'version'
    | 'requiredDomains'
    | 'browserPassRateThreshold'
    | 'maxFlakyRate'
    | 'maxDurationMs'
  > &
    Partial<Pick<QualityPolicy, 'rules'>>,
): string {
  return createHash('sha256').update(stable(policy)).digest('hex');
}

function defaultDomains(
  run: Pick<ExecutionRun, 'outcome'> & Partial<ExecutionRun>,
): Record<DomainName, DomainStatus> {
  const browser: DomainStatus =
    run.outcome === 'passed'
      ? 'passed'
      : run.outcome === 'failed'
        ? 'failed'
        : run.outcome === 'partial'
          ? 'warning'
          : 'unknown';
  return {
    browser,
    api: 'not_configured',
    mobile: 'not_configured',
    performance: 'not_configured',
    security: 'not_configured',
    accessibility: 'not_configured',
    other: 'not_configured',
  };
}

function reasonForDomain(domain: DomainName, status: DomainStatus): string | null {
  if (status === 'not_configured' || status === 'not_implemented')
    return `${domain}:NOT_CONFIGURED`;
  if (status === 'unknown') return `${domain}:UNKNOWN`;
  return null;
}

function runInfraReason(run: Pick<ExecutionRun, 'outcome'> & Partial<ExecutionRun>): string | null {
  if (run.phase === 'runner_lost' || run.outcome === 'runner_lost')
    return 'runner_lost:RUNNER_INFRASTRUCTURE';
  if (run.phase === 'infra_failed' || run.outcome === 'infra_failed')
    return 'infra_failed:RUNNER_INFRASTRUCTURE';
  if (run.phase === 'config_failed' || run.outcome === 'config_failed')
    return 'config_failed:CONFIGURATION';
  if (run.phase === 'cancelled' || run.outcome === 'cancelled')
    return 'cancelled:EXECUTION_CANCELLED';
  if (run.phase === 'timed_out' || run.outcome === 'timed_out')
    return 'timed_out:EXECUTION_TIMEOUT';
  return null;
}

export function evaluateQualityGate(input: QualityGateInput): QualityGateResult {
  const run = input.run;
  const policy = input.policy;
  const summary = run.summary ?? {
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    skipped: 0,
    blocked: 0,
    unknown: 0,
    durationMs: null,
  };
  const artifacts = run.artifacts ?? [];
  const domains = { ...defaultDomains(run), ...(input.domainStatuses ?? {}) } as Record<
    DomainName,
    DomainStatus
  >;
  const reasons: string[] = [];
  const evidenceRefs = [
    ...new Set(
      (run.rawEvidenceRefs ?? []).concat(
        (run.artifacts ?? []).map((artifact) => `artifact:${artifact.id}`),
      ),
    ),
  ].sort();
  const infraReason = runInfraReason(run);
  if (infraReason) reasons.push(infraReason);
  if (run.outcome === 'failed' || run.phase === 'blocked')
    reasons.push('product_failure:TEST_FAILURE');
  if (summary.failed > 0) reasons.push('product_failure:FAILED_TEST_COUNT');
  if (summary.total > 0) {
    const passRate = (summary.passed / summary.total) * 100;
    if (passRate < policy.browserPassRateThreshold)
      reasons.push(`threshold:PASS_RATE_${passRate.toFixed(2)}`);
    const flakyRate = (summary.flaky / summary.total) * 100;
    if (flakyRate > policy.maxFlakyRate)
      reasons.push(`threshold:FLAKY_RATE_${flakyRate.toFixed(2)}`);
    if (
      policy.maxDurationMs !== null &&
      summary.durationMs !== null &&
      summary.durationMs > policy.maxDurationMs
    )
      reasons.push('threshold:DURATION');
  }
  const requiredDomains = [
    ...new Set([
      ...policy.requiredDomains,
      ...policy.rules.filter((rule) => rule.required).map((rule) => rule.domain),
    ]),
  ];
  if (
    requiredDomains.includes('browser') &&
    domains.browser === 'passed' &&
    evidenceRefs.length === 0
  ) {
    reasons.push('evidence:MISSING_REQUIRED_EVIDENCE');
  }
  for (const domain of requiredDomains) {
    const status = domains[domain] ?? 'unknown';
    const reason = reasonForDomain(domain, status);
    if (reason) reasons.push(reason);
    if (status === 'failed') reasons.push(`${domain}:FAILED`);
    if (status === 'warning') reasons.push(`${domain}:WARNING`);
  }
  for (const rule of policy.rules) {
    if (!rule.required) continue;
    const domain = domains[rule.domain] ?? 'unknown';
    if (
      rule.minimumPassRate !== undefined &&
      domain === 'passed' &&
      summary.total > 0 &&
      (summary.passed / summary.total) * 100 < rule.minimumPassRate
    )
      reasons.push(`threshold:${rule.domain.toUpperCase()}_PASS_RATE`);
    if (
      rule.requiredArtifactKinds.length > 0 &&
      !rule.requiredArtifactKinds.every((kind) =>
        artifacts.some((artifact) => artifact.kind === kind),
      )
    )
      reasons.push(`${rule.domain}:MISSING_EVIDENCE`);
  }
  const hasInfra = reasons.some(
    (reason) => reason.endsWith('RUNNER_INFRASTRUCTURE') || reason.endsWith('CONFIGURATION'),
  );
  const hasProduct = reasons.some(
    (reason) => reason.startsWith('product_failure:') || reason.startsWith('threshold:'),
  );
  const hasUnknown = reasons.some(
    (reason) =>
      reason.endsWith(':UNKNOWN') ||
      reason.endsWith(':NOT_CONFIGURED') ||
      reason.endsWith(':MISSING_EVIDENCE') ||
      reason.endsWith('evidence:MISSING_REQUIRED_EVIDENCE'),
  );
  const hasWarning = reasons.some((reason) => reason.endsWith(':WARNING'));
  let status: GateEvaluation['status'];
  let decision: GateEvaluation['decision'] | 'not_ready';
  // A run that claims a pass while executing nothing is the case every
  // threshold above silently skipped, because each one sits behind
  // `if (summary.total > 0)`. `NO_TESTS` is a product failure, not an unknown:
  // a green claim with nothing behind it is exactly what this product promises
  // never to publish.
  if (run.outcome === 'passed' && summary.total === 0 && (run.tests?.length ?? 0) === 0) {
    reasons.push('evidence:NO_TESTS');
  }
  if (hasInfra || hasProduct || reasons.includes('evidence:NO_TESTS')) {
    status = 'failed';
    decision = 'blocked';
  } else if (hasUnknown) {
    status = 'unknown';
    decision = 'not_ready';
  } else if (hasWarning) {
    status = 'warning';
    decision = 'ready_with_warnings';
  } else {
    status = 'passed';
    decision = 'ready';
  }
  return {
    status,
    decision,
    reasons: [...new Set(reasons)].sort(),
    evidenceRefs,
    domainStatuses: domains,
  };
}

export interface GateEvaluationInput extends Omit<QualityGateInput, 'run'> {
  run: ExecutionRun;
  id?: string;
}

export const evaluateGate = evaluateQualityGate;

export function createGateEvaluation(input: GateEvaluationInput): GateEvaluation {
  const result = evaluateQualityGate(input);
  const evaluatedAt =
    input.evaluatedAt ?? input.run.completedAt ?? input.run.updatedAt ?? '1970-01-01T00:00:00.000Z';
  const policyHash = input.policy.hash || policyDigest(input.policy);
  return {
    // The hash belongs in the id. The upsert conflict target in
    // `DrizzleExecutionStore.saveGate` is `[runId, releaseId, policyId,
    // policyVersion, policyHash]`, so an id without it is a *different* primary
    // key for the same row — the first policy update therefore raised a unique
    // violation instead of updating the existing evaluation.
    id:
      input.id ??
      `${input.run.id}:${input.policy.id ?? 'default-policy'}:${input.policy.version}:${policyHash}`,
    runId: input.run.id,
    releaseId: input.run.releaseId,
    policyId: input.policy.id ?? 'default-policy',
    policyVersion: input.policy.version,
    policyHash,
    status: result.status,
    decision: result.decision === 'not_ready' ? 'unknown' : result.decision,
    reasons: result.reasons,
    evidenceRefs: result.evidenceRefs,
    domainStatuses: result.domainStatuses,
    evaluatedAt,
  };
}

export function defaultPolicy(
  workspaceId: string,
): Omit<QualityPolicy, 'id' | 'createdAt' | 'updatedAt'> {
  return { ...DEFAULT_QUALITY_POLICY, workspaceId, requiredDomains: [...DEFAULT_REQUIRED_DOMAINS] };
}
