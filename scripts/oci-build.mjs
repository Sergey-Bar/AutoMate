/**
 * Builds the OCI runner images and records what was built.
 *
 * The old script hardcoded `podman`, so a Docker-only host could not build
 * anything, and `oci:verify` then failed for a reason that had nothing to do
 * with the images. Runtime detection is shared with `oci-verify.mjs`.
 *
 * It also recorded nothing. The verifier demanded `"buildStatus": "built"` and a
 * digest that no code path could ever write, so the two halves could not agree —
 * and the only way to make them agree was to type the claim into a committed file
 * by hand. This now writes what the runtime reports about the image it just
 * produced, at build time, to a path under `var/` that is gitignored. The verifier
 * compares that record against the image it finds later, so a swapped or rebuilt
 * image fails rather than passing on the strength of a stale record.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { detectContainerRuntime, noRuntimeMessage } from './container-runtime.mjs';
import {
  BUILD_RECORD_SCHEMA,
  RUNNER_NAMES,
  imageRefOf,
  inspectImage,
  root,
  writeBuildRecord,
} from './oci-images.mjs';

const runtime = detectContainerRuntime();
if (runtime === null) {
  console.error(`OCI build: not_configured — ${noRuntimeMessage()}`);
  process.exit(1);
}

console.info(`OCI build using ${runtime}`);

/** @type {Record<string, object>} */
const built = {};

for (const name of RUNNER_NAMES) {
  const context = path.join(root, 'runners', name);
  const result = spawnSync(runtime, ['build', '-t', imageRefOf(name), context], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`OCI build failed for runners/${name}`);
    process.exit(result.status ?? 1);
  }

  // The build succeeded, so the image is present; if it is not inspectable that is
  // a runtime that cannot answer the question `oci:verify` is about to ask, and
  // recording an empty record would turn that into a green gate.
  const inspected = inspectImage(runtime, imageRefOf(name));
  if (inspected === null || inspected.id === '') {
    console.error(
      `OCI build produced runners/${name} but the runtime cannot inspect ` +
        `${imageRefOf(name)}. Refusing to record a build that cannot be verified.`,
    );
    process.exit(1);
  }
  built[name] = {
    imageRef: imageRefOf(name),
    imageId: inspected.id,
    user: inspected.user,
    repoDigests: inspected.repoDigests,
  };
}

const written = writeBuildRecord({ schemaVersion: BUILD_RECORD_SCHEMA, runtime, images: built });

console.info(`OCI build finished for ${RUNNER_NAMES.length} images`);
console.info(`OCI build record written to ${written}`);
