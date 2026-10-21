import { describe, expect, it } from 'vitest';
import type { ScoreCell } from '@automate/shared-contracts';
import {
  buildRepoMap,
  compactMapSearch,
  layerOf,
  packageOf,
  parseMapSearch,
  traceOf,
  type MapInput,
} from './repo-map.js';

function tool(id: string, workingDirectory: string, kind: 'unit' | 'e2e' | 'build' = 'unit') {
  return {
    id,
    name: id,
    label: `pnpm ${id}`,
    kind,
    argv: ['pnpm', id],
    workingDirectory,
    source: 'package.json',
    evidence: `vitest run (${id})`,
    runnable: true,
    reason: null,
  };
}

function report(
  path: string,
  kind: 'coverage' | 'tests' | 'security' | 'lint',
  status: 'good' | 'warn' | 'bad' | 'info',
) {
  return { path, kind, format: 'x', headline: `${path} says ${status}`, metrics: {}, status };
}

function cell(
  key: `${'unit' | 'integration' | 'e2e' | 'performance' | 'security'}:${'backend' | 'frontend' | 'platform'}`,
  inputs: Partial<ScoreCell['inputs']> = {},
  overrides: Partial<ScoreCell> = {},
): ScoreCell {
  const [category, surface] = key.split(':') as [ScoreCell['category'], ScoreCell['surface']];
  return {
    key,
    category,
    surface,
    score: 0.8,
    presence: 1,
    depth: 0.8,
    stability: 0.9,
    signal: 0.8,
    excluded: false,
    inputs: {
      executedTests: 10,
      targetTests: 10,
      surfaceCoverage: 0.8,
      coverageTarget: 0.7,
      flakeRate: 0,
      failedFingerprints: [],
      flakyFingerprints: [],
      hollowFingerprints: [],
      qualifyingRuns: 3,
      ...inputs,
    },
    ...overrides,
  };
}

const INPUT: MapInput = {
  projectName: 'Automate',
  scan: {
    sourceFiles: 120,
    testFiles: 40,
    tools: [
      tool('test', '.'),
      tool('test:web', 'apps/web'),
      tool('build:web', 'apps/web', 'build'),
      tool('test:api', 'apps/api'),
    ],
    reports: [
      report('apps/web/coverage/lcov.info', 'coverage', 'good'),
      report('apps/web/junit.xml', 'tests', 'bad'),
      report('apps/api/coverage/coverage-summary.json', 'coverage', 'warn'),
      report('packages/db/coverage/lcov.info', 'coverage', 'good'),
      report('gitleaks.json', 'security', 'info'),
    ],
    detected: [
      { id: 'vitest', name: 'Vitest', capability: 'unit', evidence: 'vitest.config.ts' },
      { id: 'playwright', name: 'Playwright', capability: 'e2e', evidence: 'playwright.config.ts' },
      { id: 'gitleaks', name: 'Gitleaks', capability: 'secrets', evidence: '.gitleaks.toml' },
      { id: 'eslint', name: 'ESLint', capability: 'static-analysis', evidence: 'eslint.config.js' },
    ],
  },
  score: {
    cells: [
      cell('unit:backend'),
      cell('unit:frontend', { flakyFingerprints: ['fp-1'] }),
      cell('e2e:frontend', { failedFingerprints: ['fp-2', 'fp-3'] }),
      cell('integration:backend', {}, { presence: 0 }),
      cell('performance:backend', {}, { excluded: true }),
      cell('security:backend'),
    ],
  },
  readiness: {
    projectId: 'project-1',
    verdict: 'no-go',
    reasons: [{ code: 'gate', level: 'no-go', message: 'The gate failed', evidence: 'run 9' }],
    evaluatedAt: '2026-10-21T00:00:00.000Z',
  },
};

describe('packageOf', () => {
  const known = ['.', 'apps/web', 'apps/api'];
  it.each([
    ['apps/web/coverage/lcov.info', 'apps/web'],
    ['apps/api/x/y.json', 'apps/api'],
    // Not a tool directory, but a workspace-shaped path still names its package.
    ['packages/db/coverage/lcov.info', 'packages/db'],
    ['gitleaks.json', '.'],
    ['coverage/lcov.info', '.'],
  ])('puts %s in %s', (path, expected) => {
    expect(packageOf(path, known)).toBe(expected);
  });

  it('prefers the longest tool directory, so a nested package is not its parent', () => {
    expect(packageOf('apps/web/e2e/report.json', ['apps', 'apps/web', 'apps/web/e2e'])).toBe(
      'apps/web/e2e',
    );
  });
});

describe('layerOf', () => {
  it.each([
    ['unit', 'unit'],
    ['integration', 'integration'],
    ['contract', 'integration'],
    ['api', 'integration'],
    ['e2e', 'e2e'],
    ['accessibility', 'e2e'],
    ['performance', 'performance'],
    ['sast', 'security'],
    ['secrets', 'security'],
    ['dependencies', 'security'],
    ['dast', 'security'],
    ['static-analysis', null],
    ['coverage', null],
  ] as const)('maps the %s capability to the %s layer', (capability, layer) => {
    expect(layerOf(capability)).toBe(layer);
  });
});

describe('the packages view', () => {
  const map = buildRepoMap(INPUT, 'packages');

  it('draws the repository, its packages, and what each one holds', () => {
    expect(map.columns).toEqual(['Repository', 'Packages', 'Evidence']);
    expect(map.nodes.filter((node) => node.column === 1).map((node) => node.label)).toEqual([
      'Root',
      'apps/api',
      'apps/web',
      'packages/db',
    ]);
    const web = map.nodes.find((node) => node.id === 'pkg:apps/web');
    expect(web?.detail).toBe('2 tools · 2 reports');
    const children = map.edges.filter((edge) => edge.from === 'pkg:apps/web').map((e) => e.to);
    expect(children).toEqual([
      'report:apps/web/coverage/lcov.info',
      'report:apps/web/junit.xml',
      'tools:apps/web',
    ]);
  });

  it('rolls each package up to its worst report, and calls one with none unknown', () => {
    const status = (id: string) => map.nodes.find((node) => node.id === id)?.status;
    expect(status('pkg:apps/web')).toBe('bad');
    expect(status('pkg:apps/api')).toBe('warn');
    expect(status('pkg:packages/db')).toBe('good');
    // The root has one report and it is `info`, which is not a verdict.
    expect(status('pkg:.')).toBe('unknown');
    expect(status('tools:apps/web')).toBe('muted');
  });

  it('marks the path from the repository to every failing report', () => {
    expect(map.blockingPath.sort()).toEqual([
      'pkg:apps/web->report:apps/web/junit.xml',
      'repo->pkg:apps/web',
    ]);
  });

  it('carries the evidence a drawer shows', () => {
    const junit = map.nodes.find((node) => node.id === 'report:apps/web/junit.xml');
    expect(junit?.evidence).toEqual([
      { label: 'Report', value: 'apps/web/junit.xml says bad' },
      { label: 'Path', value: 'apps/web/junit.xml', mono: true },
      { label: 'Kind', value: 'tests · x' },
    ]);
    const tools = map.nodes.find((node) => node.id === 'tools:apps/web');
    expect(tools?.evidence.map((item) => item.value)).toEqual(['pnpm test:web', 'pnpm build:web']);
  });
});

describe('the flow view', () => {
  const map = buildRepoMap(INPUT, 'flow');
  const status = (id: string) => map.nodes.find((node) => node.id === id)?.status;

  it('runs from the code through the layers, tools and reports to the verdict', () => {
    expect(map.columns).toEqual(['Code', 'Layers', 'Tools', 'Reports', 'Verdict']);
    expect(map.nodes.filter((node) => node.column === 1).map((node) => node.label)).toEqual([
      'Unit',
      'Integration',
      'E2E',
      'Performance',
      'Security',
      'Static checks',
    ]);
    expect(map.nodes.find((node) => node.id === 'verdict')?.label).toBe('No-go');
  });

  it('reads each layer from its cells: failed is bad, flaky or hollow warns', () => {
    expect(status('layer:e2e')).toBe('bad');
    expect(status('layer:unit')).toBe('warn');
    expect(status('layer:security')).toBe('good');
    // Every cell present is absent: a layer nobody built is not a pass.
    expect(status('layer:integration')).toBe('unknown');
    // Declared n/a.
    expect(status('layer:performance')).toBe('muted');
    expect(status('verdict')).toBe('bad');
  });

  it('wires each tool under its layer, and gathers the rest under one static-checks node', () => {
    const from = (to: string) => map.edges.filter((edge) => edge.to === to).map((e) => e.from);
    expect(from('tool:vitest')).toEqual(['layer:unit']);
    expect(from('tool:playwright')).toEqual(['layer:e2e']);
    expect(from('tool:gitleaks')).toEqual(['layer:security']);
    expect(from('tool:eslint')).toEqual(['layer:static']);
    // One line from the code to the static checks, not one per linter.
    expect(map.edges.filter((edge) => edge.from === 'code' && edge.to.startsWith('tool:'))).toEqual(
      [],
    );
    const statics = map.nodes.find((node) => node.id === 'layer:static');
    expect(statics).toMatchObject({ status: 'muted', detail: '1 tool' });
  });

  it('orders the tools column by the layer each tool sits under, so the layers stay level', () => {
    // The scan lists a linter first; the column still runs unit, e2e, security, static.
    const shuffled = buildRepoMap(
      { ...INPUT, scan: { ...INPUT.scan, detected: [...INPUT.scan.detected].reverse() } },
      'flow',
    );
    const tools = shuffled.nodes.filter((node) => node.column === 2).map((node) => node.id);
    expect(tools).toEqual(['tool:vitest', 'tool:playwright', 'tool:gitleaks', 'tool:eslint']);
  });

  it('draws no static-checks node when every tool has a test layer', () => {
    const only = buildRepoMap(
      {
        ...INPUT,
        scan: { ...INPUT.scan, detected: INPUT.scan.detected.filter((t) => t.id !== 'eslint') },
      },
      'flow',
    );
    expect(only.nodes.some((node) => node.id === 'layer:static')).toBe(false);
  });

  it('says why when no test layer has been scored, rather than leaving a column of blanks', () => {
    expect(buildRepoMap(INPUT, 'flow').notice).toBeNull();
    const bare = buildRepoMap({ ...INPUT, score: null }, 'flow');
    expect(bare.notice).toMatch(/No test layer has been scored yet/u);
    expect(buildRepoMap({ ...INPUT, score: null }, 'packages').notice).toBeNull();
  });

  it('groups the reports by kind, worst first wins, and sends them all to the verdict', () => {
    expect(status('reports:coverage')).toBe('warn');
    expect(status('reports:tests')).toBe('bad');
    expect(map.edges.filter((edge) => edge.to === 'verdict').map((e) => e.from)).toEqual(
      expect.arrayContaining(['reports:coverage', 'reports:tests', 'reports:security']),
    );
  });

  it('connects a layer with no tool straight to the verdict, so its state still counts', () => {
    expect(
      map.edges.some((edge) => edge.from === 'layer:integration' && edge.to === 'verdict'),
    ).toBe(true);
  });

  it('marks every edge on a path from a failing node to the verdict', () => {
    expect(map.blockingPath).toEqual(
      expect.arrayContaining([
        'layer:e2e->tool:playwright',
        'tool:playwright->reports:tests',
        'reports:tests->verdict',
      ]),
    );
    expect(map.blockingPath).not.toContain('code->layer:unit');
    expect(map.blockingPath).not.toContain('reports:coverage->verdict');
  });

  it('still draws the flow without a score or a verdict, and says it does not know', () => {
    const bare = buildRepoMap({ ...INPUT, score: null, readiness: null }, 'flow');
    expect(bare.nodes.find((node) => node.id === 'verdict')?.label).toBe('Unknown');
    expect(
      bare.nodes
        .filter((node) => node.column === 1 && node.id !== 'layer:static')
        .every((n) => n.status === 'unknown'),
    ).toBe(true);
  });
});

describe('traceOf', () => {
  it('lights everything upstream and downstream of a node, and nothing beside it', () => {
    const map = buildRepoMap(INPUT, 'flow');
    const trace = traceOf(map, 'tool:playwright');
    expect([...trace.nodes].sort()).toEqual(
      ['code', 'layer:e2e', 'reports:tests', 'tool:playwright', 'verdict'].sort(),
    );
    expect(trace.nodes.has('tool:vitest')).toBe(false);
    expect(trace.edges.has('layer:e2e->tool:playwright')).toBe(true);
  });

  it('is empty for no node', () => {
    const trace = traceOf(buildRepoMap(INPUT, 'flow'), null);
    expect(trace.nodes.size).toBe(0);
  });
});

describe('parseMapSearch', () => {
  it('defaults to the flow view with nothing selected', () => {
    expect(parseMapSearch({})).toEqual({ view: 'flow', node: undefined, path: false });
  });

  it('reads a shared link back into the same state', () => {
    expect(parseMapSearch({ view: 'packages', node: 'pkg:apps/web', path: '1' })).toEqual({
      view: 'packages',
      node: 'pkg:apps/web',
      path: true,
    });
    expect(parseMapSearch({ path: true })).toMatchObject({ path: true });
  });

  it('ignores a value it does not understand rather than failing the page', () => {
    expect(parseMapSearch({ view: 'galaxy', node: 42, path: 'yes' })).toEqual({
      view: 'flow',
      node: undefined,
      path: false,
    });
  });
});

describe('compactMapSearch', () => {
  it('writes nothing for the default state, so a plain visit keeps a plain URL', () => {
    expect(compactMapSearch({ view: 'flow', node: undefined, path: false })).toEqual({});
  });

  it('writes only what differs, and round-trips through the parser', () => {
    const state = { view: 'packages', node: 'pkg:apps/web', path: true } as const;
    const written = compactMapSearch(state);
    expect(written).toEqual({ view: 'packages', node: 'pkg:apps/web', path: true });
    expect(parseMapSearch(written)).toEqual(state);
  });
});
