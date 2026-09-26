/**
 * Builds the OCI runner images with whichever container runtime is installed.
 *
 * The old script hardcoded `podman`, so a Docker-only host could not build
 * anything, and `oci:verify` then failed for a reason that had nothing to do
 * with the images. Runtime detection is shared with `oci-verify.mjs`.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectContainerRuntime, noRuntimeMessage } from './container-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = ['playwright', 'k6', 'zap'];

const runtime = detectContainerRuntime();
if (runtime === null) {
  console.error(`OCI build: not_configured — ${noRuntimeMessage()}`);
  process.exit(1);
}

console.info(`OCI build using ${runtime}`);
for (const name of images) {
  const context = path.join(root, 'runners', name);
  const result = spawnSync(runtime, ['build', '-t', `automate/${name}:local`, context], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`OCI build failed for runners/${name}`);
    process.exit(result.status ?? 1);
  }
}
console.info(`OCI build finished for ${images.length} images`);
