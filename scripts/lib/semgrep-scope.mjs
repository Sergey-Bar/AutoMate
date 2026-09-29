/**
 * The semgrep scope for the static-analysis gate.
 *
 * Every workspace surface, listed one entry at a time, in one place that both the
 * gate and its own config check read.
 *
 * This was an inline argv array inside `scripts/static-analysis.mjs` for as long as
 * the ruleset existed, and `scripts/static-analysis-config-check.mjs` scraped it back
 * out of that file's *source text* — matching on the literal string `run('semgrep'`
 * and then reading the following lines. Two things were wrong with that. The scope
 * could be widened or emptied by an unrelated refactor of the script, and the check
 * would not notice, because it was reading a comment-free array rather than the argv
 * that actually ran. And `indexOf` returning -1 makes `slice(-1)` return the last
 * *character*, so the "no semgrep invocation found" branch could never fire.
 *
 * A scope that omits a directory reports exactly the same clean result as one that
 * includes it. That is the whole reason this list is written out rather than being a
 * bare `apps/` — and the reason the check that guards it has to read the real thing.
 */

/**
 * The argv after the binary, in the order semgrep receives it.
 *
 * Flags are kept because semgrep's own semantics depend on them: `--error` is what
 * turns findings into a non-zero exit, and the three `--exclude` patterns are what
 * keep `node_modules`, build output, and coverage reports out of the scan. Test files
 * are *not* excluded — a finding in a test is still a finding, and a blanket test
 * exclusion is how a real secret in a fixture goes unnoticed.
 *
 * @type {string[]}
 */
export const SEMGREP_SCOPE = [
  'scan',
  '--config',
  '.semgrep.yml',
  '--error',
  '--exclude',
  '**/node_modules',
  '--exclude',
  '**/dist',
  '--exclude',
  '**/coverage',
  // Applications. `apps/api/src` alone was the previous scope, so `apps/web`,
  // `apps/runner` and `apps/worker` were never examined by the security gate — the
  // three most reachable from a browser or a subprocess.
  'apps/api/src',
  'apps/web/src',
  'apps/runner/src',
  'apps/worker/src',
  // One entry per workspace group rather than per package: semgrep recurses, and
  // naming `packages` once covers every package under it, so a new package needs no
  // edit here. The config check enforces the same reasoning against the real layout.
  'packages',
  'tools',
  'scripts',
  'e2e',
  'tests',
  // The documentation site. Listed explicitly rather than as a `site/*` workspace
  // glob: `semgrep-scope.mjs` names paths, and `site/.vitepress` is where the
  // VitePress config and any build-time scripts live. A build step that reads a
  // file and hands it to `exec` is a child-process injection, and a site is
  // rendered on every deploy — so it is a surface, not documentation.
  'site/.vitepress',
];

/**
 * The scope's directory entries — the arguments that are not a flag or a flag's value.
 *
 * The check compares this against the workspace rather than pattern-matching lines of
 * source, so a flag, a flag's argument, and a path cannot be confused for one another.
 *
 * @type {Set<string>}
 */
const FLAG_VALUES = new Set(['scan', '.semgrep.yml', '**/node_modules', '**/dist', '**/coverage']);

/** @returns {string[]} */
export function semgrepDirectories() {
  return SEMGREP_SCOPE.filter((entry) => !entry.startsWith('--') && !FLAG_VALUES.has(entry));
}
