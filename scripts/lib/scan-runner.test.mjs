import assert from 'node:assert/strict';
import test from 'node:test';
import process from 'node:process';
import { describeWait, runBounded } from './scan-runner.mjs';

const cwd = process.cwd();

/**
 * The measurement behind this module.
 *
 * `pnpm security:static` spawned both scanners with `spawnSync` and no timeout, and
 * `semgrep scan --config .semgrep.yml` over a *single* small package
 * (`apps/worker/src`) produced no output and no exit in 15 minutes. The gate was
 * killed at 30 and at 50 minutes. That is worse than a red gate: it hid the state the
 * gate exists to report, which is the 27 historical gitleaks findings
 * `.gitleaks.toml` deliberately leaves red.
 *
 * So the ceiling is the feature, and these cases use a child that genuinely never
 * returns rather than a stub — a stub that returns immediately would pass a
 * `setTimeout` that was never wired to anything.
 *
 * `setInterval`, not a bare `() => {}`: the latter is an expression statement that does
 * nothing, so node exits at once and the "hanging" child finishes in 30 ms.
 */
const hangsForever = 'setInterval(() => {}, 1000)';

test('a scanner that finishes returns its exit status', async () => {
  const result = await runBounded(process.execPath, ['-e', 'process.exit(3)'], {
    cwd,
    timeoutMs: 30_000,
  });
  assert.equal(result.status, 3);
  assert.equal(result.timedOut, false);
});

test('a scanner that succeeds returns zero', async () => {
  const result = await runBounded(process.execPath, ['-e', 'process.exit(0)'], {
    cwd,
    timeoutMs: 30_000,
  });
  assert.equal(result.status, 0);
});

test('a scanner that never returns is stopped, and reported as stopped', async () => {
  /** @type {string[]} */
  const messages = [];
  const started = Date.now();
  const result = await runBounded(process.execPath, ['-e', hangsForever], {
    cwd,
    timeoutMs: 2_000,
    log: (message) => messages.push(message),
  });
  const elapsed = Date.now() - started;
  assert.equal(result.timedOut, true);
  assert.equal(result.status, 1, 'a scanner that never returns must not be a pass');
  // It actually stopped, rather than reporting a timeout while the child kept running.
  assert.ok(
    elapsed < 60_000,
    `the runner waited ${String(elapsed)}ms, so it did not stop the child`,
  );
  assert.equal(messages.length, 1);
  assert.match(messages[0], /did not finish within/);
  // The message has to say which scanner and how long it waited, because "the security
  // gate timed out" is not an answer anybody can act on.
  assert.match(messages[0], /A scan that never returns is not a pass/);
});

test('a scanner that does not exist is reported, not treated as a pass', async () => {
  /** @type {string[]} */
  const messages = [];
  const result = await runBounded('automate-no-such-scanner-binary', [], {
    cwd,
    timeoutMs: 10_000,
    log: (message) => messages.push(message),
  });
  assert.equal(result.failedToStart, true);
  assert.equal(result.status, 1);
  assert.match(messages[0], /could not be run/);
});

test('the wait is described in a unit a reader can use', () => {
  // 90s as "2m" would be a rounding lie in the failure message a human reads at 2am.
  assert.equal(describeWait(90_000), '2m');
  assert.equal(describeWait(10 * 60 * 1000), '10m');
  assert.equal(describeWait(30_000), '30s');
});
