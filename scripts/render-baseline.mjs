/**
 * `pnpm render:baseline` — record the rendering ceilings from a real run.
 *
 * **Why this is a wrapper and not a flag.** The first version was
 * `playwright test --project=rendering-budget --update`, with the spec reading
 * `process.argv`. Playwright's CLI validates its own options and rejects anything it
 * does not recognise, so the command failed with `error: unknown option '--update'`
 * before a single spec ran — and the flag could never have reached `process.argv` in
 * the first place. The failure was total but silent about itself: `render:baseline` is
 * `never-in-ci`, so nothing in the pipeline would ever have noticed that the only way
 * to populate the rendering budget did not work. That is the same shape as E-2 and
 * E-3, and it is why the fix is a script rather than a convention.
 *
 * An environment variable is what actually crosses the process boundary, and this
 * mirrors the repository's existing precedent: `complexity:baseline` is
 * `node ./scripts/complexity-gate.mjs --write` and `coverage:baseline` works the same
 * way — a gate's baseline writer is a node script, not a flag bolted onto somebody
 * else's CLI.
 *
 * **Run it deliberately.** This rewrites `performance/rendering-budget.json` from a
 * live measurement, and the recorded numbers are the floor every later change has to
 * beat. That is why it is `never-in-ci`: a gate that can rewrite its own threshold in
 * the same commit is a gate that agrees with the tree instead of the code. Read the
 * diff before committing it.
 *
 * The run needs a real browser and a real PostgreSQL, and it is not a substitute for
 * the reference hardware the plan's D10 describes — a GitHub runner would record the
 * wrong ceiling just as honestly as a guess would.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

const result = spawnSync('npx', ['playwright', 'test', '--project=rendering-budget'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AUTOMATE_RENDER_BASELINE: '1' },
});

if (result.error !== undefined) {
  console.error('render:baseline: could not start Playwright.');
  console.error(result.error.message);
  process.exit(1);
}

if (result.status !== 0) {
  // The spec reports what it measured and where it wrote it; this only adds the part
  // a reader needs afterwards, which is that the diff is theirs to judge.
  console.error(
    'render:baseline: the run did not complete, so performance/rendering-budget.json ' +
      'was not updated. A baseline that was not measured must not be recorded.',
  );
  process.exit(result.status ?? 1);
}

console.info(
  'render:baseline: recorded. Read the diff against the previous ceilings before ' +
    'committing — the numbers you are about to accept are the floor every later change ' +
    'has to beat.',
);
