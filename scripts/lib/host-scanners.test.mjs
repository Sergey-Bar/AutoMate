import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SCAN_TIMEOUT_MS,
  HOST_SCANNERS_ENV,
  HOST_SCANNERS_UNAVAILABLE,
  MAX_SCAN_TIMEOUT_MS,
  MIN_SCAN_TIMEOUT_MS,
  exitStatusFor,
  isHostDegradationOptedIn,
  notConfiguredMessage,
  scanTimeoutMs,
  verifyLocalInvocation,
} from './host-scanners.mjs';

test('the opt-in is off unless the env var is set to the exact value', () => {
  assert.equal(isHostDegradationOptedIn({}), false);
  assert.equal(isHostDegradationOptedIn({ [HOST_SCANNERS_ENV]: '' }), false);
  assert.equal(isHostDegradationOptedIn({ [HOST_SCANNERS_ENV]: 'true' }), false);
  assert.equal(isHostDegradationOptedIn({ [HOST_SCANNERS_ENV]: '1' }), false);
  assert.equal(isHostDegradationOptedIn({ [HOST_SCANNERS_ENV]: HOST_SCANNERS_UNAVAILABLE }), true);
});

test('a scanner that could not scan is a failure without the opt-in', () => {
  // The behaviour that shipped: an unrun security scan is not a pass, and
  // reporting it as one is the defect the script exists to end. The opt-in is
  // additive; it does not become the default by being written.
  const outcome = exitStatusFor({
    unavailable: ['semgrep is not installed'],
    found: false,
    degraded: false,
  });
  assert.equal(outcome, 1);
});

test('a recorded not_configured pass with the opt-in, naming what and why', () => {
  const outcome = exitStatusFor({
    unavailable: ['semgrep is not installed'],
    found: false,
    degraded: true,
  });
  assert.equal(outcome, 0);
  const message = notConfiguredMessage(['semgrep is not installed']);
  assert.match(message, /not_configured/);
  // The message has to name the variable, or a reader cannot tell whether the
  // degradation was opted into or the gate simply lost the scanner.
  assert.ok(message.includes(HOST_SCANNERS_ENV));
  assert.ok(message.includes('enforced in CI'));
  assert.ok(message.includes('semgrep is not installed'));
});

test('a scanner that ran and found something fails even with the opt-in', () => {
  // The opt-in covers "this host cannot scan". It does not cover "the scan found
  // something", which is the whole point of running it.
  const outcome = exitStatusFor({
    unavailable: ['gitleaks was killed at the 10m ceiling'],
    found: true,
    degraded: true,
  });
  assert.equal(outcome, 1);
});

test('a scanner killed at the ceiling is unavailable, never a clean scan', () => {
  // The specific failure this opt-in was written for: on this host `semgrep` is
  // pip-installed, `semgrep --version` answers in two seconds, and `semgrep scan`
  // never returns. Reading that stall as "nothing found" would turn a ten-minute
  // hang into a green security gate.
  const hung = exitStatusFor({
    unavailable: ['semgrep was killed at the 10m ceiling without producing a scan'],
    found: false,
    degraded: true,
  });
  assert.equal(hung, 0, 'degraded, and recorded as not_configured rather than as a pass');
  assert.match(notConfiguredMessage(['semgrep was killed at the 10m ceiling']), /not_configured/);
});

test('nothing unavailable and nothing found is a pass in both modes', () => {
  assert.equal(exitStatusFor({ unavailable: [], found: false, degraded: false }), 0);
  assert.equal(exitStatusFor({ unavailable: [], found: false, degraded: true }), 0);
});

test('verify:local runs the real verify chain, with the opt-in set', () => {
  const { args, options } = verifyLocalInvocation('linux', {});
  assert.deepEqual(args, ['verify'], 'verify:local must not define a second, smaller chain');
  assert.equal(options.env[HOST_SCANNERS_ENV], HOST_SCANNERS_UNAVAILABLE);
  // Set on the child only, so a green `verify:local` leaves nothing behind in the
  // shell for the next command to inherit.
  assert.deepEqual(options.env, { [HOST_SCANNERS_ENV]: HOST_SCANNERS_UNAVAILABLE });
});

test('verify:local spawns pnpm in a way Windows accepts', () => {
  // This is the bug these two assertions exist for. `pnpm` is a `.cmd` shim on
  // Windows, and `child_process.spawn` refuses a `.cmd` without a shell — `EINVAL`,
  // thrown before any gate step runs. The first version of the script passed
  // `shell: false` unconditionally, so it failed on the only platform whose
  // problem it existed to solve, and the error named a spawn rather than a
  // configuration.
  const windows = verifyLocalInvocation('win32', {});
  assert.equal(windows.command, 'pnpm.cmd');
  assert.equal(windows.options.shell, true, 'win32 needs a shell to run a .cmd shim');
});

test('verify:local does not open argument injection on POSIX', () => {
  // The asymmetry is deliberate and load-bearing: a shell on Linux re-opens
  // CVE-2024-27980, and there the shim is a real executable that needs none.
  const posix = verifyLocalInvocation('linux', {});
  assert.equal(posix.command, 'pnpm');
  assert.equal(posix.options.shell, false);
});

test('the scan ceiling cannot be set small enough to guarantee no scan', () => {
  // The second way through the same door as the opt-in, and the more dangerous
  // one because it was unmentioned in the manifest, the policy module, and every
  // test. A scanner killed at the ceiling is `unavailable`; `unavailable` is
  // what the opt-in turns into a pass. So a one-millisecond ceiling produced a
  // green `security:static` in milliseconds with nothing scanned — through a
  // variable whose only documented purpose was to *raise* the budget on a slow
  // host.
  assert.equal(scanTimeoutMs('1'), MIN_SCAN_TIMEOUT_MS);
  assert.equal(scanTimeoutMs('0'), MIN_SCAN_TIMEOUT_MS);
  assert.equal(scanTimeoutMs('-1'), MIN_SCAN_TIMEOUT_MS);
  // `setTimeout(fn, NaN)` fires on the next tick, so a non-numeric value is not
  // an ignored value — it is an instant kill.
  assert.equal(scanTimeoutMs('abc'), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(scanTimeoutMs(''), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(scanTimeoutMs(undefined), DEFAULT_SCAN_TIMEOUT_MS);
  assert.equal(scanTimeoutMs('Infinity'), DEFAULT_SCAN_TIMEOUT_MS);
});

test('the scan ceiling stays a ceiling', () => {
  // The upper bound exists for the reason the lower one does: `1e18` restores
  // exactly the unbounded budget `scan-runner.mjs` was extracted to eliminate.
  assert.equal(scanTimeoutMs('1e18'), MAX_SCAN_TIMEOUT_MS);
  assert.equal(scanTimeoutMs(String(Number.MAX_SAFE_INTEGER)), MAX_SCAN_TIMEOUT_MS);
  // And an ordinary override in the middle is honoured, or the clamp would
  // silently ignore the one thing the variable is for.
  assert.equal(scanTimeoutMs('900000'), 900_000);
});
