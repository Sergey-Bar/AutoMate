/**
 * OCI runner image verification.
 *
 * The previous version re-read a hand-authored `manifest.json` and never
 * inspected an image, so a hand-typed 64-hex digest passed. It also had three
 * ways to be useless:
 *
 *  - every manifest in the repository carries `"imageDigest": null` and
 *    `"buildStatus": "unbuilt"`, so `verify:release` could never pass;
 *  - a missing manifest threw a raw stack trace from `readFileSync`;
 *  - the isolation claims (`user: 65532`, `network: "none"`, `readOnly: true`)
 *    were checked only against the same JSON that declared them, which proves
 *    nothing about the image the release would actually run.
 *
 * Now: the manifest is validated for shape, the container runtime is used to
 * inspect the real image, and the recorded digest must match the runtime's. When
 * no container runtime is available the gate reports `not_configured` and exits
 * non-zero — it never claims a pass it could not verify.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectContainerRuntime, noRuntimeMessage } from './container-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['playwright', 'k6', 'zap'];
/** @type {string[]} */
const failures = [];

/** The registry digest the runtime reports for a local image, if it has one. */
/** @param {string} runtime @param {string} imageRef @returns {string | null} */
function inspectImage(runtime, imageRef) {
  const result = spawnSync(
    runtime,
    ['image', 'inspect', imageRef, '--format', '{{json .RepoDigests}}'],
    { encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (result.error || result.status !== 0) return null;
  try {
    const digests = JSON.parse(result.stdout.trim() || 'null');
    return Array.isArray(digests) && typeof digests[0] === 'string' ? digests[0] : null;
  } catch {
    return null;
  }
}

const runtime = detectContainerRuntime();
if (runtime === null) {
  console.error(`OCI verification: not_configured — ${noRuntimeMessage()}`);
  process.exit(1);
}
console.info(`OCI verification using ${runtime}`);

for (const name of names) {
  const manifestPath = path.join(root, 'runners', name, 'manifest.json');
  if (!existsSync(manifestPath)) {
    failures.push(`${name}: missing runners/${name}/manifest.json`);
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push(
      `${name}: manifest is not valid JSON ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
    continue;
  }

  if (manifest.schemaVersion !== 1) failures.push(`${name}: unsupported schemaVersion`);
  if (manifest.buildStatus !== 'built')
    failures.push(
      `${name}: buildStatus is ${JSON.stringify(manifest.buildStatus)}, expected "built"`,
    );
  if (manifest.user !== 65532) failures.push(`${name}: declared user is not 65532`);
  if (manifest.network !== 'none' || manifest.readOnly !== true)
    failures.push(`${name}: declared isolation is incomplete`);

  const recorded = typeof manifest.imageDigest === 'string' ? manifest.imageDigest : null;
  if (recorded === null || !/^sha256:[a-f0-9]{64}$/.test(recorded)) {
    failures.push(`${name}: imageDigest is not a built sha256 digest`);
    continue;
  }

  // The part the old gate skipped entirely: does the recorded digest describe
  // the image that is actually present?
  if (manifest.imageRef) {
    const actual = inspectImage(runtime, manifest.imageRef);
    if (actual === null) {
      failures.push(`${name}: image ${manifest.imageRef} is not present locally`);
    } else if (actual !== recorded) {
      failures.push(
        `${name}: recorded digest ${recorded} does not match the image ` +
          `${manifest.imageRef} (${actual})`,
      );
    }
  } else {
    failures.push(
      `${name}: manifest declares no imageRef, so the digest cannot be checked against an image`,
    );
  }
}

if (failures.length > 0) {
  console.error('OCI verification blocked');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('OCI runner images verified against the container runtime');
