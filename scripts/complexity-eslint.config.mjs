/**
 * The ESLint config `pnpm complexity` measures with.
 *
 * **Why this file exists.** The ratchet used to enable its rule from the command
 * line:
 *
 * ```sh
 * eslint apps packages tools tests scripts --rule '{"sonarjs/cognitive-complexity":["error",15]}'
 * ```
 *
 * That worked under an older ESLint and stopped working under flat config, and it
 * stopped *loudly and completely*: ESLint aborts with
 *
 * ```
 * A configuration object specifies rule "sonarjs/cognitive-complexity",
 * but could not find plugin "sonarjs".
 * ```
 *
 * and exits 2 having produced no report at all. A `--rule` flag is merged into a
 * configuration object of its own, and that object has no `plugins` — so naming a
 * plugin-scoped rule from the command line cannot resolve. The ratchet then hit its
 * own "eslint produced no report" branch and exited 1, which meant `pnpm complexity`
 * could not pass **on any host, including CI** — and it is a step in both `verify` and
 * `security:verify`. The repository's own rule is the reason this had to be found
 * rather than tolerated: a gate that cannot fail is a defect, and neither can a gate
 * that cannot pass.
 *
 * Registering the plugin in a real config object, in a file that also sets the rule to
 * `error` with the ratchet's ceiling, is the shape ESLint 9 expects. The base config
 * is spread first so the repository's own `ignores` still apply — without them the
 * measurement would include `dist`, `coverage` and `node_modules`.
 *
 * The ceiling arrives through the environment rather than as a generated file, so
 * `pnpm complexity` and `pnpm complexity:baseline` cannot drift into measuring
 * different rules.
 */
import base from '../eslint.config.js';
import sonarjs from 'eslint-plugin-sonarjs';

/** @type {number} */
const ceiling = Number(process.env['AUTOMATE_COMPLEXITY_CEILING'] ?? '15');

if (!Number.isInteger(ceiling) || ceiling < 1) {
  throw new Error(
    `AUTOMATE_COMPLEXITY_CEILING must be a positive integer, got ${String(ceiling)}. A ` +
      'complexity ceiling that is not a number would silently measure nothing, which is ' +
      'the one outcome this ratchet exists to rule out.',
  );
}

export default [
  ...base,
  {
    // The same glob the repository config registers `sonarjs` under. Matching it
    // matters: a rule enabled for files the plugin was not registered for is the error
    // this file replaced.
    files: ['**/*.{js,mjs,ts,tsx}'],
    plugins: { sonarjs },
    rules: {
      // `off` in `eslint.config.js`, and turned on only here — the ratchet is a
      // separate gate from `pnpm lint` precisely so a permanently red lint does not
      // take the rest of the rules down with it.
      'sonarjs/cognitive-complexity': ['error', ceiling],
    },
  },
];
