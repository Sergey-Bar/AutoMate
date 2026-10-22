import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { anonymousPull, packageSettingsUrl, visibilityProblems } from './registry-visibility.mjs';
import { imageTags, parseTag, releaseNotes } from './release-notes.mjs';

const CHANGELOG = [
  '# Changelog',
  '',
  '## 2.5.0 — 2026-10-23 — plug and play',
  '',
  '### Added',
  '',
  '- One download.',
  '',
  '## 2.4.0 — 2026-10-22 — closed',
  '',
  '- Older.',
  '',
].join('\n');

test('the notes are exactly the version section, without its heading', () => {
  assert.equal(releaseNotes(CHANGELOG, '2.5.0'), '### Added\n\n- One download.\n');
  assert.equal(releaseNotes(CHANGELOG, '2.4.0'), '- Older.\n');
});

test('a version with no section fails rather than publishing an empty body', () => {
  assert.throws(() => releaseNotes(CHANGELOG, '2.6.0'), /no "## 2\.6\.0" section/);
  // A prefix is not a match: 2.5 must not take 2.5.0's section.
  assert.throws(() => releaseNotes(CHANGELOG, '2.5'), /no "## 2\.5" section/);
});

test('the repository changelog has a section for the version in package.json', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  /** @type {{ version: string }} */
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const notes = releaseNotes(
    readFileSync(path.join(root, 'docs/CHANGELOG.md'), 'utf8'),
    manifest.version,
  );
  assert.ok(notes.trim().length > 0);
});

test('a final release is tagged version, X.Y and latest; a candidate only its version', () => {
  assert.deepEqual(imageTags('v2.5.0'), ['2.5.0', '2.5', 'latest']);
  assert.deepEqual(imageTags('v2.5.0-rc.1'), ['2.5.0-rc.1']);
  assert.equal(parseTag('v2.5.0-rc.1').prerelease, true);
  assert.throws(() => parseTag('2.5.0'), /not a release tag/);
  assert.throws(() => parseTag('v2.5'), /not a release tag/);
});

/**
 * A fake registry: a token for every repository, and a manifest status per image.
 *
 * @param {Record<string, number>} statuses
 * @returns {typeof fetch}
 */
function fakeRegistry(statuses) {
  return /** @type {typeof fetch} */ (
    async (input) => {
      const url = String(input);
      if (url.startsWith('https://ghcr.io/token')) {
        return new globalThis.Response(JSON.stringify({ token: 'anonymous' }), { status: 200 });
      }
      const image = /\/v2\/[^/]+\/([^/]+)\/manifests\//.exec(url)?.[1] ?? '';
      return new globalThis.Response(null, { status: statuses[image] ?? 404 });
    }
  );
}

test('a private image is a finding that says how to make it public', async () => {
  const fetcher = fakeRegistry({ 'automate-api': 200, 'automate-web': 401 });
  const checks = [
    await anonymousPull('sergey-bar', 'automate-api', '2.5.0', fetcher),
    await anonymousPull('sergey-bar', 'automate-web', '2.5.0', fetcher),
  ];
  const problems = visibilityProblems('sergey-bar', checks);
  assert.equal(problems.length, 1);
  assert.match(problems[0] ?? '', /^automate-web: an anonymous pull answered 401/);
  assert.ok((problems[0] ?? '').includes(packageSettingsUrl('sergey-bar', 'automate-web')));
  assert.match(problems[0] ?? '', /Change visibility → Public/);
});

test('an unreachable registry is a finding, not a pass', async () => {
  const fetcher = /** @type {typeof fetch} */ (
    async () => {
      throw new Error('offline');
    }
  );
  const check = await anonymousPull('sergey-bar', 'automate-api', '2.5.0', fetcher);
  assert.equal(visibilityProblems('sergey-bar', [check]).length, 1);
});
