import { describe, expect, it } from 'vitest';
import { RepoScanSchema } from '@automate/shared-contracts';
import { literalView } from '../detect/repository-view.js';
import { classifyScript, notRunnableReason } from './classify.js';
import { scanRepository } from './index.js';
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
} from './reports.js';

const ROOT_MANIFEST = JSON.stringify({
  name: 'root',
  scripts: {
    test: 'turbo run test',
    'test:e2e': 'playwright test',
    lint: 'eslint .',
    dev: 'turbo run dev',
    prepare: 'husky',
    empty: '',
  },
  devDependencies: { '@playwright/test': '1.0.0', eslint: '9.0.0', husky: '9.0.0' },
});

const WEB_MANIFEST = JSON.stringify({
  name: 'web',
  scripts: { test: 'vitest run', typecheck: 'tsc --noEmit', preview: 'vite preview' },
  devDependencies: { vitest: '4.0.0', typescript: '6.0.0' },
});

function repository(extra: Record<string, string> = {}) {
  return literalView({
    'package.json': ROOT_MANIFEST,
    'pnpm-lock.yaml': 'lockfileVersion: 9',
    'apps/web/package.json': WEB_MANIFEST,
    'apps/web/src/App.tsx': 'export {}',
    'apps/web/src/App.test.tsx': 'test()',
    Makefile: '.PHONY: check\ncheck:\n\tpnpm lint\nVAR := 1\nserve:\n\tpnpm dev\n',
    '.github/workflows/ci.yml': 'on: push',
    ...extra,
  });
}

describe('scanRepository', () => {
  it('lists every script in every workspace, through the package manager', async () => {
    const scan = await scanRepository(repository(), new Date('2026-10-20T00:00:00.000Z'));
    expect(RepoScanSchema.parse(scan)).toEqual(scan);
    const web = scan.tools.find((tool) => tool.id === 'script:apps/web:test');
    expect(web).toMatchObject({
      argv: ['pnpm', 'run', 'test'],
      workingDirectory: 'apps/web',
      source: 'apps/web/package.json',
      kind: 'unit',
      runnable: true,
    });
    expect(scan.tools.find((tool) => tool.id === 'script:.:test:e2e')?.kind).toBe('e2e');
    // The root's scripts first, because they are the ones a team runs.
    expect(scan.tools[0]?.workingDirectory).toBe('.');
    expect(scan.scannedAt).toBe('2026-10-20T00:00:00.000Z');
  });

  it('refuses servers, watchers, lifecycle hooks and empty scripts as runs, and says why', async () => {
    const scan = await scanRepository(repository());
    const byId = new Map(scan.tools.map((tool) => [tool.id, tool]));
    expect(byId.get('script:.:dev')?.runnable).toBe(false);
    expect(byId.get('script:.:prepare')?.reason).toMatch(/lifecycle/u);
    expect(byId.get('script:apps/web:preview')?.runnable).toBe(false);
    expect(byId.get('script:.:empty')).toMatchObject({
      runnable: false,
      evidence: '(empty script)',
    });
    expect(byId.get('make:serve')?.runnable).toBe(false);
  });

  it('reads explicit Makefile targets and nothing that only looks like one', async () => {
    const scan = await scanRepository(repository());
    const make = scan.tools.filter((tool) => tool.source === 'Makefile').map((tool) => tool.id);
    expect(make).toEqual(['make:check', 'make:serve']);
  });

  it('falls back to npm when no lockfile exists', async () => {
    const scan = await scanRepository(
      literalView({ 'package.json': JSON.stringify({ scripts: { test: 'jest' } }) }),
    );
    expect(scan.tools[0]?.argv).toEqual(['npm', 'run', 'test']);
    expect(scan.ecosystems).toEqual(['node']);
  });

  it('detects catalogue tools from dependencies and owned files, with evidence', async () => {
    const scan = await scanRepository(repository());
    const detected = new Map(scan.detected.map((tool) => [tool.id, tool.evidence]));
    expect(detected.get('vitest')).toBe('vitest in apps/web/package.json');
    expect(detected.get('github-actions')).toBe('.github/workflows/ci.yml');
    expect(detected.has('stryker')).toBe(false);
  });

  it('marks a capability covered by a tool or by a script, and weighs the maturity', async () => {
    const scan = await scanRepository(repository());
    const coverage = new Map(scan.capabilities.map((entry) => [entry.capability, entry]));
    expect(coverage.get('unit')?.covered).toBe(true);
    expect(coverage.get('mutation')?.covered).toBe(false);
    expect(coverage.get('types')?.providers).toContain('pnpm run typecheck');
    expect(scan.maturity).toBeGreaterThan(0);
    expect(scan.maturity).toBeLessThan(100);
  });

  it('recommends exactly one preferred tool per missing capability', async () => {
    const scan = await scanRepository(repository());
    const recommended = scan.toolbox.filter((entry) => entry.status === 'recommended');
    const capabilities = recommended.map((entry) => entry.capability);
    expect(new Set(capabilities).size).toBe(capabilities.length);
    expect(recommended.find((entry) => entry.capability === 'mutation')?.id).toBe('stryker');
    expect(scan.toolbox.find((entry) => entry.id === 'vitest')?.status).toBe('in-use');
    // Python-only tools are not offered to a Node repository.
    expect(scan.toolbox.some((entry) => entry.id === 'pytest')).toBe(false);
    expect(scan.toolbox.find((entry) => entry.id === 'jest')?.reason).toMatch(/already covered/u);
  });

  it('reads Python requirements as dependencies', async () => {
    const scan = await scanRepository(
      literalView({
        'requirements-dev.txt': 'pytest>=8\n# comment\nmutmut\n',
        'pyproject.toml': '[project]\ndependencies = ["ruff>=0.5", "black"]\n',
      }),
    );
    const ids = scan.detected.map((tool) => tool.id);
    expect(ids).toEqual(expect.arrayContaining(['pytest', 'mutmut', 'ruff', 'black']));
    expect(scan.ecosystems).toEqual(['python']);
    expect(scan.toolbox.find((entry) => entry.capability === 'unit')?.status).toBe('in-use');
  });

  it('collects reports on disk and ignores fixture trees', async () => {
    const scan = await scanRepository(
      repository({
        'apps/web/coverage/coverage-summary.json': JSON.stringify({
          total: { lines: { pct: 91.5 }, branches: { pct: 70 } },
        }),
        'e2e/fixtures/junit.xml': '<testsuite tests="1" failures="1"></testsuite>',
        // The install's own run evidence, which the run history already counts.
        'apps/api/var/artifacts/runs/r1/junit.xml': '<testsuite tests="1"></testsuite>',
        // Sorted coverage-first, whatever the path order says.
        'a-reports/junit.xml': '<testsuite tests="2"></testsuite>',
      }),
    );
    expect(scan.reports.map((report) => report.path)).toEqual([
      'apps/web/coverage/coverage-summary.json',
      'a-reports/junit.xml',
    ]);
    expect(scan.testFiles).toBe(1);
    expect(scan.sourceFiles).toBe(1);
  });
});

describe('report readers', () => {
  it('istanbul summary reports lines and the other three when present', () => {
    const text = JSON.stringify({
      total: { lines: { pct: 55 }, statements: { pct: 60 }, functions: { pct: 70 } },
    });
    expect(istanbulSummary('c.json', text)).toMatchObject({
      status: 'bad',
      metrics: { lines: 55, statements: 60, functions: 70 },
    });
    expect(istanbulSummary('c.json', '{}')).toBeNull();
  });

  it('lcov sums every file and refuses an empty one', () => {
    expect(lcov('lcov.info', 'SF:a\nLF:10\nLH:7\nSF:b\nLF:10\nLH:10\n')).toMatchObject({
      status: 'good',
      metrics: { lines: 85, linesFound: 20 },
    });
    expect(lcov('lcov.info', 'TN:\n')?.metrics['lines']).toBeUndefined();
  });

  it('junit prefers the root totals and falls back to summing suites', () => {
    expect(
      junit('r.xml', '<testsuites tests="5" failures="1" errors="1"><testsuite/>'),
    ).toMatchObject({
      status: 'bad',
      metrics: { tests: 5, failed: 2, passed: 3 },
    });
    expect(
      junit('r.xml', '<testsuite tests="2" skipped="1"/><testsuite tests="3"/>'),
    ).toMatchObject({ status: 'good', metrics: { tests: 5, skipped: 1, passed: 4 } });
    expect(junit('r.xml', '<testsuite tests="0"/>')?.status).toBe('warn');
    expect(junit('r.xml', '<html/>')).toBeNull();
  });

  it('playwright JSON reads its stats block', () => {
    const report = playwrightJson(
      'results.json',
      JSON.stringify({ suites: [], stats: { expected: 9, unexpected: 0, flaky: 1 } }),
    );
    expect(report).toMatchObject({ status: 'warn', metrics: { passed: 9, flaky: 1 } });
    expect(playwrightJson('results.json', JSON.stringify({ stats: {} }))).toBeNull();
    expect(
      playwrightJson(
        'r.json',
        JSON.stringify({ suites: [], stats: { expected: 1, unexpected: 2 } }),
      )?.status,
    ).toBe('bad');
  });

  it('eslint, sarif and gitleaks count what they found', () => {
    expect(
      eslintJson('eslint.json', JSON.stringify([{ errorCount: 0, warningCount: 2 }])),
    ).toMatchObject({ status: 'warn', metrics: { warnings: 2 } });
    expect(eslintJson('eslint.json', JSON.stringify([{ errorCount: 1 }]))?.status).toBe('bad');
    expect(eslintJson('eslint.json', '{}')).toBeNull();
    expect(sarif('a.sarif', JSON.stringify({ runs: [{ results: [{}, {}] }, {}] }))).toMatchObject({
      status: 'bad',
      metrics: { findings: 2 },
    });
    expect(sarif('a.sarif', JSON.stringify({ runs: [{ results: [] }] }))?.headline).toBe(
      'No findings',
    );
    expect(sarif('a.sarif', '{}')).toBeNull();
    expect(gitleaks('gitleaks.json', '[]')?.status).toBe('good');
    expect(gitleaks('gitleaks.json', '[{}]')?.status).toBe('bad');
    expect(gitleaks('gitleaks.json', 'not json')).toBeNull();
  });

  it('k6 reads p95 in either summary shape', () => {
    expect(
      k6Summary('k6.json', JSON.stringify({ metrics: { http_req_duration: { 'p(95)': 120 } } })),
    ).toMatchObject({ status: 'good', metrics: { p95Ms: 120, failedRate: 0 } });
    expect(
      k6Summary(
        'k6.json',
        JSON.stringify({
          metrics: {
            http_req_duration: { values: { 'p(95)': 300 } },
            http_req_failed: { values: { rate: 0.2 } },
          },
        }),
      )?.status,
    ).toBe('bad');
    expect(k6Summary('k6.json', '{}')).toBeNull();
  });

  it('a findings ledger is counted by status', () => {
    const text = JSON.stringify({ findings: [{ status: 'fixed' }, { status: 'open' }, {}] });
    expect(findingsLedger('l.json', text)).toMatchObject({
      status: 'warn',
      metrics: { total: 3, fixed: 1, open: 1 },
    });
    expect(findingsLedger('l.json', JSON.stringify({ rows: [] }))?.status).toBe('good');
    expect(findingsLedger('l.json', '{}')).toBeNull();
  });
});

describe('classifyScript', () => {
  it.each([
    ['test:a11y', '', 'accessibility'],
    ['test:e2e', '', 'e2e'],
    ['security:secrets', '', 'secrets'],
    ['security:static', 'semgrep scan', 'sast'],
    ['test:performance', '', 'performance'],
    ['coverage:ratchet', '', 'coverage'],
    ['typecheck', '', 'types'],
    ['format:check', '', 'formatting'],
    ['lint', '', 'static-analysis'],
    ['test', '', 'unit'],
    ['db:migrate', '', 'database'],
    ['build', '', 'build'],
    ['verify', '', 'ci'],
    ['ci', 'vitest run', 'unit'],
    ['whatever', 'echo hi', 'other'],
  ])('%s (%s) is %s', (name, body, kind) => {
    expect(classifyScript(name, body)).toBe(kind);
  });

  it('knows a one-shot build from a dev server', () => {
    expect(notRunnableReason('build', 'vite build')).toBeNull();
    expect(notRunnableReason('ui', 'vite')).toMatch(/watcher or a server/u);
    expect(notRunnableReason('test:watch', 'vitest')).toMatch(/long-running/u);
    expect(notRunnableReason('test', 'vitest run')).toBeNull();
  });
});
