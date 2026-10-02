/**
 * OCI runner image verification.
 *
 * The previous version could never pass, which made it a gate nobody should have
 * trusted rather than one that happened to be strict:
 *
 *  - it required `"buildStatus": "built"` and a `sha256:` digest in each runner's
 *    manifest, and **nothing wrote either**, so the committed
 *    JSON carried a claim no build had made and the only way to satisfy the gate
 *    was to type the claim in by hand — the falsification its own header describes
 *    having removed;
 *  - it required a digest to match `RepoDigests`, which only exists for an image
 *    pushed to a registry. ADR-006's distribution model is a self-hosted compose
 *    install built on the host that runs it, so these images are never pushed and
 *    the check had nothing to compare;
 *  - it read the declared isolation out of the same JSON that declared it, which
 *    proves nothing about the image that would run.
 *
 * The rules now live in `oci-checks.mjs`, where they are testable without docker.
 * This script only gathers what the rules need and reports their answer. It
 * compares the image the runtime actually holds against the record `oci:build`
 * wrote in this run, checks that image's own configured user is not root, and
 * cross-checks the manifest's declared user against it.
 *
 * A registry digest is still compared whenever a manifest declares one, so
 * graduating `runner.oci` from `mock` arms a stronger check rather than requiring
 * this script to be rewritten. What is unavailable for a locally built image is
 * *reported* as unavailable — with what would change it — rather than reported as
 * a failure of the images.
 */
import { detectContainerRuntime, noRuntimeMessage } from './container-runtime.mjs';
import { evaluateOciVerification } from './oci-checks.mjs';
import { RUNNER_NAMES, inspectImage, readBuildRecord, readManifest } from './oci-images.mjs';

const runtime = detectContainerRuntime();
if (runtime === null) {
  console.error(`OCI verification: not_configured — ${noRuntimeMessage()}`);
  process.exit(1);
}
console.info(`OCI verification using ${runtime}`);

const record = readBuildRecord();
const observed = RUNNER_NAMES.map((name) => {
  const { manifest, problem } = readManifest(name);
  return {
    name,
    manifest,
    manifestProblem: problem,
    inspected: inspectImage(runtime, `automate/${name}:local`),
  };
});

const { failures, notes } = evaluateOciVerification({ record, observed });

if (notes.length > 0) {
  console.info('Not checked, because it is not available:');
  for (const note of notes) console.info(`- ${note}`);
}

if (failures.length > 0) {
  console.error('OCI verification blocked');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('OCI runner images verified against the container runtime');
