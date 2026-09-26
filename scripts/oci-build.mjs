/**
 * Builds the OCI runner images with whichever container runtime is installed, and
 * records what it built.
 *
 * The old script hardcoded `podman`, so a Docker-only host could not build
 * anything, and `oci:verify` then failed for a reason that had nothing to do with
 * the images. Runtime detection is shared with `oci-verify.mjs`.
 *
 * It also built the images and told no one. `oci-verify` requires every manifest to
 * carry a built `imageDigest`, an `imageRef`, and `buildStatus: "built"`, and all
 * three shipped as `null`/`unbuilt` with nothing ever writing them back — so
 * `verify:release` could not pass no matter how many times the build succeeded.
 * This writes them, which is the only party that knows the answer.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectContainerRuntime, noRuntimeMessage } from './container-runtime.mjs';
import { applyBuildResult, buildWritebackFinding } from './lib/oci-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = ['playwright', 'k6', 'zap'];

// A copy of this script has the same write authority as the original: it rewrites
// `runners/*/manifest.json` relative to wherever it lives. Refused outside a
// checkout, so running a copy from a scratch directory cannot rewrite manifests in
// whatever relative `runners/` happened to resolve to.
if (!existsSync(path.join(root, 'pnpm-workspace.yaml'))) {
  console.error(
    `OCI build refused to run: ${root} is not a repository root ` +
      '(no pnpm-workspace.yaml). Run it from a checkout, via `pnpm oci:build`.',
  );
  process.exit(1);
}

const runtime = detectContainerRuntime();
if (runtime === null) {
  console.error(`OCI build: not_configured — ${noRuntimeMessage()}`);
  process.exit(1);
}

/**
 * The image's content identity, as the runtime reports it.
 *
 * A locally built image has no `RepoDigests`: those are assigned by a registry on
 * push. Its stable identity is the image ID, which is a `sha256:` digest and is
 * what `oci-verify` compares against.
 *
 * @param {string} runtime the detected runtime, passed explicitly so the narrowing
 *   from the `not_configured` check above carries into the call
 * @param {string} imageRef
 * @returns {{ imageRef: string, imageDigest: string } | null}
 */
function inspectBuilt(runtime, imageRef) {
  const result = spawnSync(runtime, ['image', 'inspect', imageRef, '--format', '{{.Id}}'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (result.error || result.status !== 0) return null;
  const digest = (result.stdout ?? '').trim();
  return { imageRef, imageDigest: digest };
}

console.info(`OCI build using ${runtime}`);
/** @type {string[]} */
const failures = [];

for (const name of images) {
  const context = path.join(root, 'runners', name);
  const imageRef = `automate/${name}:local`;
  const result = spawnSync(runtime, ['build', '-t', imageRef, context], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`OCI build failed for runners/${name}`);
    process.exit(result.status ?? 1);
  }

  const built = inspectBuilt(runtime, imageRef);
  const manifestPath = path.join(root, 'runners', name, 'manifest.json');
  if (!existsSync(manifestPath)) {
    failures.push(`${name}: built ${imageRef} but runners/${name}/manifest.json does not exist`);
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    failures.push(
      `${name}: built ${imageRef} but its manifest is not valid JSON ` +
        `(${error instanceof Error ? error.message : String(error)})`,
    );
    continue;
  }

  const finding = buildWritebackFinding(manifest, built);
  if (finding !== null || built === null) {
    // `finding` is non-null whenever `built` is null, so this is the one branch.
    failures.push(`${name}: ${finding ?? 'the runtime reported no digest for the image'}`);
    continue;
  }

  writeFileSync(
    manifestPath,
    `${JSON.stringify(applyBuildResult(manifest, built), null, 2)}\n`,
    'utf8',
  );
  console.info(`  recorded ${imageRef} as ${built.imageDigest}`);
}

if (failures.length > 0) {
  console.error('OCI build produced images that could not be recorded');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error(
    'Leaving a manifest claiming "unbuilt" after a successful build is worse than ' +
      'a failed build, so this is a failure rather than a warning.',
  );
  process.exit(1);
}
console.info(`OCI build finished for ${images.length} images`);
