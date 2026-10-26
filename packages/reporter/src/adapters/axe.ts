import { createHash } from 'node:crypto';
import type {
  CanonicalFinding,
  DimensionMetric,
  FindingSeverity,
  HealthTool,
} from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES, MAX_SARIF_RESULTS } from './sarif.js';
import { type Json, record, list, text, strings } from './json-fields.js';

/**
 * axe-core results — one page's `AxeResults` object, or the array of them that
 * `@axe-core/cli` and a multi-page Playwright run write — as Accessibility findings and a
 * pass-rate metric.
 *
 * ## Severity is one band below axe's impact
 *
 * | axe impact | severity | why                                                         |
 * | ---------- | -------- | ----------------------------------------------------------- |
 * | critical   | high     | blocks some users entirely — but `critical` here is reserved for what is exploitable |
 * | serious    | medium   | a serious barrier with a workaround                          |
 * | moderate   | low      |                                                             |
 * | minor      | info     | an annoyance                                                |
 *
 * The scale is shared with Security and Dependencies, where `critical` means an exploitable
 * vulnerability. axe's impact describes the user, not an attacker; mapping it one band down
 * keeps a missing `alt` from outranking a remote-code-execution CVE in the findings table,
 * while the order within accessibility is axe's own. A node's impact wins over its rule's,
 * because axe reports the rule's impact as the worst of its nodes; an impact axe did not
 * give, or one this table does not know, reads as `low`.
 *
 * ## Identity
 *
 * One finding per rule per node selector per page. The fingerprint is the page's URL
 * **path** (no origin, no query), the rule and the selector, so the same rule failing on
 * the same element is one finding across re-uploads, and across staging and production
 * hosts. `path` keeps the full URL for the reader. A node's `target` is a list of frame
 * selectors (`|` between them here) each of which may be a list through shadow roots
 * (`>>>`), and is written out whole so `iframe#help | my-widget >>> button.close` is not
 * confused with a `button.close` on the page itself.
 *
 * ## The metric
 *
 * `axe-pass-rate` is passing rules over passing plus violated rules, summed over every page
 * that reported `passes` — a result produced with `resultTypes: ['violations']` cannot say
 * what passed, so it contributes findings and no rate. A page set on which no rule ran
 * produces no metric rather than a 0 or a 100.
 */
export const AXE_ADAPTER_VERSION = '1';

export interface AxeReport {
  findings: CanonicalFinding[];
  metrics: DimensionMetric[];
  truncated: boolean;
}

const IMPACT_SEVERITY: Readonly<Record<string, FindingSeverity>> = {
  critical: 'high',
  serious: 'medium',
  moderate: 'low',
  minor: 'info',
};

function decode(input: Uint8Array): Json[] {
  if (input.byteLength > MAX_HEALTH_REPORT_BYTES) {
    throw new HealthReportError(
      'too_large',
      `axe results are larger than ${String(MAX_HEALTH_REPORT_BYTES)} bytes`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new HealthReportError('malformed', 'axe results are not valid JSON');
  }
  const pages = Array.isArray(parsed) ? parsed : [parsed];
  if (pages.length === 0) throw new HealthReportError('malformed', 'axe results are empty');
  return pages.map((page) => {
    const result = record(page);
    if (result === null || !Array.isArray(result['violations'])) {
      throw new HealthReportError('malformed', 'an axe result has no violations array');
    }
    return result;
  });
}

/** Frames with `|`, shadow roots with `>>>`; an empty target is the page itself. */
function selectorOf(node: Json): string {
  return list(node['target'])
    .map((part) => (Array.isArray(part) ? strings(part).join(' >>> ') : strings([part]).join('')))
    .filter((part) => part.length > 0)
    .join(' | ');
}

function urlPath(url: string | null): string {
  if (url === null) return '';
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function toolOf(page: Json): HealthTool {
  const engine = record(page['testEngine']);
  return {
    name: text(engine?.['name'])?.slice(0, 100) ?? 'axe-core',
    version: text(engine?.['version'])?.slice(0, 100) ?? null,
  };
}

function pageFindings(page: Json): CanonicalFinding[] {
  const url = text(page['url']);
  const pagePath = urlPath(url);
  const tool = toolOf(page).name;
  return list(page['violations']).flatMap((raw) => {
    const violation = record(raw);
    const id = text(violation?.['id']);
    if (violation === null || id === null) return [];
    const help = text(violation['help']) ?? text(violation['description']) ?? id;
    const nodes = list(violation['nodes']).map(record);
    const targets = nodes.length === 0 ? [{}] : nodes.filter((node): node is Json => node !== null);
    return targets.map((node): CanonicalFinding => {
      const selector = selectorOf(node);
      const impact = text(node['impact']) ?? text(violation['impact']) ?? '';
      return {
        fingerprint: createHash('sha256')
          .update(`axe\u0000${pagePath}\u0000${id}\u0000${selector}`)
          .digest('hex'),
        tool,
        ruleId: `axe/${id}`.slice(0, 300),
        kind: 'issue',
        severity: IMPACT_SEVERITY[impact] ?? 'low',
        dimension: 'accessibility',
        path: url?.slice(0, 1000) ?? null,
        line: null,
        message: (selector.length === 0 ? help : `${help}: ${selector}`).slice(0, 4000),
        helpUri: text(violation['helpUrl'])?.slice(0, 2000) ?? null,
        fixAvailable: null,
      };
    });
  });
}

function passRate(pages: readonly Json[]): DimensionMetric[] {
  const measured = pages.filter((page) => Array.isArray(page['passes']));
  let passed = 0;
  let violated = 0;
  for (const page of measured) {
    passed += list(page['passes']).length;
    violated += list(page['violations']).filter((raw) => text(record(raw)?.['id']) !== null).length;
  }
  const rules = passed + violated;
  const [first] = measured;
  if (first === undefined || rules === 0) return [];
  return [
    {
      dimension: 'accessibility',
      metric: 'axe-pass-rate',
      tool: toolOf(first),
      score: (passed / rules) * 100,
      summary: `${String(passed)} of ${String(rules)} axe rules passed across ${String(
        measured.length,
      )} page${measured.length === 1 ? '' : 's'}`,
    },
  ];
}

/**
 * @throws HealthReportError `too_large` over the byte cap; `malformed` for invalid JSON, an
 *   empty array, or a result without a `violations` array.
 */
export function parseAxeResults(input: Uint8Array): AxeReport {
  const pages = decode(input);
  const findings = new Map<string, CanonicalFinding>();
  let truncated = false;
  for (const finding of pages.flatMap(pageFindings)) {
    // The same rule on the same element is one finding, however many times it was reported.
    if (findings.has(finding.fingerprint)) continue;
    if (findings.size >= MAX_SARIF_RESULTS) {
      truncated = true;
      break;
    }
    findings.set(finding.fingerprint, finding);
  }
  return { findings: [...findings.values()], metrics: passRate(pages), truncated };
}
