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
  // Applications, named one per line rather than as a bare `apps/`.
  //
  // The scope once named `apps/api/src` alone, so `apps/web`, `apps/runner` and
  // `apps/worker` — the three most reachable from a browser or a subprocess — went
  // unexamined for as long as the ruleset existed, and nothing failed, because a
  // scope that omits a directory reports the same clean result as one that
  // includes it. That is the whole reason this list is written out at all.
  'apps/api/src',
  'apps/web/src',
  'apps/runner/src',
  'apps/worker/src',
  // One entry per workspace group rather than per package: semgrep recurses, and
  // naming `packages` once covers every package under it, so a new package needs no
  // edit here. The config check enforces the same reasoning against the real
  // layout for the three groups it can see — `apps`, `packages`, `tools`.
  'packages',
  'tools',
  'scripts',
  'e2e',
  'tests',
  // The documentation site. `site/.vitepress` is where the VitePress config and
  // any build-time scripts live, and a build step that reads a file and hands it
  // to `exec` is a child-process injection — so a site is a surface, not
  // documentation.
  //
  // Not covered by the config check's group walk, which reads `apps`, `packages`,
  // and `tools`. That is a real gap in the check rather than a claim this comment
  // makes; `site` has a `package.json` but no `src/`, so adding it to that walk
  // would find nothing today and would start working the day a `site/src/` appears.
  'site/.vitepress',
];

/**
 * The scope entries that are not scanned paths: the subcommand, the ruleset, and
 * the three exclude patterns.
 *
 * `semgrepDirectories` subtracts these so a flag's argument cannot be read as a
 * directory by the config check. A double-star exclude is a glob, not a path the
 * scan recurses into, and treating it as one would make the check believe build
 * output is covered.
 *
 * Spelled out rather than written literally because `* slash-star` inside this
 * comment would close it — the file stopped parsing the moment that string
 * appeared above, and the error pointed at the end of the file rather than here.
 *
 * @type {Set<string>}
 */
const NON_DIRECTORY_ENTRIES = new Set([
  'scan',
  '.semgrep.yml',
  '**/node_modules',
  '**/dist',
  '**/coverage',
]);

/** @returns {string[]} */
export function semgrepDirectories() {
  return SEMGREP_SCOPE.filter(
    (entry) => !entry.startsWith('--') && !NON_DIRECTORY_ENTRIES.has(entry),
  );
}
