import type { ToolKind } from '@automate/shared-contracts';

/**
 * Which kind of tool a script is, read from its name and then its body.
 *
 * ## The order is the classification
 *
 * The first rule that matches wins, so the narrow kinds come before the broad ones:
 * `test:e2e` is end-to-end before it is a test, `test:a11y` is accessibility before it
 * is end-to-end, and `security:secrets` is a secret scan before it is security. The
 * broadest rule — anything with `test` in it is a unit suite — is near the end because
 * it is the reading of last resort.
 *
 * The name is tried before the body because the name is what the repository *says* the
 * script is for. The body is consulted only when the name says nothing: `"ci": "vitest
 * run"` is a unit suite, and nothing in the word `ci` says so.
 */
const RULES: ReadonlyArray<readonly [RegExp, ToolKind]> = [
  [/stryker|mutation|mutate/u, 'mutation'],
  [/a11y|accessib|axe|pa11y|lighthouse/u, 'accessibility'],
  [/secret|gitleaks|trufflehog/u, 'secrets'],
  [/semgrep|sast|codeql|bandit|skill-scan/u, 'sast'],
  [/\baudit\b|deps|depcheck|licen[cs]e|outdated|snyk|osv|dependency/u, 'dependencies'],
  [/e2e|end-?to-?end|playwright|cypress|selenium|puppeteer|smoke/u, 'e2e'],
  [/perf|k6|load|stress|bench|render|artillery|locust/u, 'performance'],
  [/contract|pact/u, 'contract'],
  [/visual|chromatic|percy|backstop/u, 'visual'],
  [/integration/u, 'integration'],
  [/coverage|ratchet|nyc|c8\b/u, 'coverage'],
  [/typecheck|type-check|\btsc\b|mypy|pyright|types?\b/u, 'types'],
  [/format|prettier|black|rustfmt|gofmt/u, 'formatting'],
  [
    /lint|eslint|stylelint|ruff|flake8|clippy|jscpd|duplication|complexity|dead-exports/u,
    'static-analysis',
  ],
  [/security|scan|zap|vuln/u, 'sast'],
  [/\btest|vitest|jest|mocha|pytest|spec|go test|cargo test/u, 'unit'],
  [/\bdb[:-]|migrat|drizzle|prisma|seed/u, 'database'],
  // Each alternative grouped, so where the anchor applies is written down: a script named
  // `docs` or `doc…`, or anything that mentions a docs, site or API-reference tool.
  [/(?:^docs?\b)|(?:docs?:)|(?:site:)|(?:storybook)|(?:typedoc)|(?:openapi)/u, 'docs'],
  [/(?:^(?:dev|start|serve|watch|preview)\b)|(?::dev\b)/u, 'dev'],
  [/build|compile|bundle|oci|docker|pack/u, 'build'],
  [/verify|check|gate|preflight|findings|quality|tenancy/u, 'ci'],
];

export function classifyScript(name: string, body: string): ToolKind {
  return firstKind(name.toLowerCase()) ?? firstKind(body.toLowerCase()) ?? 'other';
}

function firstKind(text: string): ToolKind | undefined {
  return RULES.find(([pattern]) => pattern.test(text))?.[1];
}

/**
 * Why a script cannot be run as a one-shot job, or `null` when it can.
 *
 * A dev server or a watcher never exits, so as a run it would hold a runner slot until
 * its timeout and then be reported as `timed_out` — a failure of the tool to do the
 * thing it was never meant to do. Lifecycle hooks run on `install` and are not tools.
 */
export function notRunnableReason(name: string, body: string): string | null {
  const lower = name.toLowerCase();
  if (/^(pre|post)?(install|prepare|prepublish|prepublishonly|postpack)$/u.test(lower)) {
    return 'A package-manager lifecycle hook, run by install rather than on demand.';
  }
  if (/^(dev|start|serve|preview)\b|:(dev|serve|watch)\b|\bwatch\b/u.test(lower)) {
    return 'A long-running server or watcher; it never exits, so it cannot be a run.';
  }
  if (/--watch\b|\bvite\b(?!.*\bbuild\b)|nodemon|\bserve\b/u.test(body.toLowerCase())) {
    return 'The script starts a watcher or a server; it never exits, so it cannot be a run.';
  }
  return null;
}
