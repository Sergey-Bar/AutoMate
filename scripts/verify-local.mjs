/**
 * Runs the `verify` chain with the host-scanner opt-in set.
 *
 * `pnpm verify` is the real gate, and it is red on a host with no `semgrep` and
 * no `gitleaks` — or, on this one, with a `semgrep` that answers `--version` in
 * two seconds and never returns from `scan`. That redness is correct, because an
 * unrun security scan is not a pass, and it is also why a developer on such a
 * host cannot run any of the other twelve steps. This script is the named
 * compromise: same chain, one env var, and a name that says out loud that it is
 * not `verify`.
 *
 * The env is set on the spawned process only, so a `verify:local` that passes
 * cannot leave the variable behind for the next command in the shell. It is
 * never set in a workflow — `scripts/lib/gate-tooling.test.mjs` fails if one is.
 *
 * The invocation itself is `verifyLocalInvocation` in `scripts/lib/host-scanners.mjs`,
 * because the platform detail is where this script's first version was wrong:
 * `pnpm` is a `.cmd` shim on Windows and `spawn` refuses a `.cmd` without a
 * shell, so this file failed with `EINVAL` on the one platform that needed it.
 */
import { spawn } from 'node:child_process';
import { verifyLocalInvocation } from './lib/host-scanners.mjs';

const { command, args, options } = verifyLocalInvocation(process.platform, process.env);
const child = spawn(command, args, options);

child.on('error', (failure) => {
  console.error(`verify:local could not start pnpm: ${failure.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  process.exit(signal ? 1 : (code ?? 1));
});
