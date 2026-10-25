import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CanonicalFindingSchema } from '@automate/shared-contracts';
import { HealthReportError, MAX_SARIF_RESULTS, parseSarif } from './sarif.js';
import { parseHealthMetrics } from './health-metrics.js';

const fixture = (name: string): Uint8Array =>
  readFileSync(new URL(`./fixtures/health/${name}`, import.meta.url));
const bytes = (document: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(document));

function errorCode(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof HealthReportError ? error.code : 'not-a-health-error';
  }
}

describe('parseSarif over each scanner the health profile runs', () => {
  it('reads Semgrep: security rules to Security, best-practice rules to Code quality', () => {
    const parsed = parseSarif(fixture('semgrep.sarif'));
    expect(parsed.tools).toEqual([
      { tool: { name: 'semgrep', version: '1.90.0' }, dimensions: ['security', 'code-quality'] },
    ]);
    const [evalFinding, consoleFinding] = parsed.findings;
    expect(evalFinding).toMatchObject({
      tool: 'semgrep',
      kind: 'issue',
      severity: 'high',
      dimension: 'security',
      path: 'src/handlers/run.js',
      line: 14,
      helpUri: 'https://semgrep.dev/r/javascript.lang.security.audit.detect-eval-with-expression',
      fixAvailable: null,
    });
    expect(consoleFinding).toMatchObject({
      dimension: 'code-quality',
      severity: 'low',
      path: 'src/index.js',
    });
    for (const finding of parsed.findings)
      expect(CanonicalFindingSchema.parse(finding)).toEqual(finding);
  });

  it('reads gitleaks as an open secret, never below high', () => {
    const [secret] = parseSarif(fixture('gitleaks.sarif')).findings;
    expect(secret).toMatchObject({
      tool: 'gitleaks',
      kind: 'secret',
      severity: 'high',
      dimension: 'security',
      path: 'config/app.env',
      line: 3,
    });
  });

  it('reads Trivy: CVSS to severity, the fixed version to fixAvailable, misconfiguration to Security', () => {
    const parsed = parseSarif(fixture('trivy.sarif'));
    expect(parsed.tools[0]).toEqual({
      tool: { name: 'trivy', version: '0.56.2' },
      dimensions: ['security', 'dependencies'],
    });
    const byRule = new Map(parsed.findings.map((finding) => [finding.ruleId, finding]));
    expect(byRule.get('CVE-2024-45296')).toMatchObject({
      kind: 'vulnerability',
      severity: 'high',
      dimension: 'dependencies',
      fixAvailable: true,
    });
    expect(byRule.get('CVE-2021-44906')).toMatchObject({
      kind: 'vulnerability',
      severity: 'critical',
      fixAvailable: true,
    });
    expect(byRule.get('DS002')).toMatchObject({
      kind: 'issue',
      severity: 'high',
      dimension: 'security',
      fixAvailable: null,
    });
  });

  it('reads OSV-Scanner as a dependency vulnerability, and cuts a declared root from file URIs', () => {
    const [vulnerability] = parseSarif(fixture('osv-scanner.sarif'), {
      sourceRoot: '/work/repo',
    }).findings;
    expect(vulnerability).toMatchObject({
      tool: 'osv-scanner',
      kind: 'vulnerability',
      severity: 'medium',
      dimension: 'dependencies',
      path: 'package-lock.json',
      fixAvailable: null,
    });
  });

  it('reads ESLint to Code quality, and makes a Windows file URI repository-relative', () => {
    const parsed = parseSarif(fixture('eslint.sarif'), { sourceRoot: 'C:\\work\\repo' });
    expect(parsed.tools).toEqual([
      { tool: { name: 'eslint', version: '9.14.0' }, dimensions: ['code-quality'] },
    ]);
    expect(
      parsed.findings.map((finding) => [finding.path, finding.line, finding.severity]),
    ).toEqual([
      ['src/util.js', 4, 'high'],
      ['src/util.js', 9, 'medium'],
    ]);
  });

  it('reads Ruff: a bandit-tagged rule is Security, a pyflakes rule is Code quality', () => {
    const byRule = new Map(
      parseSarif(fixture('ruff.sarif')).findings.map((finding) => [finding.ruleId, finding]),
    );
    expect(byRule.get('F401')?.dimension).toBe('code-quality');
    expect(byRule.get('S105')?.dimension).toBe('security');
  });
});

describe('finding identity', () => {
  const result = (line: number, partial?: Record<string, string>) => ({
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'semgrep' } },
        results: [
          {
            ruleId: 'r',
            message: { text: 'm' },
            locations: [
              {
                physicalLocation: {
                  artifactLocation: { uri: 'a.ts' },
                  region: { startLine: line, snippet: { text: 'eval(x)' } },
                },
              },
            ],
            ...(partial === undefined ? {} : { partialFingerprints: partial }),
          },
        ],
      },
    ],
  });

  it('does not change when a line is inserted above the finding', () => {
    expect(parseSarif(bytes(result(3))).findings[0]?.fingerprint).toBe(
      parseSarif(bytes(result(9))).findings[0]?.fingerprint,
    );
  });

  it('uses the tool’s partial fingerprints when it gives them', () => {
    const a = parseSarif(bytes(result(3, { primaryLocationLineHash: 'abc' }))).findings[0]
      ?.fingerprint;
    const b = parseSarif(bytes(result(3, { primaryLocationLineHash: 'def' }))).findings[0]
      ?.fingerprint;
    expect(a).not.toBe(b);
  });

  it('collapses duplicates of one fingerprint inside an upload', () => {
    const document = result(3);
    const run = document.runs[0];
    if (run !== undefined) run.results = [...run.results, ...run.results];
    expect(parseSarif(bytes(document)).findings).toHaveLength(1);
  });

  it('reports a clean run as a tool with no findings, which is a measurement', () => {
    const parsed = parseSarif(
      bytes({ version: '2.1.0', runs: [{ tool: { driver: { name: 'gitleaks' } }, results: [] }] }),
    );
    expect(parsed).toEqual({
      tools: [{ tool: { name: 'gitleaks', version: null }, dimensions: ['security'] }],
      findings: [],
    });
  });
});

describe('refusals', () => {
  it('refuses what is not SARIF 2.1.0', () => {
    expect(errorCode(() => parseSarif(new TextEncoder().encode('{nope')))).toBe('malformed');
    expect(errorCode(() => parseSarif(bytes({ version: '2.1.0' })))).toBe('malformed');
    expect(errorCode(() => parseSarif(bytes([])))).toBe('malformed');
    expect(errorCode(() => parseSarif(bytes({ version: '1.0.0', runs: [] })))).toBe('unsupported');
  });

  it('refuses too many results rather than truncating them', () => {
    const results = Array.from({ length: MAX_SARIF_RESULTS + 1 }, () => ({
      ruleId: 'r',
      message: { text: 'm' },
    }));
    expect(
      errorCode(() =>
        parseSarif(
          bytes({ version: '2.1.0', runs: [{ tool: { driver: { name: 'x' } }, results }] }),
        ),
      ),
    ).toBe('too_large');
  });

  it('refuses an oversized document before parsing it', () => {
    expect(errorCode(() => parseSarif(new Uint8Array(50 * 1024 * 1024 + 1)))).toBe('too_large');
  });
});

describe('parseHealthMetrics', () => {
  it('reads jscpd duplication into Code quality', () => {
    expect(parseHealthMetrics('jscpd', fixture('jscpd-report.json'))).toEqual([
      {
        dimension: 'code-quality',
        metric: 'duplication',
        tool: { name: 'jscpd', version: null },
        score: expect.closeTo(83.2, 5) as number,
        summary: '4.2% of lines duplicated',
      },
    ]);
  });

  it('reads the Scorecard aggregate into Supply chain', () => {
    expect(parseHealthMetrics('scorecard', fixture('scorecard.json'))).toEqual([
      {
        dimension: 'supply-chain',
        metric: 'scorecard',
        tool: { name: 'scorecard', version: 'v5.0.0' },
        score: 61,
        summary: 'OpenSSF Scorecard 6.1 / 10 over 4 checks',
      },
    ]);
  });

  it('reads each scored Lighthouse category into Runtime, and skips an unscored one', () => {
    const metrics = parseHealthMetrics('lighthouse', fixture('lighthouse.json'));
    expect(metrics.map((metric) => [metric.metric, Math.round(metric.score)])).toEqual([
      ['lighthouse performance', 91],
      ['lighthouse accessibility', 84],
      ['lighthouse best-practices', 100],
    ]);
  });

  it('reads k6 thresholds into Runtime as the share that passed', () => {
    const summary = bytes({
      metrics: {
        http_req_duration: { avg: 20, 'p(95)': 40, thresholds: { 'p(95)<50': { ok: true } } },
        checks: { passes: 10, fails: 0, value: 1 },
      },
    });
    const [metric] = parseHealthMetrics('k6', summary);
    expect(metric).toMatchObject({ dimension: 'runtime', metric: 'load thresholds' });
    expect(metric?.score).toBe(100);
  });

  it('reads coverage from an istanbul summary and from lcov', () => {
    expect(
      parseHealthMetrics('istanbul-summary', bytes({ total: { lines: { pct: 87.5 } } }))[0],
    ).toMatchObject({ dimension: 'coverage', score: 87.5, summary: '87.5% of lines covered' });
    const lcov = new TextEncoder().encode('SF:src/a.ts\nDA:1,1\nDA:2,0\nend_of_record\n');
    expect(parseHealthMetrics('lcov', lcov)[0]).toMatchObject({
      score: 50,
      tool: { name: 'lcov', version: null },
    });
  });

  it('refuses a report that measured nothing, so the dimension stays not measured', () => {
    expect(errorCode(() => parseHealthMetrics('jscpd', bytes({ statistics: {} })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseHealthMetrics('scorecard', bytes({ score: -1 })))).toBe(
      'malformed',
    );
    expect(
      errorCode(() =>
        parseHealthMetrics('lighthouse', bytes({ categories: { seo: { score: null } } })),
      ),
    ).toBe('malformed');
    expect(errorCode(() => parseHealthMetrics('k6', bytes({ nothing: true })))).toBe('malformed');
    expect(errorCode(() => parseHealthMetrics('istanbul-summary', bytes({ total: {} })))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseHealthMetrics('lcov', new TextEncoder().encode('')))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseHealthMetrics('jscpd', new TextEncoder().encode('[1]')))).toBe(
      'malformed',
    );
    expect(errorCode(() => parseHealthMetrics('jscpd', new TextEncoder().encode('{')))).toBe(
      'malformed',
    );
  });
});
