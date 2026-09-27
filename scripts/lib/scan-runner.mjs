/**
 * Runs an external scanner to completion, or kills it at a ceiling and says so.
 *
 * Extracted from `scripts/static-analysis.mjs` so it can be tested. The CLI is a
 * top-level script whose whole job is to spawn binaries, so a test that wants to prove
 * the ceiling works has nothing to import — and "it has a timeout" is exactly the kind
 * of claim that decays silently.
 */
import { spawn, spawnSync } from 'node:child_process';

/**
 * @typedef {object} ScanOptions
 * @property {string} cwd
 * @property {number} timeoutMs
 * @property {(message: string) => void} [log]
 */

/** @param {number} ms */
function describeWait(ms) {
  if (ms >= 60_000) return `${String(Math.round(ms / 60_000))}m`;
  return `${String(Math.round(ms / 1000))}s`;
}

/**
 * Kills a process and everything it started.
 *
 * `child.kill()` alone is not enough on Windows: `semgrep` is a Python launcher that
 * starts a child, and killing the launcher orphans the work and leaves the inherited
 * stdio open, so the parent still waits forever. `taskkill /T` is the only thing on
 * this platform that takes the tree.
 *
 * @param {import('node:child_process').ChildProcess} child
 */
function killTree(child) {
  if (process.platform === 'win32' && child.pid !== undefined) {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGKILL');
}

/**
 * Runs one scanner, bounded.
 *
 * Async and shell-free on purpose. `spawnSync`'s own `timeout` is not enough: with
 * `shell: true` on Windows the child is `cmd.exe`, and killing `cmd.exe` leaves the
 * real scanner running with the inherited pipe open, so `spawnSync` blocks on the
 * read anyway. Measured: adding `timeout` to a `shell: true` `spawnSync` did not stop
 * a 15-minute `semgrep scan`.
 *
 * @param {string} binary
 * @param {string[]} args
 * @param {ScanOptions} options
 * @returns {Promise<{ status: number, timedOut: boolean, failedToStart: boolean }>}
 */
export function runBounded(binary, args, options) {
  const log = options.log ?? (() => undefined);
  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(binary, args, { cwd: options.cwd, stdio: 'inherit' });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);
    child.on('error', (failure) => {
      clearTimeout(timer);
      log(`${binary} could not be run: ${failure.message}`);
      resolve({ status: 1, timedOut: false, failedToStart: true });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        log(
          `${binary} did not finish within ${describeWait(options.timeoutMs)} and was ` +
            'stopped. A scan that never returns is not a pass.',
        );
        resolve({ status: 1, timedOut: true, failedToStart: false });
        return;
      }
      resolve({ status: code ?? 1, timedOut: false, failedToStart: false });
    });
  });
}

export { describeWait };
