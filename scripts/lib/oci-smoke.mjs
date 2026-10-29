/**
 * The rules `pnpm oci:smoke` applies: how a runner image is started, and what counts as
 * having started. Kept apart from the script so they are testable without a container
 * runtime.
 *
 * `oci:build` builds the images and `oci:verify` inspects them; neither starts one. The
 * ZAP image exited 1 on every start as its own user (ledger MNT-157) with both gates green.
 */

/** Long enough for ZAP's JVM, which took 15-37 s on a developer machine. */
export const SMOKE_TIMEOUT_MS = 180_000;

/**
 * @typedef {{
 *   user?: unknown,
 *   network?: unknown,
 *   readOnly?: unknown,
 *   resources?: { cpu?: unknown, memoryMb?: unknown, pids?: unknown },
 * }} SmokeManifest
 */

/**
 * `run` arguments that start the image under the isolation its manifest declares, with
 * every capability dropped. The image's own entrypoint is what runs.
 *
 * @param {string} imageRef
 * @param {SmokeManifest} manifest
 * @returns {string[]}
 */
export function smokeRunArgs(imageRef, manifest) {
  const user = manifest.user;
  if (typeof user !== 'number' || !Number.isInteger(user)) {
    throw new Error(`${imageRef}: the manifest declares no numeric user`);
  }
  if (user === 0) throw new Error(`${imageRef}: the manifest declares root`);
  const args = ['run', '--rm', '--user', `${String(user)}:${String(user)}`];
  args.push('--network', typeof manifest.network === 'string' ? manifest.network : 'none');
  args.push('--cap-drop', 'ALL', '--security-opt', 'no-new-privileges');
  if (manifest.readOnly === true) {
    args.push('--read-only', '--tmpfs', `/tmp:uid=${String(user)},gid=${String(user)}`);
  }
  const resources = manifest.resources ?? {};
  if (typeof resources.memoryMb === 'number') args.push('--memory', `${resources.memoryMb}m`);
  if (typeof resources.pids === 'number') args.push('--pids-limit', String(resources.pids));
  if (typeof resources.cpu === 'number') args.push('--cpus', String(resources.cpu));
  args.push(imageRef);
  return args;
}

/**
 * @param {{ status: number | null, signal: string | null, timedOut: boolean, output: string }} run
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function smokeVerdict(run) {
  if (run.timedOut) {
    return { ok: false, reason: `did not exit within ${String(SMOKE_TIMEOUT_MS / 1000)} s` };
  }
  if (run.status === null)
    return { ok: false, reason: `was stopped by ${run.signal ?? 'a signal'}` };
  if (run.status !== 0) return { ok: false, reason: `exited ${String(run.status)}` };
  if (run.output.trim() === '') return { ok: false, reason: 'exited 0 with no output' };
  return { ok: true };
}
