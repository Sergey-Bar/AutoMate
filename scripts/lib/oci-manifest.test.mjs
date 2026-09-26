import assert from 'node:assert/strict';
import test from 'node:test';
import { applyBuildResult, buildWritebackFinding, digestMatches } from './oci-manifest.mjs';

const manifest = {
  schemaVersion: 1,
  name: 'k6',
  toolVersion: '0.57.0',
  imageDigest: null,
  buildStatus: 'unbuilt',
  user: 65532,
  network: 'none',
  readOnly: true,
  capabilities: ['CAP_DROP'],
  resources: { cpu: 2, memoryMb: 1024, pids: 128, outputBytes: 52428800, timeoutMs: 300000 },
};

const digest = `sha256:${'a'.repeat(64)}`;
const built = { imageRef: 'automate/k6:local', imageDigest: digest };

test('a build writes the three fields verification needs, and keeps the rest', () => {
  const next = applyBuildResult(manifest, built);
  assert.equal(next.imageRef, 'automate/k6:local');
  assert.equal(next.imageDigest, digest);
  assert.equal(next.buildStatus, 'built');
  // The declared isolation must survive, or verify would reject the image it just built.
  assert.equal(next.user, 65532);
  assert.equal(next.network, 'none');
  assert.equal(next.readOnly, true);
  assert.deepEqual(next.resources, manifest.resources);
  assert.equal(next.toolVersion, '0.57.0');
});

test('the writeback does not launder fields it does not understand', () => {
  const next = applyBuildResult({ ...manifest, rogue: 'value', imageDigest: null }, built);
  assert.equal(next['rogue'], undefined);
});

test('a build with no reported digest is a finding, not a quiet success', () => {
  // The exact gap this closes: a successful build that leaves the manifest saying
  // "unbuilt" is indistinguishable from no build at all.
  const finding = buildWritebackFinding(manifest, null);
  assert.ok(finding !== null);
  assert.match(finding, /reported no digest/);
  assert.match(finding, /worse than a failed build/);
});

test('a non-sha256 digest is refused, because verify would reject it', () => {
  for (const bad of ['', 'sha256:short', 'notadigest', `md5:${'a'.repeat(32)}`, 'a'.repeat(64)]) {
    const finding = buildWritebackFinding(manifest, {
      imageRef: 'automate/k6:local',
      imageDigest: bad,
    });
    assert.ok(finding !== null, `expected ${JSON.stringify(bad)} to be refused`);
  }
});

test('an empty image reference is refused', () => {
  const finding = buildWritebackFinding(manifest, { imageRef: '  ', imageDigest: digest });
  assert.ok(finding !== null);
  assert.match(finding, /no image reference/);
});

test('a manifest that is not an object is refused', () => {
  for (const bad of [null, 'x', 42, []]) {
    assert.ok(buildWritebackFinding(bad, built) !== null);
  }
});

test('a sound build passes the writeback check', () => {
  assert.equal(buildWritebackFinding(manifest, built), null);
});

test('a recorded digest matches the image ID, because a local build has no registry digest', () => {
  // Docker and Podman only assign RepoDigests on push. Requiring one would make a
  // local build unverifiable, which is the state the manifests are actually in.
  assert.equal(digestMatches(digest, { imageId: digest, repoDigest: null }), true);
  assert.equal(digestMatches(digest, { imageId: null, repoDigest: digest }), true);
  assert.equal(
    digestMatches(digest, { imageId: `sha256:${'b'.repeat(64)}`, repoDigest: null }),
    false,
  );
  assert.equal(digestMatches(digest, { imageId: null, repoDigest: null }), false);
});

test('a recorded value that is not a digest never matches, whatever the image reports', () => {
  for (const recorded of ['', 'null', 'unbuilt', `sha256:${'A'.repeat(64)}`, 'a'.repeat(64)]) {
    assert.equal(digestMatches(recorded, { imageId: recorded, repoDigest: recorded }), false);
  }
});
