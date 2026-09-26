/**
 * Writing a built image back into its runner manifest.
 *
 * `oci-verify.mjs` refuses a manifest whose `imageDigest` is not a built sha256
 * digest, whose `buildStatus` is not `built`, or that declares no `imageRef`. Every
 * manifest in the repository ships `"imageDigest": null, "buildStatus": "unbuilt"`,
 * and `oci-build.mjs` never wrote them back, so `verify:release` could not pass and
 * the two scripts disagreed about who was responsible for the fields.
 *
 * `oci-build` is the only party that knows what it just built, so the writeback is
 * its job. The verification then has something real to check: not a hand-typed
 * digest, but the identity the container runtime reports for the image that is
 * actually present.
 *
 * Free of `node:fs` and of any container runtime, so the decision is testable
 * without Docker.
 */

/** A sha256 content digest, as both Docker and Podman report it. */
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

/**
 * @typedef {{
 *   schemaVersion?: number,
 *   name?: string,
 *   toolVersion?: string,
 *   imageDigest?: string | null,
 *   imageRef?: string,
 *   buildStatus?: string,
 *   [key: string]: unknown,
 * }} RunnerManifest
 */

/**
 * @param {unknown} value
 * @returns {value is RunnerManifest}
 */
function isManifest(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The fields a build writes, and nothing else.
 *
 * Reconstructing the manifest from its known keys rather than spreading the parsed
 * object is deliberate. A writeback that preserved whatever it read would also
 * preserve a typo, and this file is the thing `oci-verify` trusts; a field it did
 * not expect should be dropped rather than laundered into the next build's output.
 *
 * @param {RunnerManifest} manifest
 * @param {{ imageRef: string, imageDigest: string }} built
 * @returns {RunnerManifest}
 */
export function applyBuildResult(manifest, built) {
  const keys = [
    'schemaVersion',
    'name',
    'toolVersion',
    'user',
    'network',
    'readOnly',
    'capabilities',
    'resources',
  ];
  /** @type {RunnerManifest} */
  const next = {};
  for (const key of keys) {
    if (manifest[key] !== undefined) next[key] = manifest[key];
  }
  next.imageRef = built.imageRef;
  next.imageDigest = built.imageDigest;
  next.buildStatus = 'built';
  return next;
}

/**
 * Can this build result be written back?
 *
 * @param {unknown} manifest
 * @param {{ imageRef: string, imageDigest: string } | null} built
 * @returns {string | null} a finding, or null when the writeback is sound
 */
export function buildWritebackFinding(manifest, built) {
  if (!isManifest(manifest)) return 'the manifest is not a JSON object';
  if (built === null) {
    return (
      'the container runtime reported no digest for the image just built, so the ' +
      'identity cannot be recorded. A manifest left claiming "unbuilt" after a ' +
      'successful build is worse than a failed build, because the next verify ' +
      'cannot tell the two apart.'
    );
  }
  if (built.imageRef.trim() === '') return 'the build reported no image reference';
  if (!DIGEST_PATTERN.test(built.imageDigest)) {
    return (
      `the reported digest ${JSON.stringify(built.imageDigest)} is not a sha256 ` +
      'content digest, so it would not survive verification'
    );
  }
  return null;
}

/**
 * Does a recorded digest match what the runtime reports?
 *
 * A locally built image has no `RepoDigests` — those are assigned by a registry on
 * push — so its only stable identity is the image ID. Both scripts therefore accept
 * a match against the image ID or against a registry digest, and the build records
 * the one it actually has rather than the one it wishes it had.
 *
 * @param {string} recorded
 * @param {{ imageId: string | null, repoDigest: string | null }} actual
 * @returns {boolean}
 */
export function digestMatches(recorded, actual) {
  if (!DIGEST_PATTERN.test(recorded)) return false;
  return actual.imageId === recorded || actual.repoDigest === recorded;
}
