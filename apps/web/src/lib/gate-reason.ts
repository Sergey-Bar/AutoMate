/**
 * A quality-gate reason, read as a sentence.
 *
 * `evaluateQualityGate` (apps/api/src/execution/quality-gate.ts) writes machine codes —
 * `browser:FAILED`, `threshold:PASS_RATE; observed=33.33; required=100; rule=…` — which
 * are right for a log and wrong for the first line a person reads about a failed run. This
 * turns every shape the gate writes into prose and leaves anything else exactly as the
 * server wrote it, so a new code is shown verbatim rather than mistranslated. The caller
 * keeps the raw code on hover.
 */

const DOMAIN_LABEL: Record<string, string> = {
  browser: 'Browser tests',
  api: 'API tests',
  mobile: 'Mobile tests',
  performance: 'Performance tests',
  security: 'Security checks',
  accessibility: 'Accessibility checks',
  other: 'Other checks',
};

const DOMAIN_SHORT: Record<string, string> = {
  browser: 'Browser',
  api: 'API',
  mobile: 'Mobile',
  performance: 'Performance',
  security: 'Security',
  accessibility: 'Accessibility',
  other: 'Other',
};

const DOMAIN_STATE: Record<string, string> = {
  FAILED: 'failed',
  PASSED: 'passed',
  WARNING: 'warned',
  UNKNOWN: 'have no verdict',
  NOT_CONFIGURED: 'not configured',
  MISSING_EVIDENCE: 'are missing required evidence',
};

/** Whole reasons with no parameters: the run's own state, evidence and product failures. */
const FIXED: Record<string, string> = {
  'product_failure:FAILED_TEST_COUNT': 'Tests failed',
  // The gate emits this for a failed outcome or a blocked phase, not only for a test.
  'product_failure:TEST_FAILURE': 'The run failed',
  'evidence:NO_TESTS': 'No tests ran',
  'evidence:MISSING_REQUIRED_EVIDENCE': 'Required evidence is missing',
  'runner_lost:RUNNER_INFRASTRUCTURE': 'The runner was lost',
  'infra_failed:RUNNER_INFRASTRUCTURE': 'The runner infrastructure failed',
  'config_failed:CONFIGURATION': 'The run was misconfigured',
  'cancelled:EXECUTION_CANCELLED': 'The run was cancelled',
  'timed_out:EXECUTION_TIMEOUT': 'The run timed out',
};

/** `code; key=value; key="quoted value"` — the shape the gate's `refusal()` writes. */
function parse(raw: string): { code: string; params: Map<string, string> } {
  const [code = '', ...parts] = raw.split(';').map((part) => part.trim());
  const params = new Map<string, string>();
  for (const part of parts) {
    const at = part.indexOf('=');
    if (at > 0) params.set(part.slice(0, at), part.slice(at + 1).replace(/^"(.*)"$/u, '$1'));
  }
  return { code, params };
}

function minutes(ms: string): string {
  return `${(Number(ms) / 60_000).toFixed(1)} min`;
}

function threshold(metric: string, params: Map<string, string>): string | null {
  const observed = params.get('observed');
  const required = params.get('required');
  const max = params.get('max');
  if (observed === undefined) return null;
  if (metric === 'PASS_RATE' && required !== undefined)
    return `Pass rate ${observed}%, needs ${required}%`;
  if (metric === 'FLAKY_RATE' && max !== undefined) return `Flaky rate ${observed}%, limit ${max}%`;
  if (metric === 'DURATION' && max !== undefined && params.get('unit') === 'ms')
    return `Duration ${minutes(observed)}, limit ${minutes(max)}`;
  if (metric === 'PER_RULE_PASS_RATE' && required !== undefined) {
    const domain = DOMAIN_SHORT[params.get('domain') ?? ''];
    return domain === undefined ? null : `${domain} pass rate ${observed}%, needs ${required}%`;
  }
  return null;
}

export function describeGateReason(raw: string): string {
  const fixed = FIXED[raw];
  if (fixed !== undefined) return fixed;
  const { code, params } = parse(raw);
  const [prefix, state, ...rest] = code.split(':');
  if (prefix === undefined || state === undefined || rest.length > 0) return raw;
  if (prefix === 'threshold') return threshold(state, params) ?? raw;
  const domain = DOMAIN_LABEL[prefix];
  const word = DOMAIN_STATE[state];
  return domain !== undefined && word !== undefined && params.size === 0
    ? `${domain} ${word}`
    : raw;
}
