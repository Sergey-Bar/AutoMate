import { describe, expect, it } from 'vitest';
import { CanonicalFindingSchema, DimensionMetricSchema } from '@automate/shared-contracts';
import { HealthReportError, MAX_HEALTH_REPORT_BYTES, MAX_SARIF_RESULTS } from './sarif.js';
import { parseAxeResults } from './axe.js';

const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

const ENGINE = { name: 'axe-core', version: '4.10.0' };
const rule = (id: string) => ({ id, impact: null, nodes: [] });

/** Two pages, the shape `@axe-core/cli` and `@axe-core/playwright` write. */
const PAGES = [
  {
    testEngine: ENGINE,
    url: 'https://staging.example.com/login?next=%2F',
    timestamp: '2024-05-01T10:00:00.000Z',
    passes: [rule('document-title'), rule('html-has-lang'), rule('label')],
    incomplete: [],
    violations: [
      {
        id: 'color-contrast',
        impact: 'serious',
        help: 'Elements must meet minimum color contrast ratio thresholds',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=axeAPI',
        nodes: [
          { target: ['#submit'], impact: 'serious' },
          { target: ['iframe#help', ['my-widget', 'button.close']], impact: 'critical' },
        ],
      },
    ],
  },
  {
    testEngine: ENGINE,
    url: 'https://staging.example.com/dashboard',
    passes: [rule('document-title')],
    violations: [
      {
        id: 'image-alt',
        impact: 'critical',
        help: 'Images must have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt?application=axeAPI',
        nodes: [{ target: ['img.logo'] }, { target: ['img.logo'] }, 'not a node', { target: [7] }],
      },
      { id: 'region', impact: 'moderate', description: 'All content in landmarks', nodes: [] },
      { id: 'tabindex', impact: 'minor', nodes: [{ target: ['a.skip'] }] },
      { id: 'weird', impact: 'catastrophic', nodes: [{}] },
      { impact: 'critical', nodes: [] },
      'not a violation',
    ],
  },
];

describe('parseAxeResults', () => {
  it('reads every page: one finding per rule and selector, severity a band below axe impact', () => {
    const parsed = parseAxeResults(bytes(PAGES));
    for (const finding of parsed.findings) CanonicalFindingSchema.parse(finding);
    expect(
      parsed.findings.map((finding) => [finding.ruleId, finding.severity, finding.message]),
    ).toEqual([
      [
        'axe/color-contrast',
        'medium',
        'Elements must meet minimum color contrast ratio thresholds: #submit',
      ],
      [
        'axe/color-contrast',
        'high',
        'Elements must meet minimum color contrast ratio thresholds: iframe#help | my-widget >>> button.close',
      ],
      ['axe/image-alt', 'high', 'Images must have alternate text: img.logo'],
      ['axe/image-alt', 'high', 'Images must have alternate text'],
      ['axe/region', 'low', 'All content in landmarks'],
      ['axe/tabindex', 'info', 'tabindex: a.skip'],
      ['axe/weird', 'low', 'weird'],
    ]);
    expect(parsed.findings[0]).toMatchObject({
      tool: 'axe-core',
      kind: 'issue',
      dimension: 'accessibility',
      path: 'https://staging.example.com/login?next=%2F',
      line: null,
      helpUri: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast?application=axeAPI',
      fixAvailable: null,
    });
    expect(parsed.findings[4]?.helpUri).toBeNull();
    expect(parsed.truncated).toBe(false);
  });

  it('measures the pass rate over rule counts on every page that reports passes', () => {
    const [metric] = parseAxeResults(bytes(PAGES)).metrics;
    // 4 passing rules; 1 + 4 violated rules with an id.
    expect(DimensionMetricSchema.parse(metric)).toEqual({
      dimension: 'accessibility',
      metric: 'axe-pass-rate',
      tool: { name: 'axe-core', version: '4.10.0' },
      score: (4 / 9) * 100,
      summary: '4 of 9 axe rules passed across 2 pages',
    });
  });

  it('keeps one identity for a rule on a selector across hosts and re-uploads', () => {
    const production = PAGES.map((page) => ({
      ...page,
      url: page.url.replace('staging', 'www').replace('?next=%2F', ''),
    }));
    const staging = parseAxeResults(bytes(PAGES)).findings.map((finding) => finding.fingerprint);
    expect(
      parseAxeResults(bytes(production)).findings.map((finding) => finding.fingerprint),
    ).toEqual(staging);
    expect(parseAxeResults(bytes(PAGES)).findings.map((finding) => finding.fingerprint)).toEqual(
      staging,
    );
    expect(new Set(staging).size).toBe(staging.length);
  });

  it('accepts a single result, without passes, without a url or engine', () => {
    const parsed = parseAxeResults(
      bytes({
        url: 'not a url',
        violations: [{ id: 'label', impact: 'serious', nodes: [{ target: ['input'] }] }],
      }),
    );
    expect(parsed.metrics).toEqual([]);
    expect(parsed.findings[0]).toMatchObject({ tool: 'axe-core', path: 'not a url' });
    const bare = parseAxeResults(bytes({ violations: [{ id: 'label', nodes: [] }], passes: [] }));
    expect(bare.findings[0]?.path).toBeNull();
    // Passes present but no rule ran at all: nothing was measured.
    expect(bare.metrics).toHaveLength(1);
    const nothing = parseAxeResults(bytes({ violations: [], passes: [] }));
    expect(nothing.metrics).toEqual([]);
    const one = parseAxeResults(
      bytes({ testEngine: { version: '4.0.0' }, violations: [], passes: [rule('x')] }),
    );
    expect(one.metrics[0]).toMatchObject({
      tool: { name: 'axe-core', version: '4.0.0' },
      score: 100,
      summary: '1 of 1 axe rules passed across 1 page',
    });
  });

  it('truncates long text to the contract and caps findings with a flag', () => {
    const long = parseAxeResults(
      bytes({
        url: `https://example.com/${'p'.repeat(1200)}`,
        violations: [
          {
            id: 'r'.repeat(400),
            help: 'h'.repeat(5000),
            helpUrl: `https://example.com/${'u'.repeat(2100)}`,
            nodes: [{ target: ['div'] }],
          },
        ],
      }),
    );
    const [finding] = long.findings;
    expect(CanonicalFindingSchema.parse(finding)).toBeDefined();
    expect(finding?.ruleId).toHaveLength(300);

    const nodes = Array.from({ length: MAX_SARIF_RESULTS + 1 }, (_, index) => ({
      target: [`#n${String(index)}`],
    }));
    const capped = parseAxeResults(bytes({ violations: [{ id: 'label', nodes }] }));
    expect(capped.findings).toHaveLength(MAX_SARIF_RESULTS);
    expect(capped.truncated).toBe(true);
  });

  it('refuses what is not axe output', () => {
    expect(errorCode(() => parseAxeResults(new TextEncoder().encode('[')))).toBe('malformed');
    expect(errorCode(() => parseAxeResults(bytes('x')))).toBe('malformed');
    expect(errorCode(() => parseAxeResults(bytes([])))).toBe('malformed');
    expect(errorCode(() => parseAxeResults(bytes([{ violations: [] }, 3])))).toBe('malformed');
    expect(errorCode(() => parseAxeResults(bytes({ url: 'https://example.com' })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseAxeResults(new Uint8Array(MAX_HEALTH_REPORT_BYTES + 1)))).toBe(
      'too_large',
    );
  });
});
