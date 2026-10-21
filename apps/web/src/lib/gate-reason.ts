/**
 * A quality-gate reason, read as a sentence.
 *
 * The gate writes machine codes — `browser:FAILED`,
 * `threshold:PASS_RATE; observed=33.33; required=100; rule=…` — which are right for a log
 * and wrong for the first line a person reads about a failed run. This turns the shapes it
 * knows into prose and leaves anything else exactly as the server wrote it, so a new code
 * is shown verbatim rather than mistranslated. The caller keeps the raw code on hover.
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

const DOMAIN_STATE: Record<string, string> = {
  FAILED: 'failed',
  PASSED: 'passed',
  UNKNOWN: 'have no verdict',
  NOT_CONFIGURED: 'not configured',
};

const PRODUCT_FAILURE: Record<string, string> = {
  FAILED_TEST_COUNT: 'Tests failed',
  TEST_FAILURE: 'A test failed',
};

const THRESHOLD = /^threshold:([A-Z_]+);\s*observed=([\d.]+);\s*required=([\d.]+)/u;

function title(code: string): string {
  const words = code.toLowerCase().split('_');
  return [words[0]?.replace(/^./u, (first) => first.toUpperCase()), ...words.slice(1)].join(' ');
}

export function describeGateReason(raw: string): string {
  const threshold = THRESHOLD.exec(raw);
  if (threshold) {
    const [, metric = '', observed = '', required = ''] = threshold;
    return `${title(metric)} ${observed}%, needs ${required}%`;
  }
  const [prefix, code, ...rest] = raw.split(':');
  if (prefix === undefined || code === undefined || rest.length > 0) return raw;
  if (prefix === 'product_failure') return PRODUCT_FAILURE[code] ?? raw;
  const domain = DOMAIN_LABEL[prefix];
  const state = DOMAIN_STATE[code];
  return domain !== undefined && state !== undefined ? `${domain} ${state}` : raw;
}
