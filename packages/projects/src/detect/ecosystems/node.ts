import { dependencySet, evidenceFor, objectField, readJson } from '../manifest.js';
import { categoryForScriptName, type EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

/**
 * A lockfile is the only trustworthy statement of which package manager to
 * invoke, so it is read before `package.json` is consulted about anything else.
 * With no lockfile the answer is `npm`, which is the only manager every Node
 * repository can run regardless of what its CI happens to use.
 */
const LOCKFILES: ReadonlyArray<readonly [string, string]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

const NODE_FRAMEWORKS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['vitest', 'unit'],
  ['jest', 'unit'],
  ['mocha', 'unit'],
  ['ava', 'unit'],
  ['node:test', 'unit'],
  ['@playwright/test', 'e2e'],
  ['playwright', 'e2e'],
  ['cypress', 'e2e'],
  ['k6', 'performance'],
  ['@axe-core/playwright', 'security'],
];

const NODE_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/test-results/**/*.xml', format: 'junit-xml', category: 'e2e' },
  { glob: '**/junit*.xml', format: 'junit-xml', category: 'unit' },
  { glob: '**/k6-summary.json', format: 'k6-json', category: 'performance' },
  { glob: '**/zap-report.xml', format: 'zap-xml', category: 'security' },
];

const NODE_COVERAGE_FORMATS = ['lcov', 'cobertura', 'istanbul-json'] as const;

/** Every test runner this detector recognises, keyed by the dependency that proves it. */
function frameworkSignals(
  dependencies: ReadonlySet<string>,
  manifestText: string,
): FrameworkSignal[] {
  return NODE_FRAMEWORKS.filter(([name]) => dependencies.has(name)).map(([name, category]) => ({
    name,
    category,
    evidence: evidenceFor('package.json', manifestText, name),
  }));
}

/**
 * One candidate per `test*` script, invoked **through the package manager**.
 *
 * Never by re-parsing the script body. `pnpm run test:e2e` lets pnpm own
 * quoting, env, and pre/post hooks; splitting `"test": "cross-env FOO=1 vitest
 * run"` here would be a second shell parser that drifts from the first — the
 * exact shape of defect D9 rules out for stdout.
 */
function scriptCommands(
  scriptNames: readonly string[],
  manager: string,
  manifestText: string,
): CommandCandidate[] {
  return scriptNames
    .map((name): CommandCandidate => {
      const argv = name === 'test' ? [manager, 'test'] : [manager, 'run', name];
      return {
        id: `node.${name}`,
        argv,
        label: argv.join(' '),
        category: categoryForScriptName(name),
        evidence: evidenceFor('package.json', manifestText, `"${name}"`),
        confidence: name === 'test' ? 0.9 : 0.85,
      };
    })
    .sort((left, right) => right.confidence - left.confidence || left.id.localeCompare(right.id));
}

export const detectNode: EcosystemDetector = async ({ paths, read }) => {
  if (!paths.includes('package.json')) return null;
  const text = await read('package.json');
  const manifest = readJson(text);
  // A `package.json` that will not parse is a repository that cannot run its own
  // tests either, so there is nothing to propose. Reporting `null` rather than
  // throwing is what lets `project.add` say "I could not read this" instead of
  // returning a 500 to an operator adding a repository.
  if (manifest === null || text === null) return null;

  const dependencies = dependencySet(
    objectField(manifest, 'dependencies'),
    objectField(manifest, 'devDependencies'),
    objectField(manifest, 'peerDependencies'),
    objectField(manifest, 'optionalDependencies'),
  );
  const scriptNames = Object.keys(objectField(manifest, 'scripts') ?? {}).filter(
    (name) => name === 'test' || name.startsWith('test:'),
  );
  const manager = LOCKFILES.find(([lockfile]) => paths.includes(lockfile))?.[1] ?? 'npm';

  return {
    ecosystem: 'node',
    language: 'JavaScript/TypeScript',
    packageManager: manager,
    frameworks: frameworkSignals(dependencies, text),
    candidateCommands: scriptCommands(scriptNames, manager, text),
    artifactGlobs: [...NODE_ARTIFACTS],
    coverageGlobs: [],
    coverageFormats: [...NODE_COVERAGE_FORMATS],
    confidence: scriptNames.includes('test') || dependencies.size > 0 ? 0.9 : 0.5,
  };
};
