/**
 * Start every runner image `oci:build` produced, under the isolation its manifest
 * declares, and fail unless each one exits 0 with output inside the time limit.
 *
 * Needs `pnpm oci:build` first. The rules are in `scripts/lib/oci-smoke.mjs`.
 */
import { spawnSync } from 'node:child_process';
import { detectContainerRuntime, noRuntimeMessage } from './container-runtime.mjs';
import { SMOKE_TIMEOUT_MS, smokeRunArgs, smokeVerdict } from './lib/oci-smoke.mjs';
import { RUNNER_NAMES, imageRefOf, readManifest } from './oci-images.mjs';

const runtime = detectContainerRuntime();
if (runtime === null) {
  console.error(`OCI smoke: not_configured - ${noRuntimeMessage()}`);
  process.exit(1);
}

/** @type {string[]} */
const failures = [];
for (const name of RUNNER_NAMES) {
  const { manifest, problem } = readManifest(name);
  if (manifest === null) {
    failures.push(`${name}: ${problem ?? 'no manifest'}`);
    continue;
  }
  const args = smokeRunArgs(imageRefOf(name), manifest);
  const started = Date.now();
  const result = spawnSync(runtime, args, {
    encoding: 'utf8',
    timeout: SMOKE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const timedOut =
    result.error !== undefined && 'code' in result.error && result.error.code === 'ETIMEDOUT';
  const verdict = smokeVerdict({ status: result.status, signal: result.signal, timedOut, output });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (verdict.ok) {
    const shown = (result.stdout ?? '').trim() === '' ? output : (result.stdout ?? '');
    const last = shown.trim().split('\n').at(-1) ?? '';
    console.info(`${name}: started and exited 0 in ${seconds} s (${last.trim()})`);
  } else {
    failures.push(`${name}: ${verdict.reason}`);
    console.error(`${name}: ${verdict.reason} after ${seconds} s. Last output:`);
    console.error(output.trim().split('\n').slice(-10).join('\n'));
  }
}

if (failures.length > 0) {
  console.error('OCI smoke failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`OCI smoke: ${String(RUNNER_NAMES.length)} runner images start under their manifests`);
