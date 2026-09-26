/**
 * Detects the container runtime, once, for every consumer.
 *
 * `oci:build` hardcoded `podman`, so a Docker-only host could not build the
 * runner images and `oci:verify` then failed for an unrelated reason — the
 * verification step blamed a host that merely lacked a different tool. This
 * module is the single list, imported by both scripts.
 *
 * Plain JavaScript with no dependencies: every script here is `.mjs`, and
 * `.mjs` files are not typechecked (see the plan's Q0.18.16).
 */
import { spawnSync } from 'node:child_process';

/** Container runtimes, in preference order. */
export const CONTAINER_RUNTIMES = ['docker', 'podman'];

/**
 * The runtime to use, or `null` when none is installed.
 *
 * Returned as a name so callers pass argv explicitly and never build a shell
 * string from it.
 */
export function detectContainerRuntime() {
  for (const runtime of CONTAINER_RUNTIMES) {
    const result = spawnSync(runtime, ['--version'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
    });
    if (!result.error && result.status === 0) return runtime;
  }
  return null;
}

/** Human-readable reason for a gate's `not_configured` message. */
export function noRuntimeMessage() {
  return (
    `no container runtime found (tried ${CONTAINER_RUNTIMES.join(', ')}). ` +
    'Install one, or run this step on a host that has it.'
  );
}
