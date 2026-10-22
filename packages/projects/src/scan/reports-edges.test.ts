import { describe, expect, it } from 'vitest';

import {
  eslintJson,
  findingsLedger,
  gitleaks,
  istanbulSummary,
  junit,
  k6Summary,
  lcov,
  playwrightJson,
  sarif,
  scanReports,
} from './reports.js';

/** A reader over a literal map, as `scanReports` is handed. */
function reader(files: Record<string, string>) {
  return {
    paths: Object.keys(files),
    read: async (path: string) => files[path] ?? null,
  };
}

describe('coverage status thresholds', () => {
  const status = (pct: number) =>
    istanbulSummary('c.json', JSON.stringify({ total: { lines: { pct } } }))?.status;

  it('is good from 80, warn from 60, bad below - with the boundaries on the better side', () => {
    expect([100, 80, 79.99, 60, 59.99, 0].map(status)).toEqual([
      'good',
      'good',
      'warn',
      'warn',
      'bad',
      'bad',
    ]);
  });
});

describe('istanbulSummary', () => {
  it('carries the other metrics only when the file has them', () => {
    const report = istanbulSummary(
      'coverage-summary.json',
      JSON.stringify({ total: { lines: { pct: 81.25 }, branches: { pct: 70 }, functions: {} } }),
    );
    expect(report?.metrics).toEqual({ lines: 81.25, branches: 70 });
    expect(report?.headline).toBe('81.3% of lines covered');
  });

  it.each([
    ['not JSON', '{'],
    ['no total', '{}'],
    ['a total with no lines', '{"total":{}}'],
    ['a non-numeric percentage', '{"total":{"lines":{"pct":"80"}}}'],
    ['a non-finite percentage', '{"total":{"lines":{"pct":null}}}'],
    ['a total that is not an object', '{"total":5}'],
  ])('is not a report when the file is %s', (_name, text) => {
    expect(istanbulSummary('c.json', text)).toBeNull();
  });
});

describe('lcov', () => {
  it('sums LF and LH across every record in the file', () => {
    const report = lcov(
      'lcov.info',
      'SF:a\nLF:10\nLH:5\nend_of_record\r\nSF:b\r\nLF:30\r\nLH:30\r\n',
    );
    expect(report).toMatchObject({
      format: 'lcov',
      metrics: { lines: 87.5, linesFound: 40, linesHit: 35 },
      status: 'good',
      headline: '87.5% of 40 lines covered',
    });
  });

  it('counts a malformed number as zero rather than as NaN', () => {
    const report = lcov('lcov.info', 'LF:abc\nLF:10\nLH:x\nLH:2\n');
    expect(report?.metrics).toEqual({ lines: 20, linesFound: 10, linesHit: 2 });
    expect(report?.status).toBe('bad');
  });

  it('is not a report when no line was instrumented', () => {
    expect(lcov('lcov.info', 'SF:a\nend_of_record\n')).toBeNull();
    expect(lcov('lcov.info', '')).toBeNull();
  });
});

describe('junit', () => {
  it('reads the totals from <testsuites> when it carries them', () => {
    const report = junit(
      'r.xml',
      '<testsuites tests="10" failures="1" errors="2" skipped="3"><testsuite tests="99"/></testsuites>',
    );
    expect(report?.metrics).toEqual({ tests: 10, failed: 3, skipped: 3, passed: 4 });
    expect(report?.status).toBe('bad');
  });

  it('sums the <testsuite> elements when the root has no totals', () => {
    const report = junit(
      'r.xml',
      '<testsuites><testsuite tests="2" failures="0"/><testsuite tests="3" skipped="1"/></testsuites>',
    );
    expect(report?.metrics).toEqual({ tests: 5, failed: 0, skipped: 1, passed: 4 });
    expect(report?.status).toBe('good');
  });

  it('reads a bare <testsuite> document', () => {
    expect(junit('r.xml', '<testsuite tests="1" failures="1"/>')?.status).toBe('bad');
  });

  it('warns about a suite that ran nothing, rather than calling it good', () => {
    const report = junit('r.xml', '<testsuite tests="0"/>');
    expect(report?.status).toBe('warn');
    expect(report?.headline).toBe('0 tests, 0 failing, 0 skipped');
  });

  it('never reports a negative passed count', () => {
    const report = junit('r.xml', '<testsuite tests="1" failures="1" skipped="1"/>');
    expect(report?.metrics['passed']).toBe(0);
  });

  it('is not a report when there is no suite at all', () => {
    expect(junit('r.xml', '<html></html>')).toBeNull();
  });
});

describe('playwrightJson', () => {
  const file = (stats: unknown) => JSON.stringify({ suites: [], stats });

  it('is good, warn or bad by failures first, then flakiness', () => {
    expect(playwrightJson('p.json', file({ expected: 3 }))?.status).toBe('good');
    expect(playwrightJson('p.json', file({ expected: 3, flaky: 1 }))?.status).toBe('warn');
    expect(playwrightJson('p.json', file({ expected: 3, flaky: 1, unexpected: 1 }))?.status).toBe(
      'bad',
    );
  });

  it('defaults the counts that are absent to zero', () => {
    expect(playwrightJson('p.json', file({ expected: 2 }))?.metrics).toEqual({
      passed: 2,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
  });

  it.each([
    ['not JSON', 'nope'],
    ['an object with no suites', '{"stats":{"expected":1}}'],
    ['a report with no expected count', '{"suites":[],"stats":{}}'],
    ['a report with no stats', '{"suites":[]}'],
  ])('is not a report for %s', (_name, text) => {
    expect(playwrightJson('p.json', text)).toBeNull();
  });
});

describe('eslintJson', () => {
  it('totals errors and warnings and ignores entries that carry no count', () => {
    const report = eslintJson(
      'eslint.json',
      JSON.stringify([{ errorCount: 2, warningCount: 1 }, {}, { errorCount: 'x' }, null]),
    );
    expect(report?.metrics).toEqual({ errors: 2, warnings: 1, files: 4 });
    expect(report?.status).toBe('bad');
  });

  it('is warn for warnings alone and good for none', () => {
    expect(eslintJson('e.json', '[{"warningCount":1}]')?.status).toBe('warn');
    expect(eslintJson('e.json', '[]')?.status).toBe('good');
  });

  it('is not a report when the document is not an array', () => {
    expect(eslintJson('e.json', '{}')).toBeNull();
    expect(eslintJson('e.json', '{')).toBeNull();
  });
});

describe('sarif', () => {
  it('counts results across runs, skipping runs without a results array', () => {
    const report = sarif(
      'a.sarif',
      JSON.stringify({
        runs: [{ results: [{}, {}] }, { results: 'no' }, null, {}, { results: [{}] }],
      }),
    );
    expect(report).toMatchObject({
      metrics: { findings: 3 },
      status: 'bad',
      headline: '3 findings',
    });
  });

  it('says so plainly when there are no findings', () => {
    expect(sarif('a.sarif', '{"runs":[]}')).toMatchObject({
      status: 'good',
      headline: 'No findings',
    });
  });

  it('is not a report without a runs array', () => {
    expect(sarif('a.sarif', '{"runs":{}}')).toBeNull();
    expect(sarif('a.sarif', 'x')).toBeNull();
  });
});

describe('gitleaks', () => {
  it('reports the number of possible secrets, never their content', () => {
    const report = gitleaks('gitleaks.json', JSON.stringify([{ Secret: 'hunter2' }, {}]));
    expect(report?.headline).toBe('2 possible secrets');
    expect(JSON.stringify(report)).not.toContain('hunter2');
    expect(report?.status).toBe('bad');
  });

  it('is good for an empty report and absent for a non-array', () => {
    expect(gitleaks('g.json', '[]')).toMatchObject({
      status: 'good',
      headline: 'No secrets found',
    });
    expect(gitleaks('g.json', '{}')).toBeNull();
  });
});

describe('k6Summary', () => {
  it('reads both the flat and the nested summary layouts', () => {
    const flat = k6Summary(
      'k6.json',
      JSON.stringify({
        metrics: { http_req_duration: { 'p(95)': 120.4 }, http_req_failed: { value: 0.02 } },
      }),
    );
    expect(flat).toMatchObject({ metrics: { p95Ms: 120.4, failedRate: 0.02 }, status: 'bad' });
    expect(flat?.headline).toBe('p95 120 ms, 2.0% failed requests');

    const nested = k6Summary(
      'k6.json',
      JSON.stringify({
        metrics: {
          http_req_duration: { values: { 'p(95)': 80 } },
          http_req_failed: { values: { rate: 0 } },
        },
      }),
    );
    expect(nested).toMatchObject({ metrics: { p95Ms: 80, failedRate: 0 }, status: 'good' });
  });

  it('treats a missing failure rate as no failures, and exactly 1% as acceptable', () => {
    const none = k6Summary('k6.json', '{"metrics":{"http_req_duration":{"p(95)":5}}}');
    expect(none?.metrics['failedRate']).toBe(0);
    const edge = k6Summary(
      'k6.json',
      '{"metrics":{"http_req_duration":{"p(95)":5},"http_req_failed":{"value":0.01}}}',
    );
    expect(edge?.status).toBe('good');
  });

  it('is not a report without a p95', () => {
    expect(k6Summary('k6.json', '{"metrics":{}}')).toBeNull();
    expect(k6Summary('k6.json', '{')).toBeNull();
  });
});

describe('findingsLedger', () => {
  it('counts rows by status, from either `findings` or `rows`', () => {
    const rows = [
      { status: 'fixed' },
      { status: 'open' },
      { status: 'open' },
      {},
      null,
      { status: 4 },
    ];
    const a = findingsLedger('findings-ledger.json', JSON.stringify({ findings: rows }));
    expect(a).toMatchObject({
      headline: '1 fixed, 2 open of 6 findings',
      status: 'warn',
      metrics: { total: 6, fixed: 1, open: 2 },
    });
    const b = findingsLedger(
      'findings-ledger.json',
      JSON.stringify({ rows: [{ status: 'fixed' }] }),
    );
    expect(b).toMatchObject({ headline: '1 fixed, 0 open of 1 findings', status: 'good' });
  });

  it('is not a report when neither key holds an array', () => {
    expect(findingsLedger('findings-ledger.json', '{"findings":{}}')).toBeNull();
    expect(findingsLedger('findings-ledger.json', 'x')).toBeNull();
  });
});

describe('scanReports', () => {
  it('skips reports that live in fixture and run-evidence trees', async () => {
    const view = reader({
      'coverage/coverage-summary.json': '{"total":{"lines":{"pct":90}}}',
      'test/fixtures/coverage-summary.json': '{"total":{"lines":{"pct":1}}}',
      'var/runs/1/lcov.info': 'LF:1\nLH:1',
      'artifacts/gitleaks.json': '[]',
      'a/samples/eslint.json': '[]',
    });
    const reports = await scanReports(view.paths, view.read);
    expect(reports.map((r) => r.path)).toEqual(['coverage/coverage-summary.json']);
  });

  it('drops a file it cannot read and a file its reader declines', async () => {
    const view = {
      paths: ['lcov.info', 'coverage/coverage-summary.json', 'eslint.json'],
      read: async (path: string) => (path === 'eslint.json' ? '{}' : null),
    };
    expect(await scanReports(view.paths, view.read)).toEqual([]);
  });

  it('orders by kind, then by path', async () => {
    const view = reader({
      'z/gitleaks.json': '[]',
      'b/lcov.info': 'LF:1\nLH:1',
      'a/lcov.info': 'LF:1\nLH:1',
      'k6-summary.json': '{"metrics":{"http_req_duration":{"p(95)":1}}}',
      'findings-ledger.json': '{"findings":[]}',
      'eslint-report.json': '[]',
      'junit.xml': '<testsuite tests="1"/>',
    });
    const reports = await scanReports(view.paths, view.read);
    expect(reports.map((r) => `${r.kind}:${r.path}`)).toEqual([
      'coverage:a/lcov.info',
      'coverage:b/lcov.info',
      'tests:junit.xml',
      'lint:eslint-report.json',
      'security:z/gitleaks.json',
      'performance:k6-summary.json',
      'quality:findings-ledger.json',
    ]);
  });

  it('opens at most sixty files', async () => {
    const files: Record<string, string> = {};
    for (let index = 0; index < 75; index += 1) {
      files[`pkg${String(index).padStart(2, '0')}/lcov.info`] = 'LF:1\nLH:1';
    }
    const view = reader(files);
    expect(await scanReports(view.paths, view.read)).toHaveLength(60);
  });

  it('matches only the XML and JSON files that look like reports', async () => {
    const view = reader({
      'pom.xml': '<testsuite tests="1"/>',
      'target/surefire-reports/TEST-a.xml': '<testsuite tests="1"/>',
      'out/playwright.json': '{"suites":[],"stats":{"expected":1}}',
      'package.json': '{"suites":[],"stats":{"expected":1}}',
      'x.sarif': '{"runs":[]}',
      'y.sarif.json': '{"runs":[]}',
    });
    const reports = await scanReports(view.paths, view.read);
    expect(reports.map((r) => r.path).sort()).toEqual([
      'out/playwright.json',
      'target/surefire-reports/TEST-a.xml',
      'x.sarif',
      'y.sarif.json',
    ]);
  });
});
