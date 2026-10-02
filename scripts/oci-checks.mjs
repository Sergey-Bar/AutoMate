/**
 * The rules `oci:verify` enforces, as a pure function.
 *
 * Split out because the checks used to live inside a script that read files,
 * spawned a runtime and called `process.exit`, which is why neither it nor
 * `oci:build.mjs` had a test: the behaviour could only be observed by running
 * docker, on a machine that had it. The rules are decisions about data, so they
 * take data and return decisions, and the script does nothing else.
 *
 * Every rule here is answerable from two independent sources — the record the
 * build wrote and the image the runtime holds, or the manifest and the image —
 * because a gate that compares a claim with itself proves only that the claim was
 * typed consistently. The one exception is deliberate: a digest declared in a
 * manifest is compared against the runtime's own `RepoDigests` rather than
 * trusted, which is the check that becomes available when an image is published.
 */
/** @import { BuildRecord, BuildRecordEntry, ImageFacts, RunnerManifest } from './oci-images.mjs' */

import { isContentDigest, imageRefOf } from './oci-images.mjs';

/**
 * @typedef {object} RunnerObservation
 * @property {string} name
 * @property {RunnerManifest | null} manifest
 * @property {string | null} manifestProblem
 * @property {ImageFacts | null} inspected
 */

/**
 * @typedef {object} RunnerVerdict
 * @property {string[]} failures
 * @property {string[]} notes
 */

/**
 * The uid an image will run as.
 *
 * `Config.User` is a string in Docker's `user[:group]` form and the manifest
 * declares a number, so comparing them directly fails every real build: the image
 * says `"65532:65532"` and the manifest says `65532`. An unset `Config.User` means
 * root, which is Docker's own default and the case the non-root rule exists to
 * catch.
 *
 * @param {string} user
 * @returns {number | null} `null` when it is not numeric — a named user, which
 *   cannot be checked against a declared uid but is not root either.
 */
export function uidOf(user) {
  const first = user.split(':')[0] ?? '';
  if (!/^\d+$/.test(first)) return null;
  return Number(first);
}

/**
 * Whether an image would run as root.
 *
 * Three spellings, and each has been a real way for it to happen: an unset
 * `Config.User` is Docker's own default of root, uid `0` is root numerically, and
 * the literal name `root` is root by name. A named user that is not `root` is
 * non-root, but its uid is not knowable here, so it is exempt from the declared-uid
 * cross-check rather than being failed for being unnamed.
 *
 * @param {string} user
 * @returns {boolean}
 */
export function runsAsRoot(user) {
  return user === '' || user === 'root' || uidOf(user) === 0;
}

/**
 * @param {object} input
 * @param {string} input.name Runner name.
 * @param {RunnerManifest | null} input.manifest Parsed runner manifest.
 * @param {string | null} input.manifestProblem Why it is null, in words.
 * @param {BuildRecordEntry | undefined} input.recorded That runner's build-record entry.
 * @param {ImageFacts | null} input.inspected
 * @param {string} input.imageRef
 * @returns {RunnerVerdict}
 */
export function evaluateRunner({ name, manifest, manifestProblem, recorded, inspected, imageRef }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];

  if (manifest === null) {
    failures.push(`${name}: ${manifestProblem ?? 'manifest could not be read'}`);
    return { failures, notes };
  }

  // Nothing downstream can be trusted if no build in this run recorded the image.
  if (recorded === undefined || recorded === null || typeof recorded !== 'object') {
    failures.push(`${name}: the build record has no entry, so nothing proves it was built`);
    return { failures, notes };
  }

  if (inspected === null) {
    failures.push(`${name}: ${imageRef} is not present, or cannot be inspected`);
    return { failures, notes };
  }

  if (!isContentDigest(inspected.id)) {
    failures.push(`${name}: ${imageRef} has no inspectable content id`);
    return { failures, notes };
  }

  // The image the verifier found must be the one the build made. This is what
  // catches an image rebuilt, replaced or pulled between the two steps, which is
  // the only failure a build record can detect on a host with no registry.
  if (inspected.id !== recorded.imageId) {
    failures.push(
      `${name}: ${imageRef} is ${inspected.id}, but the build record says ` +
        `${String(recorded.imageId)} — the image changed after it was built, or a ` +
        'different one was built',
    );
    return { failures, notes };
  }

  const imageUid = uidOf(inspected.user);
  if (runsAsRoot(inspected.user)) {
    failures.push(
      `${name}: ${imageRef} runs as ${JSON.stringify(inspected.user)}, expected a non-root user`,
    );
  }

  if (manifest.schemaVersion !== 1) {
    failures.push(`${name}: unsupported schemaVersion ${String(manifest.schemaVersion)}`);
  }
  if (manifest.user !== 65532) {
    failures.push(`${name}: declared user is ${String(manifest.user)}, expected 65532`);
  }
  if (manifest.network !== 'none') {
    failures.push(
      `${name}: declared network is ${JSON.stringify(manifest.network)}, expected "none"`,
    );
  }
  if (manifest.readOnly !== true) {
    failures.push(`${name}: declared readOnly is ${String(manifest.readOnly)}, expected true`);
  }
  if (imageUid !== null && typeof manifest.user === 'number' && imageUid !== manifest.user) {
    failures.push(
      `${name}: manifest declares user ${manifest.user} but the image runs as uid ${imageUid}`,
    );
  }

  const declaredDigest = typeof manifest.imageDigest === 'string' ? manifest.imageDigest : null;
  if (declaredDigest === null) {
    notes.push(
      `${name}: no registry digest compared — built locally and never pushed, so there are no ` +
        'RepoDigests to check. Publishing the image is what would arm that check.',
    );
  } else if (!isContentDigest(declaredDigest)) {
    failures.push(`${name}: imageDigest is not a content digest`);
  } else if (inspected.repoDigests.length === 0) {
    failures.push(
      `${name}: manifest declares a registry digest but ${imageRef} has no RepoDigests, ` +
        'so the recorded digest cannot be checked against anything',
    );
  } else if (!inspected.repoDigests.includes(declaredDigest)) {
    failures.push(
      `${name}: recorded digest ${declaredDigest} is not one of the image's ` +
        `(${inspected.repoDigests.join(', ')})`,
    );
  }

  return { failures, notes };
}

/**
 * Apply {@link evaluateRunner} to every runner.
 *
 * The build record is checked once, before the loop: a record that is absent or
 * from a different shape fails every runner for the same reason, and saying so
 * once is clearer than three copies of the same sentence.
 *
 * @param {object} input
 * @param {BuildRecord | null} input.record
 * @param {RunnerObservation[]} input.observed
 * @returns {{ failures: string[], notes: string[], imageRefs: Record<string, string> }}
 */
export function evaluateOciVerification({ record, observed }) {
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {Record<string, string>} */
  const imageRefs = {};

  if (record === null) {
    failures.push(
      'no build record: run `pnpm oci:build` first. The record is what proves an image was ' +
        'built in this run, rather than claimed by a committed file.',
    );
  }

  for (const entry of observed) {
    const imageRef = imageRefOf(entry.name);
    imageRefs[entry.name] = imageRef;
    const result = evaluateRunner({
      name: entry.name,
      manifest: entry.manifest,
      manifestProblem: entry.manifestProblem,
      recorded: record === null ? undefined : record.images[entry.name],
      inspected: entry.inspected,
      imageRef,
    });
    failures.push(...result.failures);
    notes.push(...result.notes);
  }

  return { failures, notes, imageRefs };
}
