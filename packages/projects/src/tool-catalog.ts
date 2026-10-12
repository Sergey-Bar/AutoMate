import { z } from 'zod/v4';

/**
 * The QA tool catalogue: what a stack can be made of, and what each tool is for.
 *
 * ## Why this lives in `packages/projects` and not in the web app
 *
 * The browser once held a hand-written registry, which meant the API could not
 * answer "what is missing from this project's stack" — the question was answered
 * by whatever the client knew. The catalogue is pure data with no Node built-in
 * in it, so the same fifty rows are importable by a browser bundle and by a
 * server probe. One registry, two consumers: that is the whole point of the
 * module boundary.
 *
 * ## Every entry answers the question a reader actually has
 *
 * A tool's name and homepage answer "what is it". `whyItHelps` answers "why
 * would I add it", which is the question that gets a tool installed; without it
 * a registry is a phone book. `detectPatterns` answer "how would you know" — the
 * probe matches those against the repository, so the evidence for a claimed tool
 * is a path a reader can check.
 */

/** The categories a QA stack is divided into, in reporting order. */
export const QA_TOOL_CATEGORIES = [
  'test-framework',
  'test-runner',
  'browser-automation',
  'api-testing',
  'mobile-testing',
  'performance',
  'security',
  'accessibility',
  'visual-regression',
  'contract-testing',
  'chaos-engineering',
  'load-testing',
  'mocking',
  'test-data',
  'reporting',
  'ci-integration',
  'coverage',
] as const;

/** What a tool costs to start using. */
export const QA_TOOL_TIERS = ['free', 'paid', 'freemium'] as const;

export const QAToolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(QA_TOOL_CATEGORIES),
  tier: z.enum(QA_TOOL_TIERS),
  /** One line: what it does, without adjectives. */
  description: z.string().min(1),
  /** Why a stack without it is worse. This is the field that gets a tool installed. */
  whyItHelps: z.string().min(1),
  homepage: z.string().url(),
  repo: z.string().url(),
  docs: z.string().url(),
  /** The install line, copy-ready for the project's ecosystem. */
  installCommand: z.string().min(1),
  /** Path fragments that mean this tool is present. Matched against the repository. */
  detectPatterns: z.array(z.string()).min(1),
  /**
   * The manifest names this tool is installed under, when it is a package.
   *
   * The probe matches a dependency list against these, which is how a tool is
   * detected as a *dependency* rather than only as a config file — a project
   * with `vitest` in `devDependencies` and no config file yet has the tool.
   */
  dependencyNames: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  alternatives: z.array(z.string()).optional(),
  learningCurve: z.enum(['low', 'medium', 'high']).default('medium'),
  maintenanceStatus: z.enum(['active', 'maintenance', 'deprecated']).default('active'),
});

export type QATool = z.infer<typeof QAToolSchema>;

/** A category and the tools in it, for a screen that renders one card per group. */
export const QAToolCategorySchema = z.object({
  id: z.enum(QA_TOOL_CATEGORIES),
  name: z.string().min(1),
  description: z.string().min(1),
  tools: z.array(QAToolSchema),
});

export type QAToolCategory = z.infer<typeof QAToolCategorySchema>;

/** The categories in the order a reviewer reads them. */
export const CATEGORY_LABELS: Record<QATool['category'], string> = {
  'test-framework': 'Test Frameworks',
  'test-runner': 'Test Runners',
  'browser-automation': 'Browser Automation',
  'api-testing': 'API Testing',
  'mobile-testing': 'Mobile Testing',
  performance: 'Performance',
  security: 'Security',
  accessibility: 'Accessibility',
  'visual-regression': 'Visual Regression',
  'contract-testing': 'Contract Testing',
  'chaos-engineering': 'Chaos Engineering',
  'load-testing': 'Load Testing',
  mocking: 'Mocking',
  'test-data': 'Test Data',
  reporting: 'Reporting',
  'ci-integration': 'CI Integration',
  coverage: 'Coverage',
};

export const CATEGORY_ORDER: readonly QATool['category'][] = QA_TOOL_CATEGORIES;

/** One line per category, saying what question its tools answer. */
export const CATEGORY_DESCRIPTIONS: Record<QATool['category'], string> = {
  'test-framework': 'Where the assertions live',
  'test-runner': 'What actually executes them',
  'browser-automation': 'Driving a real browser',
  'api-testing': 'Exercising the service boundary',
  'mobile-testing': 'Testing an app that runs on a device',
  performance: 'How fast, measured rather than felt',
  security: 'What a scanner can prove is wrong',
  accessibility: 'What a screen reader would say',
  'visual-regression': 'Whether it still looks the same',
  'contract-testing': 'Whether two services still agree',
  'chaos-engineering': 'Whether the failure path works',
  'load-testing': 'Whether it holds under traffic',
  mocking: 'Standing in for a dependency that is not there',
  'test-data': 'What the fixtures are made of',
  reporting: 'Where the results go',
  'ci-integration': 'Running it all on every change',
  coverage: 'How much of the code was executed',
};

interface ToolInput {
  id: string;
  name: string;
  category: QATool['category'];
  tier?: QATool['tier'];
  description: string;
  whyItHelps: string;
  homepage: string;
  repo: string;
  docs: string;
  installCommand: string;
  detectPatterns: string[];
  /** The manifest names this tool installs under, when it is a package. */
  dependencyNames?: string[];
  tags?: string[];
  alternatives?: string[];
  learningCurve?: QATool['learningCurve'];
  maintenanceStatus?: QATool['maintenanceStatus'];
}

/**
 * The catalogue.
 *
 * **Deliberately not exhaustive, and deliberately honest about tiers.** Fifty
 * tools a QA engineer should know about, each with the sentence that argues for
 * it. A tool that only works behind a hosted service is `paid` rather than
 * `free`, because the install line is not the whole cost.
 */
const TOOL_INPUTS: readonly ToolInput[] = [
  // Test frameworks.
  {
    id: 'vitest',
    name: 'Vitest',
    category: 'test-framework',
    description: 'A Vite-native test runner with Jest-compatible assertions.',
    whyItHelps:
      'Runs the same source the app ships, so a test and a component never disagree about module resolution.',
    homepage: 'https://vitest.dev',
    repo: 'https://github.com/vitest-dev/vitest',
    docs: 'https://vitest.dev/guide/',
    installCommand: 'pnpm add -D vitest @vitest/coverage-v8',
    detectPatterns: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'],
    dependencyNames: ['vitest'],
    tags: ['unit', 'integration', 'vite'],
    learningCurve: 'low',
  },
  {
    id: 'jest',
    name: 'Jest',
    category: 'test-framework',
    description: 'The widely deployed zero-config test framework.',
    whyItHelps:
      'A migration path off it is rarely needed, and its snapshot format is understood by every reporter.',
    homepage: 'https://jestjs.io',
    repo: 'https://github.com/jestjs/jest',
    docs: 'https://jestjs.io/docs/getting-started',
    installCommand: 'pnpm add -D jest @jest/globals',
    detectPatterns: ['jest.config.ts', 'jest.config.js', 'jest.config.mjs'],
    dependencyNames: ['jest'],
    tags: ['unit', 'snapshot'],
  },
  {
    id: 'mocha',
    name: 'Mocha',
    category: 'test-framework',
    description: 'A minimal test framework with pluggable assertion and mock layers.',
    whyItHelps:
      'Leaves the assertion library to you, which is the right shape when a house style already exists.',
    homepage: 'https://mochajs.org',
    repo: 'https://github.com/mochajs/mocha',
    docs: 'https://mochajs.org/#getting-started',
    installCommand: 'pnpm add -D mocha chai',
    detectPatterns: ['.mocharc.yml', '.mocharc.json', '.mocharc.js'],
    dependencyNames: ['mocha'],
    tags: ['unit', 'node'],
  },
  {
    id: 'pytest',
    name: 'pytest',
    category: 'test-framework',
    description: 'The Python test framework, with fixtures as a first-class feature.',
    whyItHelps:
      'Fixture injection makes a test declare what it needs instead of building the world in a setUp.',
    homepage: 'https://docs.pytest.org',
    repo: 'https://github.com/pytest-dev/pytest',
    docs: 'https://docs.pytest.org/en/stable/',
    installCommand: 'pip install pytest',
    detectPatterns: ['pytest.ini', 'pyproject.toml', 'conftest.py'],
    dependencyNames: ['pytest'],
    tags: ['python', 'unit', 'fixtures'],
    learningCurve: 'low',
  },
  // Test runners.
  {
    id: 'karma',
    name: 'Karma',
    category: 'test-runner',
    description: 'A test runner that executes suites in real browsers.',
    whyItHelps:
      'Runs on the engines a customer actually uses, which is the only place an old browser bug is ever found.',
    homepage: 'https://karma-runner.github.io',
    repo: 'https://github.com/karma-runner/karma',
    docs: 'https://karma-runner.github.io/latest/index.html',
    installCommand: 'pnpm add -D karma',
    detectPatterns: ['karma.conf.js', 'karma.conf.ts'],
    dependencyNames: ['karma'],
    tags: ['browser', 'real-engines'],
  },
  {
    id: 'node-test',
    name: 'node:test',
    category: 'test-runner',
    description: 'The standard-library test runner, invoked with `node --test`.',
    whyItHelps:
      'Zero dependencies and zero build step, which is what a gate script wants to be able to assume.',
    homepage: 'https://nodejs.org/api/test.html',
    repo: 'https://github.com/nodejs/node',
    docs: 'https://nodejs.org/api/test.html#running-tests-from-the-command-line',
    installCommand: '# built into Node 18+',
    detectPatterns: ['--test'],
    tags: ['node', 'zero-dependency'],
  },
  {
    id: 'ava',
    name: 'AVA',
    category: 'test-runner',
    description: 'A concurrent test runner with isolated worker processes.',
    whyItHelps:
      'Runs files in parallel by default, which is the only thing that makes a slow suite fast again.',
    homepage: 'https://avajs.dev',
    repo: 'https://github.com/avajs/ava',
    docs: 'https://avajs.dev/getting-started',
    installCommand: 'pnpm add -D ava',
    detectPatterns: ['ava.config.js', 'ava.config.mjs'],
    dependencyNames: ['ava'],
    tags: ['node', 'concurrent'],
  },
  // Browser automation.
  {
    id: 'playwright',
    name: 'Playwright',
    category: 'browser-automation',
    description: 'Cross-browser automation with tracing, interception and auto-waiting.',
    whyItHelps:
      'Traces and network interception mean a failure can be read rather than re-run, and auto-waiting removes the sleeps that make suites flaky.',
    homepage: 'https://playwright.dev',
    repo: 'https://github.com/microsoft/playwright',
    docs: 'https://playwright.dev/docs/intro',
    installCommand: 'pnpm add -D @playwright/test && pnpm exec playwright install',
    detectPatterns: ['playwright.config.ts', 'playwright.config.js', '@playwright/test'],
    dependencyNames: ['@playwright/test', 'playwright', 'playwright-core'],
    tags: ['e2e', 'chromium', 'firefox', 'webkit'],
    learningCurve: 'medium',
  },
  {
    id: 'puppeteer',
    name: 'Puppeteer',
    category: 'browser-automation',
    description: 'A Chrome DevTools protocol driver for scripted browser control.',
    whyItHelps:
      'A PDF render, a screenshot or a crawl is a script, not a test, and this is the shortest script there is.',
    homepage: 'https://pptr.dev',
    repo: 'https://github.com/puppeteer/puppeteer',
    docs: 'https://pptr.dev/guides/installation',
    installCommand: 'pnpm add -D puppeteer',
    detectPatterns: ['puppeteer', '.puppeteerrc'],
    dependencyNames: ['puppeteer'],
    tags: ['chromium', 'scripting'],
  },
  {
    id: 'cypress',
    name: 'Cypress',
    category: 'browser-automation',
    tier: 'freemium',
    description: 'A browser test runner with a time-traveling debugger.',
    whyItHelps:
      'The dashboard that replays a failure is free for a small team, which is exactly the size that needs it.',
    homepage: 'https://www.cypress.io',
    repo: 'https://github.com/cypress-io/cypress',
    docs: 'https://docs.cypress.io/app/get-started/why-cypress',
    installCommand: 'pnpm add -D cypress',
    detectPatterns: ['cypress.config.ts', 'cypress.config.js', 'cypress/e2e'],
    dependencyNames: ['cypress'],
    tags: ['e2e', 'chromium'],
  },
  {
    id: 'webdriverio',
    name: 'WebdriverIO',
    category: 'browser-automation',
    description: 'A Webdriver-based automation framework with Appium for mobile.',
    whyItHelps:
      'One API for a browser and a device, so a suite does not become two suites because the form factor changed.',
    homepage: 'https://webdriver.io',
    repo: 'https://github.com/webdriverio/webdriverio',
    docs: 'https://webdriver.io/docs/gettingstarted',
    installCommand: 'pnpm add -D @wdio/cli',
    detectPatterns: ['wdio.conf.ts', 'wdio.conf.js'],
    dependencyNames: ['@wdio/cli', 'webdriverio'],
    tags: ['e2e', 'appium', 'webdriver'],
  },
  {
    id: 'selenium',
    name: 'Selenium',
    category: 'browser-automation',
    description: 'The original browser automation protocol and its language bindings.',
    whyItHelps:
      'A legacy suite written against it still runs, and knowing why it is flaky is a real skill.',
    homepage: 'https://www.selenium.dev',
    repo: 'https://github.com/SeleniumHQ/selenium',
    docs: 'https://www.selenium.dev/documentation/',
    installCommand: 'pip install selenium',
    detectPatterns: ['selenium', 'selenium-webdriver'],
    tags: ['e2e', 'webdriver', 'legacy'],
    maintenanceStatus: 'maintenance',
  },
  // API testing.
  {
    id: 'supertest',
    name: 'SuperTest',
    category: 'api-testing',
    description: 'HTTP assertions over a Node server, in-process.',
    whyItHelps:
      'Starts no server and binds no port, so an API test is a unit test that speaks HTTP.',
    homepage: 'https://github.com/ladjs/supertest',
    repo: 'https://github.com/ladjs/supertest',
    docs: 'https://github.com/ladjs/supertest#readme',
    installCommand: 'pnpm add -D supertest',
    detectPatterns: ['supertest'],
    dependencyNames: ['supertest'],
    tags: ['http', 'node', 'in-process'],
    learningCurve: 'low',
  },
  {
    id: 'pactum',
    name: 'Pactum',
    category: 'api-testing',
    description: 'A REST and GraphQL API test framework with data mocking built in.',
    whyItHelps:
      'Mocks the dependency a service calls, so a test of the service is not a test of the whole system.',
    homepage: 'https://pactumjs.github.io',
    repo: 'https://github.com/pactumjs/pactum',
    docs: 'https://pactumjs.github.io/guides/installation',
    installCommand: 'pnpm add -D pactum',
    detectPatterns: ['pactum'],
    dependencyNames: ['pactum'],
    tags: ['http', 'graphql', 'mock'],
  },
  {
    id: 'newman',
    name: 'Newman',
    category: 'api-testing',
    description: 'The Postman collection runner, for the command line.',
    whyItHelps:
      'A collection a QA engineer wrote by hand becomes a CI gate without rewriting it in code.',
    homepage:
      'https://learning.postman.com/docs/collections/using-newman-cli/command-line-integration-with-newman/',
    repo: 'https://github.com/postmanlabs/newman',
    docs: 'https://learning.postman.com/docs/collections/using-newman-cli/command-line-integration-with-newman/',
    installCommand: 'pnpm add -g newman',
    detectPatterns: ['newman'],
    dependencyNames: ['newman'],
    tags: ['http', 'collection'],
  },
  {
    id: 'rest-assured',
    name: 'REST Assured',
    category: 'api-testing',
    description: 'A Java DSL for testing REST services.',
    whyItHelps:
      'Given/then/then reads like the contract it is asserting, which survives an audit better than a request builder.',
    homepage: 'https://rest-assured.io',
    repo: 'https://github.com/rest-assured/rest-assured',
    docs: 'https://rest-assured.io/#docs',
    installCommand: 'implementation "io.rest-assured:rest-assured:5.5.0"',
    detectPatterns: ['rest-assured'],
    // The Maven artifactId, which is what a pom.xml declares and what the probe
    // matches against.
    dependencyNames: ['rest-assured'],
    tags: ['http', 'java', 'jvm'],
  },
  // Mobile testing.
  {
    id: 'appium',
    name: 'Appium',
    category: 'mobile-testing',
    description: 'The Webdriver protocol for native, hybrid and mobile web apps.',
    whyItHelps:
      'One suite drives both platforms, and a flaky mobile run becomes as debuggable as a browser one.',
    homepage: 'https://appium.io',
    repo: 'https://github.com/appium/appium',
    docs: 'https://appium.io/docs/en/latest/quickstart/',
    installCommand: 'npm install -g appium',
    detectPatterns: ['appium', '.appium'],
    tags: ['android', 'ios', 'webdriver'],
  },
  {
    id: 'maestro',
    name: 'Maestro',
    category: 'mobile-testing',
    description: 'Declarative mobile UI flows with a YAML flow syntax.',
    whyItHelps:
      'A flow is a list of steps a product manager can read, so a mobile test stops being an engineer-only artefact.',
    homepage: 'https://maestro.mobile.dev',
    repo: 'https://github.com/mobile-dev-inc/maestro',
    docs: 'https://maestro.mobile.dev/getting-started/installing-maestro',
    installCommand: 'curl -Ls "https://get.maestro.mobile.dev" | bash',
    detectPatterns: ['maestro', '.maestro'],
    tags: ['android', 'ios', 'yaml'],
    learningCurve: 'low',
  },
  {
    id: 'detox',
    name: 'Detox',
    category: 'mobile-testing',
    description: 'End-to-end tests for React Native apps.',
    whyItHelps:
      'Waits for the app rather than sleeping, which is the difference between a mobile suite and a mobile coin flip.',
    homepage: 'https://wix.github.io/Detox',
    repo: 'https://github.com/wix/Detox',
    docs: 'https://wix.github.io/Detox/docs/introduction/getting-started/',
    installCommand: 'pnpm add -D detox',
    detectPatterns: ['detox', '.detoxrc.js'],
    dependencyNames: ['detox'],
    tags: ['react-native', 'e2e'],
  },
  // Performance.
  {
    id: 'lighthouse',
    name: 'Lighthouse',
    category: 'performance',
    description: 'Audits for performance, accessibility, SEO and best practice.',
    whyItHelps:
      'A number that is comparable across builds, which is the only kind of performance claim worth making.',
    homepage: 'https://developer.chrome.com/docs/lighthouse/overview',
    repo: 'https://github.com/GoogleChrome/lighthouse',
    docs: 'https://developer.chrome.com/docs/lighthouse/overview',
    installCommand: 'pnpm add -D lighthouse',
    detectPatterns: ['lighthouse'],
    dependencyNames: ['lighthouse'],
    tags: ['audit', 'core-web-vitals'],
  },
  {
    id: 'sitespeed',
    name: 'sitespeed.io',
    category: 'performance',
    description: 'A browser performance harness that records video and metrics from real pages.',
    whyItHelps:
      'Records what the user experienced, not what a synthetic agent measured in a quiet environment.',
    homepage: 'https://www.sitespeed.io',
    repo: 'https://github.com/sitespeedio/sitespeed.io',
    docs: 'https://www.sitespeed.io/documentation/',
    installCommand:
      'docker run --rm -v "$(pwd):/sitespeed.io" sitespeedio/sitespeed.io:latest https://example.com/',
    detectPatterns: ['sitespeed.io'],
    tags: ['harness', 'video', 'real-user'],
  },
  // Security.
  {
    id: 'zap',
    name: 'OWASP ZAP',
    category: 'security',
    description: 'A dynamic application security scanner for web applications.',
    whyItHelps:
      'Finds what a static scan cannot — an injection that only exists in a rendered page.',
    homepage: 'https://www.zaproxy.org',
    repo: 'https://github.com/zaproxy/zaproxy',
    docs: 'https://www.zaproxy.org/docs/',
    installCommand:
      'docker run -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t https://example.com/',
    detectPatterns: ['zap', 'zaproxy'],
    tags: ['dast', 'owasp'],
  },
  {
    id: 'semgrep',
    name: 'Semgrep',
    category: 'security',
    description: 'Static analysis with a rule language and a community rule registry.',
    whyItHelps:
      'A house rule written once runs on every future commit, which is what makes it a gate rather than a report.',
    homepage: 'https://semgrep.dev',
    repo: 'https://github.com/semgrep/semgrep',
    docs: 'https://semgrep.dev/docs/getting-started/',
    installCommand: 'pip install semgrep',
    detectPatterns: ['.semgrep', 'semgrep.yml', 'semgrep'],
    dependencyNames: ['semgrep'],
    tags: ['sast', 'rules'],
  },
  {
    id: 'gitleaks',
    name: 'Gitleaks',
    category: 'security',
    description: 'Secret detection over the working tree and over history.',
    whyItHelps: 'A committed key is the cheapest breach to cause and the easiest one to prevent.',
    homepage: 'https://gitleaks.io',
    repo: 'https://github.com/gitleaks/gitleaks',
    docs: 'https://gitleaks.io/#usage',
    installCommand: 'brew install gitleaks',
    detectPatterns: ['.gitleaks.toml', 'gitleaks'],
    tags: ['secrets', 'history'],
    learningCurve: 'low',
  },
  // Accessibility.
  {
    id: 'axe-core',
    name: 'axe-core',
    category: 'accessibility',
    description: 'The accessibility testing engine behind most automated a11y checks.',
    whyItHelps:
      'Runs in the page it is checking, so a violation is reported with the offending element attached.',
    homepage: 'https://github.com/dequelabs/axe-core',
    repo: 'https://github.com/dequelabs/axe-core',
    docs: 'https://github.com/dequelabs/axe-core/tree/develop/doc',
    installCommand: 'pnpm add -D @axe-core/playwright @axe-core/react',
    detectPatterns: ['@axe-core', 'axe-core', 'jest-axe'],
    dependencyNames: ['@axe-core/playwright', '@axe-core/react', 'axe-core', 'jest-axe'],
    tags: ['a11y', 'wcag'],
    learningCurve: 'low',
  },
  {
    id: 'pa11y',
    name: 'Pa11y',
    category: 'accessibility',
    description: 'Automated accessibility testing of URLs, from the command line.',
    whyItHelps:
      'Reads a real deployed page, so it finds the problems a component test in isolation cannot see.',
    homepage: 'https://pa11y.org',
    repo: 'https://github.com/pa11y/pa11y',
    docs: 'https://pa11y.org/getting-started/',
    installCommand: 'npm install -g pa11y',
    detectPatterns: ['.pa11yci', 'pa11y'],
    dependencyNames: ['pa11y'],
    tags: ['a11y', 'url'],
  },
  {
    id: 'equal-access',
    name: 'Equal Access',
    category: 'accessibility',
    description: 'An accessibility rule checker from IBM, with a large rule catalogue.',
    whyItHelps:
      'A second engine disagrees with the first on purpose, and the disagreements are the interesting findings.',
    homepage: 'https://github.com/IBMa/equal-access',
    repo: 'https://github.com/IBMa/equal-access',
    docs: 'https://github.com/IBMa/equal-access#readme',
    installCommand: 'npm install -g @ibma/equal-access',
    detectPatterns: ['@ibma/equal-access', 'equal-access'],
    tags: ['a11y', 'engine'],
  },
  {
    id: 'jsx-a11y',
    name: 'eslint-plugin-jsx-a11y',
    category: 'accessibility',
    description: 'The JSX accessibility rules for ESLint.',
    whyItHelps:
      'Catches the a11y defect at the keystroke, which is the only place it is free to fix.',
    homepage: 'https://github.com/jsx-eslint/eslint-plugin-jsx-a11y',
    repo: 'https://github.com/jsx-eslint/eslint-plugin-jsx-a11y',
    docs: 'https://github.com/jsx-eslint/eslint-plugin-jsx-a11y#readme',
    installCommand: 'pnpm add -D eslint eslint-plugin-jsx-a11y',
    detectPatterns: ['eslint-plugin-jsx-a11y', 'jsx-a11y'],
    dependencyNames: ['eslint-plugin-jsx-a11y'],
    tags: ['a11y', 'lint'],
  },
  // Visual regression.
  {
    id: 'chromatic',
    name: 'Chromatic',
    category: 'visual-regression',
    tier: 'freemium',
    description: 'Visual regression for component libraries, by the Storybook team.',
    whyItHelps:
      "A component's appearance is part of its contract, and this is where that contract is versioned.",
    homepage: 'https://www.chromatic.com',
    repo: 'https://github.com/chromaui/chromatic-cli',
    docs: 'https://www.chromatic.com/docs/',
    installCommand: 'pnpm add -D chromatic',
    detectPatterns: ['chromatic'],
    dependencyNames: ['chromatic'],
    tags: ['storybook', 'snapshot'],
  },
  {
    id: 'percy',
    name: 'Percy',
    category: 'visual-regression',
    tier: 'freemium',
    description: 'Visual review as a step in CI, with an approval workflow.',
    whyItHelps:
      'Makes a visual diff a reviewable request rather than a screenshot opened six months late.',
    homepage: 'https://percy.io',
    repo: 'https://github.com/percy/percy-storybook',
    docs: 'https://www.browserstack.com/docs/percy',
    installCommand: 'pnpm add -D @percy/cli @percy/storybook',
    detectPatterns: ['@percy', 'percy'],
    dependencyNames: ['@percy/cli'],
    tags: ['snapshot', 'review'],
  },
  {
    id: 'lost-pixel',
    name: 'Lost Pixel',
    category: 'visual-regression',
    description: 'Open-source visual regression with a self-hosted mode.',
    whyItHelps:
      'Keeps the baselines in the repository, so a visual diff is reviewable in the same pull request as the code.',
    homepage: 'https://lost-pixel.com',
    repo: 'https://github.com/lost-pixel/lost-pixel',
    docs: 'https://lost-pixel.com/docs/getting-started',
    installCommand: 'pnpm add -D lost-pixel',
    detectPatterns: ['lost-pixel', 'lostpixel.config.js'],
    dependencyNames: ['lost-pixel'],
    tags: ['snapshot', 'open-source'],
  },
  // Contract testing.
  {
    id: 'pact',
    name: 'Pact',
    category: 'contract-testing',
    description: 'Consumer-driven contract testing with a broker between services.',
    whyItHelps: 'Two teams stop discovering their integration is broken in production.',
    homepage: 'https://pact.io',
    repo: 'https://github.com/pact-foundation/pact-js',
    docs: 'https://docs.pact.io/',
    installCommand: 'pnpm add -D @pact-foundation/pact',
    detectPatterns: ['@pact-foundation', 'pact-broker'],
    dependencyNames: ['@pact-foundation/pact'],
    tags: ['contract', 'microservices'],
  },
  {
    id: 'schemathesis',
    name: 'Schemathesis',
    category: 'contract-testing',
    description: 'Property-based API testing generated from an OpenAPI schema.',
    whyItHelps: 'Generates the cases nobody wrote down, which is where the 500s live.',
    homepage: 'https://schemathesis.io',
    repo: 'https://github.com/schemathesis/schemathesis',
    docs: 'https://schemathesis.readthedocs.io/',
    installCommand: 'pip install schemathesis',
    detectPatterns: ['schemathesis'],
    dependencyNames: ['schemathesis'],
    tags: ['openapi', 'property-based'],
  },
  // Chaos engineering.
  {
    id: 'chaos-mesh',
    name: 'Chaos Mesh',
    category: 'chaos-engineering',
    description: 'A Kubernetes chaos platform with scheduled experiments.',
    whyItHelps:
      'Proves the failure path on purpose, in a window of your choosing, rather than at 3am on a Friday.',
    homepage: 'https://chaos-mesh.org',
    repo: 'https://github.com/chaos-mesh/chaos-mesh',
    docs: 'https://chaos-mesh.org/docs/',
    installCommand: 'helm install chaos-mesh chaos-mesh/chaos-mesh',
    detectPatterns: ['chaos-mesh'],
    dependencyNames: ['@chaos-mesh/api'],
    tags: ['kubernetes', 'experiment'],
  },
  {
    id: 'gremlin',
    name: 'Gremlin',
    category: 'chaos-engineering',
    tier: 'paid',
    description: 'A hosted chaos engineering platform with a scenario catalogue.',
    whyItHelps:
      'A turnkey alternative to running your own control plane, if the compliance answer needs a vendor.',
    homepage: 'https://www.gremlin.com',
    repo: 'https://github.com/gremlin/gremlin-cli',
    docs: 'https://www.gremlin.com/docs/',
    installCommand:
      'curl https://raw.githubusercontent.com/gremlin/gremlin-cli/main/install.sh | bash',
    detectPatterns: ['gremlin'],
    tags: ['hosted', 'experiment'],
  },
  // Load testing.
  {
    id: 'k6',
    name: 'k6',
    category: 'load-testing',
    tier: 'freemium',
    description: 'Scriptable load testing with thresholds as code.',
    whyItHelps:
      'A threshold is a pass/fail gate, which is the only difference between a load test and a load anecdote.',
    homepage: 'https://k6.io',
    repo: 'https://github.com/grafana/k6',
    docs: 'https://grafana.com/docs/k6/latest/',
    installCommand: 'brew install k6',
    detectPatterns: ['k6', 'k6.config.js'],
    dependencyNames: ['k6'],
    tags: ['load', 'thresholds'],
  },
  {
    id: 'artillery',
    name: 'Artillery',
    category: 'load-testing',
    description: 'Distributed load testing with YAML scenarios and HTTP/WS support.',
    whyItHelps:
      'A scenario is YAML, so the load test is reviewable by someone who does not write JavaScript.',
    homepage: 'https://www.artillery.io',
    repo: 'https://github.com/artilleryio/artillery',
    docs: 'https://www.artillery.io/docs',
    installCommand: 'npm install -g artillery',
    detectPatterns: ['artillery', 'artillery.yml'],
    dependencyNames: ['artillery'],
    tags: ['load', 'yaml'],
  },
  {
    id: 'locust',
    name: 'Locust',
    category: 'load-testing',
    description: 'Python load testing with a distributed swarm of users.',
    whyItHelps:
      "A user's behaviour is a Python function, so the test reads like the journey it models.",
    homepage: 'https://locust.io',
    repo: 'https://github.com/locustio/locust',
    docs: 'https://docs.locust.io/',
    installCommand: 'pip install locust',
    detectPatterns: ['locust'],
    dependencyNames: ['locust'],
    tags: ['load', 'python'],
  },
  // Mocking.
  {
    id: 'msw',
    name: 'Mock Service Worker',
    category: 'mocking',
    description: 'API mocking at the network layer, for both tests and the browser.',
    whyItHelps:
      'The same mock works in a node test and in a browser dev session, so the fixture cannot drift between them.',
    homepage: 'https://mswjs.io',
    repo: 'https://github.com/mswjs/msw',
    docs: 'https://mswjs.io/docs/getting-started',
    installCommand: 'pnpm add -D msw',
    detectPatterns: ['msw', 'src/mocks'],
    dependencyNames: ['msw'],
    tags: ['network', 'browser-and-node'],
  },
  {
    id: 'wiremock',
    name: 'WireMock',
    category: 'mocking',
    description: 'A programmable HTTP mock server with recorded stubs.',
    whyItHelps:
      "Records a third party's responses once, so a suite stops depending on a service that is not yours.",
    homepage: 'https://wiremock.org',
    repo: 'https://github.com/wiremock/wiremock',
    docs: 'https://wiremock.org/docs/getting-started/',
    installCommand: 'docker run -d -p 8080:8080 wiremock/wiremock:latest',
    detectPatterns: ['wiremock'],
    dependencyNames: ['wiremock'],
    tags: ['http', 'stubs', 'standalone'],
  },
  // Test data.
  {
    id: 'faker',
    name: 'Faker',
    category: 'test-data',
    description: 'Generated fake data: names, addresses, dates, and everything derived.',
    whyItHelps:
      'Ends the copy-paste fixture, which is the fixture that leaks production data by accident.',
    homepage: 'https://fakerjs.dev',
    repo: 'https://github.com/faker-js/faker',
    docs: 'https://fakerjs.dev/guide/',
    installCommand: 'pnpm add -D @faker-js/faker',
    detectPatterns: ['@faker-js/faker', 'faker'],
    dependencyNames: ['@faker-js/faker'],
    tags: ['fixtures', 'seed'],
    learningCurve: 'low',
  },
  {
    id: 'testcontainers',
    name: 'Testcontainers',
    category: 'test-data',
    description: 'Disposable database, queue and browser containers started from a test.',
    whyItHelps:
      'The integration test runs against the real engine it ships against, so the test proves the thing that matters.',
    homepage: 'https://testcontainers.com',
    repo: 'https://github.com/testcontainers/testcontainers-node',
    docs: 'https://node.testcontainers.org/',
    installCommand: 'pnpm add -D testcontainers',
    detectPatterns: ['testcontainers'],
    dependencyNames: ['testcontainers'],
    tags: ['integration', 'docker'],
  },
  // Reporting.
  {
    id: 'allure',
    name: 'Allure Report',
    category: 'reporting',
    description: 'A self-hosted test report with history and retry trends.',
    whyItHelps:
      'Keeps the history, so "this suite is getting slower" is a chart rather than an argument.',
    homepage: 'https://allurereport.org',
    repo: 'https://github.com/allure-framework/allure2',
    docs: 'https://allurereport.org/docs/',
    installCommand: 'pnpm add -D allure-commandline',
    detectPatterns: ['allure', 'allure-results'],
    dependencyNames: ['allure-commandline'],
    tags: ['history', 'self-hosted'],
  },
  {
    id: 'reportportal',
    name: 'ReportPortal',
    category: 'reporting',
    tier: 'freemium',
    description: 'A hosted test reporting platform with real-time analysis.',
    whyItHelps:
      'Centralises results from every runner in one place, which is what a team of teams needs and one team does not.',
    homepage: 'https://reportportal.io',
    repo: 'https://github.com/reportportal/reportportal',
    docs: 'https://reportportal.io/docs/',
    installCommand: 'docker run -d -p 8080:8080 reportportal/service-api',
    detectPatterns: ['reportportal'],
    tags: ['hosted', 'analysis'],
  },
  {
    id: 'mochawesome',
    name: 'Mochawesome',
    category: 'reporting',
    description: 'A static HTML report generated from a Mocha run.',
    whyItHelps:
      'A report a reviewer can open from the CI artefacts, with no server to keep running.',
    homepage: 'https://github.com/adamgruber/mochawesome',
    repo: 'https://github.com/adamgruber/mochawesome',
    docs: 'https://github.com/adamgruber/mochawesome#readme',
    installCommand: 'pnpm add -D mochawesome',
    detectPatterns: ['mochawesome', '.mocharc.yml'],
    dependencyNames: ['mochawesome'],
    tags: ['static', 'html'],
  },
  // CI integration.
  {
    id: 'turbo',
    name: 'Turborepo',
    category: 'ci-integration',
    description: 'A monorepo build system with remote caching and task graphs.',
    whyItHelps:
      'Runs only what a change touched, so a large suite stops being the reason CI is slow.',
    homepage: 'https://turbo.build',
    repo: 'https://github.com/vercel/turborepo',
    docs: 'https://turbo.build/repo/docs',
    installCommand: 'pnpm add -D turbo',
    detectPatterns: ['turbo.json'],
    dependencyNames: ['turbo'],
    tags: ['monorepo', 'cache'],
  },
  {
    id: 'nx',
    name: 'Nx',
    category: 'ci-integration',
    description: 'A monorepo toolkit with affected-project detection and generators.',
    whyItHelps:
      'Generators encode the house pattern, so a new package starts correct rather than approximately correct.',
    homepage: 'https://nx.dev',
    repo: 'https://github.com/nrwl/nx',
    docs: 'https://nx.dev/getting-started/intro',
    installCommand: 'pnpm add -D nx',
    detectPatterns: ['nx.json'],
    dependencyNames: ['nx'],
    tags: ['monorepo', 'generators'],
  },
  // Coverage.
  {
    id: 'nyc',
    name: 'nyc',
    category: 'coverage',
    description: 'The Istanbul command-line coverage tool.',
    whyItHelps:
      'The coverage format every reporter already reads, which matters more than which tool produced it.',
    homepage: 'https://istanbul.js.org',
    repo: 'https://github.com/istanbuljs/nyc',
    docs: 'https://github.com/istanbuljs/nyc#readme',
    installCommand: 'pnpm add -D nyc',
    detectPatterns: ['nyc', '.nycrc'],
    dependencyNames: ['nyc'],
    tags: ['istanbul', 'cli'],
  },
  {
    id: 'c8',
    name: 'c8',
    category: 'coverage',
    description: 'V8-native coverage with source-map support.',
    whyItHelps:
      "Uses the engine's own sampling, so coverage costs a fraction of an instrumented build.",
    homepage: 'https://github.com/istanbuljs/v8-to-istanbul',
    repo: 'https://github.com/bcoe/c8',
    docs: 'https://github.com/bcoe/c8#usage',
    installCommand: 'pnpm add -D c8',
    detectPatterns: ['c8', '.c8rc'],
    dependencyNames: ['c8'],
    tags: ['v8', 'source-maps'],
  },
  {
    id: 'codecov',
    name: 'Codecov',
    category: 'coverage',
    tier: 'paid',
    description: 'Hosted coverage reporting with per-commit diffing.',
    whyItHelps:
      'Answers "did my change cover the paths it touched", which is the question a total percentage cannot.',
    homepage: 'https://about.codecov.io',
    repo: 'https://github.com/codecov/codecov-cli',
    docs: 'https://docs.codecov.com/docs',
    installCommand: 'npm install -g codecov',
    detectPatterns: ['codecov', '.codecov.yml'],
    dependencyNames: ['codecov'],
    tags: ['hosted', 'diff'],
  },
];

/** The catalogue, parsed through its schema so a typo fails at import. */
export const QA_TOOLS_REGISTRY: readonly QATool[] = QAToolSchema.array().parse(
  TOOL_INPUTS.map((input) => ({
    ...input,
    tier: input.tier ?? 'free',
    tags: input.tags ?? [],
    learningCurve: input.learningCurve ?? 'medium',
    maintenanceStatus: input.maintenanceStatus ?? 'active',
  })),
);

/** Group the catalogue by category, in reporting order. */
export function groupByCategory(tools: readonly QATool[] = QA_TOOLS_REGISTRY): QAToolCategory[] {
  const byCategory = new Map<string, QATool[]>();
  for (const tool of tools) {
    const list = byCategory.get(tool.category) ?? [];
    list.push(tool);
    byCategory.set(tool.category, list);
  }
  return CATEGORY_ORDER.filter((id) => byCategory.has(id)).map((id) => ({
    id,
    name: CATEGORY_LABELS[id],
    description: CATEGORY_DESCRIPTIONS[id],
    tools: byCategory.get(id) ?? [],
  }));
}

/** The tool ids every QA stack is worse without. */
export const ESSENTIAL_TOOL_IDS: readonly string[] = [
  'vitest',
  'playwright',
  'axe-core',
  'semgrep',
  'c8',
];
