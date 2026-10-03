// @automate/projects — dogfood, run by hand against real repositories.
//
//   node --experimental-strip-types dist/dogfood.js <repo> [<repo>…]
//
// **This is the W7 exit criterion's instrument.** The plan says "live-repo
// dogfood on 3 real non-Node repos", and the honest way to satisfy that is a script
// a person can run against a checkout — not a test whose fixtures I wrote myself,
// which is the only thing `ecosystems.test.ts` proved.
//
// It prints what the detector concluded and what it **missed**, because the second
// column is the whole point: a detector that reports `node` with two frameworks on a
// Ruby repository has not failed loudly enough.
import { detectProject } from './detect/index.js';
import { fileSystemView } from './detect/repository-view.js';
import path from 'node:path';

const KNOWN_FRAMEWORKS = new Set([
  'vitest',
  'jest',
  'mocha',
  'ava',
  'node:test',
  '@playwright/test',
  'playwright',
  'cypress',
  'k6',
  'pytest',
  'unittest',
  'nose',
  'playwright',
  'selenium',
  'locust',
  'pytest-cov',
  'bandit',
  'junit',
  'junit-jupiter',
  'surefire',
  'failsafe',
  'testng',
  'jacoco',
  'gatling',
  'owasp-dependency-check',
  'zaproxy',
  'xunit',
  'nunit',
  'mstest',
  'microsoft.net.test.sdk',
  'microsoft.playwright',
  'coverlet.collector',
  'nettest',
  'testify',
  'ginkgo',
  'gomega',
  'playwright-go',
  'chromedp',
  'rspec',
  'minitest',
  'cucumber',
  'capybara',
  'selenium-webdriver',
  'simplecov',
  'brakeman',
  'insta',
  'proptest',
  'rstest',
  'tokio',
  'criterion',
  'cargo-deny',
  'libtest',
  'testing',
  'phpunit/phpunit',
  'pestphp/pest',
  'codeception/codeception',
  'symfony/panther',
  'phpunit/php-code-coverage',
]);

for (const root of process.argv.slice(2)) {
  const absolute = path.resolve(root);
  const detection = await detectProject(fileSystemView(absolute));
  const report = {
    repo: path.basename(absolute),
    recognised: detection.recognised,
    ecosystem: detection.recognised ? detection.ecosystem : null,
    language: detection.recognised ? detection.language : null,
    packageManager: detection.recognised ? detection.packageManager : null,
    frameworks: detection.recognised ? detection.frameworks.map((framework) => framework.name) : [],
    /** A framework the detector has no rule for. Every one is a tuning candidate. */
    unknownFrameworks: detection.recognised
      ? detection.frameworks
          .map((framework) => framework.name)
          .filter((name) => !KNOWN_FRAMEWORKS.has(name))
      : [],
    commands: detection.recognised
      ? detection.candidateCommands.map((candidate) => ({ id: candidate.id, argv: candidate.argv }))
      : [],
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
