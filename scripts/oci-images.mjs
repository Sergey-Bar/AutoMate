/**
 * The facts both `oci:build` and `oci:verify` need about a runner image.
 *
 * Two things here exist because the gate used to be unable to pass at all.
 *
 * **A build record, not a committed manifest field.** `oci:verify` used to require
 * `"buildStatus": "built"` and a `sha256:` digest in each runner's manifest,
 * and nothing in this repository ever wrote them — `oci:build` ran `docker build`
 * and discarded the result. So the committed JSON was carrying a claim no build
 * had ever made, and the only way to satisfy the gate was to type the claim in by
 * hand, which is the falsification the old verifier's own header describes having
 * removed. The build record at `var/oci-build.json` is written by the build, in
 * the run that built, and is not committed (`var/` is gitignored), so it cannot be
 * hand-edited into agreement.
 *
 * **The image's own configured user, read from the image.** A registry digest is
 * the strongest identity a container image can have, and it only exists for an
 * image that has been pushed somewhere. ADR-006's distribution model is a
 * self-hosted compose install built on the host that runs it, so these images are
 * never pushed and `RepoDigests` is empty. What *is* available for a locally built
 * image is its `Id` — the content hash of its configuration — and, more importantly
 * for the claim that actually matters, the user it will run as. Both are read here
 * so the verifier compares two independent sources rather than reading a
 * hand-authored JSON back, which is what the previous version did for `user`.
 *
 * Plain JavaScript with no dependencies, like every other script under `scripts/`.
 * `.mjs` files are not typechecked (see the plan's Q0.18.16).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The runner images, in build order. */
export const RUNNER_NAMES = ['playwright', 'k6', 'zap'];

/** Where a locally built runner image is tagged. */
export function imageRefOf(name) {
  return `automate/${name}:local`;
}

/**
 * The build record. Under `var/`, which `.gitignore` already covers, because a
 * record of what one host built is true of that host and not of the repository.
 */
export const BUILD_RECORD_PATH = path.join(root, 'var', 'oci-build.json');

/** Bumped when the record's shape changes, so an old record is not read as a new one. */
export const BUILD_RECORD_SCHEMA = 1;

/** A content hash the way both runtimes print one. */
const DIGEST = /^sha256:[a-f0-9]{64}$/;

/** @param {unknown} value */
export function isContentDigest(value) {
  return typeof value === 'string' && DIGEST.test(value);
}

/**
 * Read the image the runtime actually holds.
 *
 * Deliberately not `--format`: Docker and Podman accept different template
 * dialects, and a template that works on one silently yields an empty string on
 * the other — which is how a gate ends up comparing a recorded digest against
 * nothing. Full JSON has one spelling on both.
 *
 * @param {string} runtime
 * @param {string} imageRef
 * @returns {{ id: string, user: string, repoDigests: string[] } | null} `null` when absent.
 */
export function inspectImage(runtime, imageRef) {
  const result = spawnSync(runtime, ['image', 'inspect', imageRef], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  const image = Array.isArray(parsed) ? parsed[0] : undefined;
  if (image === undefined || typeof image !== 'object' || image === null) return null;
  const repoDigests = Array.isArray(image.RepoDigests)
    ? image.RepoDigests.filter((entry) => typeof entry === 'string')
    : [];
  return {
    id: typeof image.Id === 'string' ? image.Id : '',
    user: typeof image.Config?.User === 'string' ? image.Config.User : '',
    repoDigests,
  };
}

/**
 * Read the build record.
 *
 * The path is a parameter so a test can round-trip through its own temporary
 * directory. Ledger row `D-4` records a measured claim that every suite under
 * `scripts/lib/` is read-only over this repository, and writing the real
 * `var/oci-build.json` from a test would make that claim false without anything
 * announcing it.
 *
 * @param {string} [at]
 * @returns {object | null} the record, or `null` when absent, unreadable, or a different shape.
 */
export function readBuildRecord(at = BUILD_RECORD_PATH) {
  if (!existsSync(at)) return null;
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(at, 'utf8'));
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    parsed.schemaVersion !== BUILD_RECORD_SCHEMA ||
    typeof parsed.images !== 'object' ||
    parsed.images === null
  ) {
    return null;
  }
  return parsed;
}

/**
 * Write the record, creating its directory if it is absent.
 *
 * @param {object} record
 * @param {string} [at]
 * @returns {string} the path written, relative to the repository root.
 */
export function writeBuildRecord(record, at = BUILD_RECORD_PATH) {
  mkdirSync(path.dirname(at), { recursive: true });
  writeFileSync(at, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return path.relative(root, at);
}

/**
 * Parse a runner manifest, reporting rather than throwing.
 *
 * @param {string} name
 * @returns {{ manifest: object | null, problem: string | null }}
 */
export function readManifest(name) {
  const relative = path.join('runners', name, 'manifest.json');
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) {
    return { manifest: null, problem: `missing ${relative.split(path.sep).join('/')}` };
  }
  try {
    return { manifest: JSON.parse(readFileSync(absolute, 'utf8')), problem: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { manifest: null, problem: `manifest is not valid JSON (${detail})` };
  }
}
