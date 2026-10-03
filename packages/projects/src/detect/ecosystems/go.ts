import { evidenceFor } from '../manifest.js';
import { categoryForScriptName, type EcosystemDetector } from '../detector.js';
import type { ArtifactGlob, CommandCandidate, FrameworkSignal } from '../types.js';

/**
 * Go has one test command and one framework — the standard library's `testing`
 * package. The interesting signals are the *tools* a `go.mod` requires, because
 * those are how a Go repository says it runs k6, ZAP, or a load generator, and
 * `go test ./...` alone would never find them.
 */
const GO_TOOLS: ReadonlyArray<readonly [string, FrameworkSignal['category']]> = [
  ['testify', 'unit'],
  ['ginkgo', 'unit'],
  ['gomega', 'unit'],
  ['playwright-go', 'e2e'],
  ['chromedp', 'e2e'],
  ['k6', 'performance'],
];

const GO_ARTIFACTS: readonly ArtifactGlob[] = [
  { glob: '**/test-results/*.xml', format: 'junit-xml', category: 'unit' },
  { glob: '**/k6-summary.json', format: 'k6-json', category: 'performance' },
];

const GO_COVERAGE_FORMATS = ['go-coverprofile'] as const;

export const detectGo: EcosystemDetector = async ({ paths, read }) => {
  if (!paths.includes('go.mod')) return null;
  const text = await read('go.mod');
  if (text === null) return null;

  const frameworks = GO_TOOLS.filter(([name]) => text.includes(name)).map(([name, category]) => ({
    name,
    category,
    evidence: evidenceFor('go.mod', text, name),
  }));

  return {
    ecosystem: 'go',
    language: 'Go',
    packageManager: 'go',
    // The standard library's own runner, so a `go.mod` with no test framework
    // dependency is still a repository that can run tests.
    frameworks: [
      { name: 'testing', category: 'unit', evidence: evidenceFor('go.mod', text, 'module ') },
      ...frameworks,
    ],
    candidateCommands: goCommands(),
    artifactGlobs: [...GO_ARTIFACTS],
    coverageGlobs: [],
    coverageFormats: [...GO_COVERAGE_FORMATS],
    confidence: 0.85,
  };
};

/**
 * `go test ./...`, and `go test -coverprofile` as the second candidate.
 *
 * Two, because the first produces a verdict and the second produces the coverage
 * depth the score reads. Running only the first scores a repository as having no
 * measured surface, which is indistinguishable from one that genuinely has none.
 */
function goCommands(): CommandCandidate[] {
  return [
    {
      id: 'go.test',
      argv: ['go', 'test', './...'],
      label: 'go test ./...',
      category: categoryForScriptName('test'),
      evidence: 'go.mod',
      confidence: 0.9,
    },
    {
      id: 'go.test.cover',
      argv: ['go', 'test', '-coverprofile=coverage.out', './...'],
      label: 'go test -coverprofile=coverage.out ./...',
      category: 'unit',
      evidence: 'go.mod',
      confidence: 0.7,
    },
  ];
}
