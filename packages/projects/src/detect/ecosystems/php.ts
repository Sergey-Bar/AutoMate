import { dependencySet, evidenceFor, objectField, readJson } from '../manifest.js';
import { categoryForScriptName, type EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

const PHP_FRAMEWORKS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['phpunit/phpunit', 'unit'],
  ['pestphp/pest', 'unit'],
  ['codeception/codeception', 'integration'],
  ['symfony/panther', 'e2e'],
  ['phpunit/php-code-coverage', 'unit'],
  ['k6', 'performance'],
];

const PHP_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/build/test-results/*.xml', format: 'junit-xml', category: 'unit' },
];

/** Coverage is not a result: `canonical_run_results` has no row for a percentage. */
const PHP_COVERAGE_GLOBS = [{ glob: '**/coverage/clover.xml', format: 'clover' }] as const;

const PHP_COVERAGE_FORMATS = ['clover', 'lcov'] as const;

export const detectPhp: EcosystemDetector = async ({ paths, read }) => {
  if (!paths.includes('composer.json')) return null;
  const text = await read('composer.json');
  const manifest = readJson(text);
  if (manifest === null || text === null) return null;

  const dependencies = dependencySet(
    objectField(manifest, 'require'),
    objectField(manifest, 'require-dev'),
  );
  const frameworks = PHP_FRAMEWORKS.filter(([name]) => dependencies.has(name)).map(
    ([name, category]) => ({
      name,
      category,
      evidence: evidenceFor('composer.json', text, name),
    }),
  );

  return {
    ecosystem: 'php',
    language: 'PHP',
    packageManager: 'composer',
    frameworks,
    candidateCommands: phpCommands(dependencies, text),
    artifactGlobs: [...PHP_ARTIFACTS],
    coverageGlobs: [...PHP_COVERAGE_GLOBS],
    coverageFormats: [...PHP_COVERAGE_FORMATS],
    confidence: frameworks.length > 0 ? 0.85 : 0.6,
  };
};

/**
 * The test script when `composer.json` declares one, `vendor/bin/phpunit`
 * otherwise.
 *
 * The declared script wins because a PHP project that scripts its tests has said
 * which binary and which configuration; the binary alone would ignore the
 * project's own `phpunit.xml` arguments.
 */
function phpCommands(dependencies: ReadonlySet<string>, text: string): CommandCandidate[] {
  const manifest = readJson(text);
  const scripts = objectField(manifest, 'scripts');
  const names = Object.keys(scripts ?? {}).filter(
    (name) => name === 'test' || name.startsWith('test'),
  );
  if (names.includes('test')) {
    return [
      {
        id: 'php.composer-test',
        argv: ['composer', 'test'],
        label: 'composer test',
        category: categoryForScriptName('test'),
        evidence: evidenceFor('composer.json', text, '"test"'),
        confidence: 0.85,
      },
    ];
  }
  return [
    {
      id: 'php.phpunit',
      argv: ['vendor/bin/phpunit'],
      label: 'vendor/bin/phpunit',
      category: categoryForScriptName('test'),
      evidence: dependencies.has('phpunit/phpunit')
        ? evidenceFor('composer.json', text, 'phpunit/phpunit')
        : 'composer.json',
      confidence: 0.6,
    },
  ];
}
