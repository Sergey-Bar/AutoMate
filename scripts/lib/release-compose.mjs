/**
 * The release compose file, derived from the one the repository runs.
 *
 * `infra/compose/docker-compose.unified.yml` is the only compose authority. A release
 * needs the same stack with every `build:` replaced by the published image, so a user
 * pulls rather than builds. Writing that second file by hand would be a second authority
 * that drifts; deriving it means a service, variable or healthcheck added to the source
 * reaches the release with no further edit — and a *built* service the release does not
 * publish is refused rather than copied with a build context the bundle cannot satisfy.
 */

/** Where the release images live. Lower-case: GHCR refuses an upper-case namespace. */
export const REGISTRY = 'ghcr.io/sergey-bar';

/**
 * The services the release workflow builds and publishes, one image each, named
 * `automate-<service>`. The workflow's matrix is checked against this list.
 */
export const PUBLISHED_IMAGES = ['migrate', 'api', 'worker', 'runner', 'web', 'edge'];

/**
 * The image a service runs in a release.
 *
 * The version is a default rather than a fixed tag so `start update` can move an install
 * to a newer release by setting `AUTOMATE_VERSION` in its `.env`, with no edit to the file.
 *
 * @param {string} service
 * @param {string} version
 * @returns {string}
 */
export function imageReference(service, version) {
  return `${REGISTRY}/automate-${service}:\${AUTOMATE_VERSION:-${version}}`;
}

/** @param {string} line @returns {number} */
function indent(line) {
  return line.length - line.trimStart().length;
}

/**
 * The release variant of a compose file: every `build:` block becomes `image:`.
 *
 * @param {string} source the compose file
 * @param {string} version the release version, for example `2.5.0`
 * @returns {string}
 * @throws when a service is built but is not one of `PUBLISHED_IMAGES`
 */
export function releaseCompose(source, version) {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  /** @type {string[]} */
  const out = [];
  let service = '';
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const header = /^ {2}([A-Za-z0-9_.-]+):\s*$/.exec(line);
    if (header !== null) service = header[1] ?? '';
    if (!/^ {4}build:\s*$/.test(line)) {
      out.push(line);
      continue;
    }
    if (!PUBLISHED_IMAGES.includes(service)) {
      throw new Error(
        `service \`${service}\` is built but is not a published image. Add it to ` +
          '`PUBLISHED_IMAGES` in scripts/lib/release-compose.mjs (and so to the release ' +
          'workflow), or make it an image the release can pull.',
      );
    }
    out.push(`    image: ${imageReference(service, version)}`);
    // Drop the block's own lines: everything indented under `build:`.
    while ((lines[index + 1] ?? '').trim() !== '' && indent(lines[index + 1] ?? '') > 4) {
      index += 1;
    }
  }
  return out.join('\n');
}

/** Release settings a user may change, with the default the file already applies. */
const RELEASE_SETTINGS = [
  ['AUTOMATE_VERSION', 'The release this install runs. `start update` rewrites it.'],
  ['AUTOMATE_BIND', 'Default 127.0.0.1. 0.0.0.0 exposes an install with no login to your network.'],
  ['AUTOMATE_PORT', 'Default 8080. The one port the stack publishes.'],
];

/**
 * A `.env.example` for a release compose file.
 *
 * Every variable the file refuses to start without, then the release settings commented
 * out. The start scripts write a real `.env` with random values; this is for a person
 * who would rather fill one in by hand.
 *
 * @param {string} compose the release compose file
 * @returns {string}
 */
export function envExample(compose) {
  const required = [
    ...new Set([...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)].map((m) => m[1] ?? '')),
  ]
    .filter((name) => name !== '')
    .sort();
  const fixed = { OBJECT_STORE_BUCKET: 'automate-artifacts', OBJECT_STORE_REGION: 'us-east-1' };
  const body = required.map((name) =>
    name in fixed
      ? `${name}=${fixed[/** @type {keyof typeof fixed} */ (name)]}`
      : `${name}=replace-with-a-random-value-of-at-least-32-characters`,
  );
  const settings = RELEASE_SETTINGS.map(([name, note]) => `# ${note}\n# ${name}=`);
  return [
    '# Automate — environment for the release compose file.',
    '# `start.sh` / `start.ps1` create `.env` with random values on first run; use this',
    '# only to write one by hand. Every secret needs at least 32 characters.',
    '',
    ...body,
    '',
    ...settings,
    '',
  ].join('\n');
}
