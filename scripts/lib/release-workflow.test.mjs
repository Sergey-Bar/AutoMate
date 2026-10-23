import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { PUBLISHED_IMAGES } from './release-compose.mjs';

/**
 * `.github/workflows/release.yml`, read as text and held to what a release must be.
 *
 * `gate-tooling.test.mjs` already audits every workflow for timeouts, a concurrency
 * block and tool installs. This holds the release workflow to the rest: least privilege
 * per job, every third-party action pinned by commit, both architectures built for exactly
 * the images the release compose file names, and an acceptance job that installs from
 * the release page with nothing but the download.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TEXT = readFileSync(path.join(REPO_ROOT, '.github/workflows/release.yml'), 'utf8').replace(
  /\r\n/g,
  '\n',
);

/** Each job's text, keyed by id. */
function jobs() {
  const body = TEXT.slice(TEXT.indexOf('\njobs:\n') + '\njobs:\n'.length);
  /** @type {Map<string, string>} */
  const found = new Map();
  const parts = body.split(/^ {2}(?=[a-z][a-z0-9-]*:\n)/m).filter(Boolean);
  for (const part of parts) {
    const id = part.slice(0, part.indexOf(':'));
    found.set(id, part);
  }
  return found;
}

/** @param {string} job @returns {string[]} */
function permissionsOf(job) {
  const lines = job.split('\n');
  const start = lines.indexOf('    permissions:');
  if (start === -1) return [];
  /** @type {string[]} */
  const found = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith('      ') || line.startsWith('       ')) break;
    found.push(line.trim());
  }
  return found;
}

test('it runs on v* tags only, and reads by default', () => {
  assert.match(TEXT, /^on:\n {2}push:\n {4}tags:\n {6}- 'v\*'\n/m);
  assert.doesNotMatch(TEXT, /^ {2}(pull_request|workflow_dispatch|schedule):/m);
  assert.match(TEXT, /^permissions:\n {2}contents: read\n/m);
});

test('the jobs exist, in the order a release needs them', () => {
  assert.deepEqual(
    [...jobs().keys()],
    ['prepare', 'verify', 'images', 'manifests', 'visibility', 'release', 'acceptance', 'upgrade'],
  );
});

test('only the jobs that write get write permissions', () => {
  const all = jobs();
  assert.deepEqual(permissionsOf(all.get('images') ?? ''), ['contents: read', 'packages: write']);
  assert.deepEqual(permissionsOf(all.get('manifests') ?? ''), [
    'contents: read',
    'packages: write',
    'attestations: write',
    'id-token: write',
  ]);
  assert.deepEqual(permissionsOf(all.get('release') ?? ''), ['contents: write']);
  for (const id of ['prepare', 'verify', 'visibility', 'acceptance', 'upgrade']) {
    assert.deepEqual(permissionsOf(all.get(id) ?? ''), [], `${id} must inherit read-only`);
  }
});

test('every third-party action is pinned to a commit', () => {
  const uses = [...TEXT.matchAll(/uses: (\S+)/g)].map((match) => match[1] ?? '');
  assert.ok(uses.length > 10);
  for (const ref of uses) {
    if (ref.startsWith('./')) continue;
    assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, ref);
  }
});

test('both architectures are built natively for exactly the published images', () => {
  const all = jobs();
  for (const id of ['images', 'manifests']) {
    const job = all.get(id) ?? '';
    const listed = [...job.matchAll(/^ {10}- ([a-z]+)$/gm)].map((match) => match[1] ?? '');
    assert.deepEqual(listed, PUBLISHED_IMAGES, `${id} matrix`);
  }
  const images = all.get('images') ?? '';
  assert.match(images, /arch: amd64\n {12}runner: ubuntu-24\.04\n/);
  assert.match(images, /arch: arm64\n {12}runner: ubuntu-24\.04-arm\n/);
  assert.doesNotMatch(TEXT, /setup-qemu-action/);
  assert.match(images, /push-by-digest=true/);
  assert.match(images, /sbom: true/);
});

test('latest is decided by the tag, not by the workflow', () => {
  // The tags come from `imageTags` (scripts/lib/release-notes.mjs), which leaves `latest`
  // off a prerelease; the merge job only applies what it is given.
  assert.match(TEXT, /imageTags\(tag\)/);
  assert.match(jobs().get('manifests') ?? '', /TAGS: \$\{\{ needs\.prepare\.outputs\.tags \}\}/);
  assert.doesNotMatch(jobs().get('manifests') ?? '', /:latest/);
});

test('a private image stops the release before it is published', () => {
  const all = jobs();
  assert.match(all.get('visibility') ?? '', /release-visibility\.mjs/);
  assert.match(all.get('release') ?? '', /needs: \[prepare, visibility\]/);
});

test('acceptance installs from the release page with only the download', () => {
  const job = jobs().get('acceptance') ?? '';
  assert.doesNotMatch(job, /actions\/checkout/, 'acceptance must not see the source tree');
  assert.match(job, /gh release download/);
  assert.match(job, /sha256sum -c SHA256SUMS/);
  assert.match(job, /run: \.\/start\.sh\n/);
  assert.match(job, /api\/v1\/auth\/login/);
  assert.match(job, /if: always\(\)\n[\s\S]*?run: \.\/start\.sh uninstall --purge/);
  assert.match(job, /GAP Windows/);
});

test('an existing install is upgraded with `start update`, keeping its key', () => {
  const job = jobs().get('upgrade') ?? '';
  assert.doesNotMatch(job, /actions\/checkout/, 'upgrade must not see the source tree');
  assert.match(job, /needs: \[prepare, release\]/);
  assert.match(job, /--exclude-pre-releases/);
  assert.match(job, /sha256sum -c SHA256SUMS/);
  assert.match(job, /\.\/start\.sh update --version "\$NEW_VERSION"/);
  assert.match(job, /api\/v1\/auth\/login/);
  assert.match(
    job,
    /if: always\(\) && steps\.previous\.outputs\.version != ''\n[\s\S]*?uninstall --purge/,
  );
});
