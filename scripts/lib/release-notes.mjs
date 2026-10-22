/**
 * Release notes are the version's own section of `docs/CHANGELOG.md`, nothing else.
 *
 * The release workflow publishes what the changelog says, so the notes cannot drift from
 * the record a reader of the repository sees. A tag whose version has no section fails
 * the release rather than publishing an empty or invented body.
 */

/** @param {string} value @returns {string} */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The body of the `## <version> …` section, without its heading.
 *
 * @param {string} changelog
 * @param {string} version for example `2.5.0`
 * @returns {string}
 * @throws when the changelog has no section for the version
 */
export function releaseNotes(changelog, version) {
  const lines = changelog.replace(/\r\n/g, '\n').split('\n');
  const heading = new RegExp(`^## ${escapeRegExp(version)}(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) {
    throw new Error(
      `docs/CHANGELOG.md has no "## ${version}" section. Write the release's entry before tagging it.`,
    );
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  return `${(end === -1 ? rest : rest.slice(0, end)).join('\n').trim()}\n`;
}

/**
 * The version a tag names, and whether it is a prerelease.
 *
 * @param {string} tag for example `v2.5.0` or `v2.5.0-rc.1`
 * @returns {{ version: string, prerelease: boolean, minor: string }}
 * @throws when the tag is not `v<semver>`
 */
export function parseTag(tag) {
  const refused = new Error(`\`${tag}\` is not a release tag; expected v<major>.<minor>.<patch>`);
  if (!tag.startsWith('v')) throw refused;
  const dash = tag.indexOf('-');
  const core = dash === -1 ? tag.slice(1) : tag.slice(1, dash);
  const suffix = dash === -1 ? '' : tag.slice(dash + 1);
  const parts = core.split('.');
  if (parts.length !== 3 || !parts.every((part) => /^\d+$/.test(part))) throw refused;
  if (dash !== -1 && !/^[0-9A-Za-z.-]+$/.test(suffix)) throw refused;
  return {
    version: tag.slice(1),
    prerelease: dash !== -1,
    minor: `${parts[0] ?? ''}.${parts[1] ?? ''}`,
  };
}

/**
 * The image tags one release publishes: the version always; `X.Y` and `latest` only for
 * a final release, so a release candidate never becomes what `latest` pulls.
 *
 * @param {string} tag
 * @returns {string[]}
 */
export function imageTags(tag) {
  const { version, prerelease, minor } = parseTag(tag);
  return prerelease ? [version] : [version, minor, 'latest'];
}
