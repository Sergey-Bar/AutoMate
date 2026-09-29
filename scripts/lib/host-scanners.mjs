/**
 * The host-degradation rule for the static-analysis gate.
 *
 * `scripts/static-analysis.mjs` exits non-zero when it cannot produce a security
 * scan, on the reasoning that an unrun scan is not a pass. That reasoning is right,
 * and it is the reason CI can trust the gate — but it is also why `security:static`
 * cannot complete on a host where `semgrep` is pip-installed and never returns.
 * The result is a developer who cannot run `pnpm verify` at all, which is a
 * different failure and the worse one.
 *
 * The compromise is one explicit opt-in, `AUTOMATE_HOST_SCANNERS=unavailable`, and
 * it is narrow on purpose:
 *
 *   - absent (the default, and every CI job) — behaviour is unchanged: a scanner
 *     that could not produce a scan is a failure;
 *   - set, and a scanner could not produce a scan — the gate records
 *     `not_configured`, exits 0, and says in that message that it is enforced in CI.
 *     "Could not produce a scan" covers all three ways that happens: not installed,
 *     not startable, and killed at the ceiling;
 *   - set, and a scanner *ran* and reported something — still a failure. The opt-in
 *     covers "this host cannot scan", never "the scan was skipped", and a hung
 *     scanner is explicitly not treated as a finding.
 *
 * That last distinction is the one worth stating out loud. It would be easy, and
 * wrong, to read a timeout as a clean result: a 10-minute stall would become a
 * green security gate. It does not, because a timeout is `unavailable`, not
 * `found`, and only `unavailable` is degradable.
 *
 * The policy lives here, separate from the script that spawns processes, so a test
 * can prove the boundary without a 10-minute `semgrep scan`.
 */

/** The env var a host sets to opt in to the degraded outcome. @type {string} */
export const HOST_SCANNERS_ENV = 'AUTOMATE_HOST_SCANNERS';

/** The only value that opts in. `true`/`1` do not, so a stray CI default cannot. */
export const HOST_SCANNERS_UNAVAILABLE = 'unavailable';

/**
 * @param {Record<string, string | undefined>} env
 * @returns {boolean}
 */
export function isHostDegradationOptedIn(env) {
  return env[HOST_SCANNERS_ENV] === HOST_SCANNERS_UNAVAILABLE;
}

/**
 * @typedef {object} ScanOutcome
 * @property {string[]} unavailable scanners that could not produce a scan, each with a reason
 * @property {boolean} found        a scanner that ran and reported something
 * @property {boolean} degraded     the host opted into the relaxed outcome
 */

/**
 * The one-line record written in place of a pass, naming the variable that
 * degraded the gate so the line cannot be mistaken for a clean scan.
 *
 * @param {string[]} unavailable
 * @returns {string}
 */
export function notConfiguredMessage(unavailable) {
  return (
    `Static analysis: not_configured — ${unavailable.join('; ')}. ` +
    `Skipped under the explicit ${HOST_SCANNERS_ENV} opt-in; enforced in CI, where the ` +
    'scanners are installed. The structural config check did run and passed.'
  );
}

/**
 * @param {ScanOutcome} outcome
 * @returns {number} the process exit status
 */
export function exitStatusFor(outcome) {
  if (outcome.found) return 1;
  if (outcome.unavailable.length > 0 && !outcome.degraded) return 1;
  return 0;
}

/**
 * How `scripts/verify-local.mjs` invokes pnpm.
 *
 * Split out so a test can assert the two platform answers without spawning
 * anything, because one of them was wrong and nothing caught it: `pnpm` is a
 * `.cmd` shim on Windows, and `child_process.spawn` refuses a `.cmd` without a
 * shell — `EINVAL`, before a single gate step runs. So `verify:local` was
 * broken on the exact platform whose problem it was written to solve, and the
 * failure looked like a broken repository rather than a broken script.
 *
 * The shell is Windows-only, and that asymmetry is deliberate. Enabling it
 * everywhere would re-open argument injection on POSIX (CVE-2024-27980), and
 * there the shim is a real executable that needs no shell at all.
 *
 * @param {string} platform `process.platform`
 * @param {Record<string, string | undefined>} env
 * @returns {{ command: string, args: string[], options: { stdio: 'inherit', shell: boolean, env: Record<string, string | undefined> } }}
 */
export function verifyLocalInvocation(platform, env) {
  const isWindows = platform === 'win32';
  return {
    command: isWindows ? 'pnpm.cmd' : 'pnpm',
    args: ['verify'],
    options: {
      stdio: 'inherit',
      shell: isWindows,
      env: { ...env, [HOST_SCANNERS_ENV]: HOST_SCANNERS_UNAVAILABLE },
    },
  };
}
