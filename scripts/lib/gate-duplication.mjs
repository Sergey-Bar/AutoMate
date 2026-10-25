/**
 * Work a gate chain does twice.
 *
 * `verify` used to run the contract suite three times (`test` → turbo, `test:contract`,
 * and again at the end of `test:integration`), the runner suites twice, every
 * `scripts/lib/*.test.mjs` docs test twice (`docs:check`, `docs:dead-exports`, and the
 * `scripts/lib/*.test.mjs` glob in `test:integration`), and the integration package
 * twice. None of that was visible from the script names, because each step had a
 * different one. This module expands a root script into the commands it really runs
 * and reports every unit of work that appears more than once.
 *
 * The units are deliberately coarse and only three kinds are understood:
 *
 *  - a package test run: `turbo run test` (every package), `turbo run test --filter=X`,
 *    or `pnpm --filter X test`;
 *  - a `node --test` file, after its globs are expanded;
 *  - any other command, compared verbatim.
 *
 * Coarse is the right bias: a missed duplicate costs minutes, a false one gets the
 * check switched off.
 */
import { globSync } from 'node:fs';
import path from 'node:path';
import { referencedScripts } from './gate-tooling.mjs';

/**
 * The leaf commands behind a root script, in order, with nested root scripts inlined.
 *
 * @param {string} name
 * @param {Record<string, string>} scripts the root package.json `scripts`
 * @param {string[]} [stack] the scripts being expanded, to refuse a cycle
 * @returns {string[]}
 */
export function expandScript(name, scripts, stack = []) {
  if (stack.includes(name)) throw new Error(`script cycle: ${[...stack, name].join(' → ')}`);
  const command = scripts[name];
  if (command === undefined) throw new Error(`no root script named "${name}"`);
  /** @type {string[]} */
  const leaves = [];
  for (const raw of command.split('&&')) {
    const step = raw.trim();
    if (step === '') continue;
    const [nested] = referencedScripts(step);
    // Only a step that *is* a root-script invocation is inlined. `pnpm audit` and
    // `pnpm --filter x test` reference no root script and stay leaves.
    if (nested !== undefined && scripts[nested] !== undefined && /^pnpm (run )?\S+$/u.test(step)) {
      leaves.push(...expandScript(nested, scripts, [...stack, name]));
    } else {
      leaves.push(step);
    }
  }
  return leaves;
}

/**
 * The units of work one leaf command performs.
 *
 * @param {string} leaf
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function workUnits(leaf, repoRoot) {
  const argv = leaf.split(/\s+/u).filter(Boolean);
  if (argv[0] === 'turbo' && argv[1] === 'run' && argv[2] === 'test') {
    const filters = argv
      .filter((token) => token.startsWith('--filter='))
      .map((token) => token.slice('--filter='.length));
    return filters.length === 0 ? ['package-test:*'] : filters.map((f) => `package-test:${f}`);
  }
  if (argv[0] === 'pnpm' && argv[1] === '--filter' && argv[3] === 'test' && argv.length === 4) {
    return [`package-test:${argv[2] ?? ''}`];
  }
  if (argv[0] === 'node' && argv.includes('--test')) {
    const patterns = argv.slice(1).filter((token) => !token.startsWith('-'));
    return patterns.flatMap((pattern) =>
      globSync(pattern, { cwd: repoRoot })
        .map((file) => `node-test:${file.split(path.sep).join('/')}`)
        .sort(),
    );
  }
  return [`command:${leaf}`];
}

/**
 * Every unit of work the chain performs more than once, as findings.
 *
 * `package-test:*` covers every filtered package test, so a filtered run after an
 * unfiltered one is a duplicate even though the strings differ.
 *
 * @param {string} name
 * @param {Record<string, string>} scripts
 * @param {string} repoRoot
 * @returns {string[]}
 */
export function duplicatedWork(name, scripts, repoRoot) {
  /** @type {Map<string, string[]>} where each unit was first produced, by leaf */
  const seen = new Map();
  /** @type {string[]} */
  const findings = [];
  const leaves = expandScript(name, scripts);
  const everyPackage = leaves.some((leaf) => workUnits(leaf, repoRoot).includes('package-test:*'));
  for (const leaf of leaves) {
    for (const unit of workUnits(leaf, repoRoot)) {
      const earlier = seen.get(unit);
      if (earlier !== undefined) {
        findings.push(`${name} runs ${unit} twice: "${earlier[0] ?? ''}" and "${leaf}"`);
        continue;
      }
      if (everyPackage && unit.startsWith('package-test:') && unit !== 'package-test:*') {
        findings.push(
          `${name} runs ${unit} again after "turbo run test" already ran every package`,
        );
        continue;
      }
      seen.set(unit, [leaf]);
    }
  }
  return findings;
}
