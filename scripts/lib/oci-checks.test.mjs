/**
 * The rules `oci:verify` enforces.
 *
 * These two scripts had no test at all, which is why a gate that could never pass
 * sat in `verify:release` without anyone noticing.
 * `evaluateOciVerification` is a pure function of the build record and what the
 * runtime reports, so every rule is exercised here without docker.
 *
 * The cases that matter are the ones that must **fail**: a record that does not
 * match the image, an image that runs as root, a manifest and an image that
 * disagree about the user, and a declared digest that names something the image is
 * not. A suite that only proved the happy path would have passed with the old rules
 * in place just as happily — and did, twice, while this replacement was being
 * written: the uid cross-check compared a number against Docker's `"65532:65532"`
 * string and would have failed every real build, and the root check passed
 * `Config.User: "root"`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  evaluateOciVerification,
  evaluateRunner,
  runsAsRoot,
  uidOf,
} from '../../scripts/oci-checks.mjs';
import { BUILD_RECORD_SCHEMA, RUNNER_NAMES, imageRefOf } from '../../scripts/oci-images.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;
const DIGEST_B = `sha256:${'b'.repeat(64)}`;

/** A manifest matching what the repository actually ships. */
const GOOD_MANIFEST = {
  schemaVersion: 1,
  name: 'playwright',
  imageRef: 'automate/playwright:local',
  imageDigest: null,
  buildStatus: 'unbuilt',
  user: 65532,
  network: 'none',
  readOnly: true,
  capabilities: ['CAP_DROP'],
};

const INSPECTED = { id: DIGEST_A, user: '65532:65532', repoDigests: [] };

function goodInput(overrides = {}) {
  return {
    name: 'playwright',
    manifest: { ...GOOD_MANIFEST },
    manifestProblem: null,
    recorded: { imageRef: imageRefOf('playwright'), imageId: DIGEST_A, user: '65532:65532' },
    inspected: { ...INSPECTED },
    imageRef: imageRefOf('playwright'),
    ...overrides,
  };
}

test('a built image with complete declared isolation produces no failures', () => {
  const { failures } = evaluateRunner(goodInput());
  assert.deepEqual(failures, []);
});

test('a locally built image reports the registry digest as unavailable rather than failing', () => {
  const { failures, notes } = evaluateRunner(goodInput());
  assert.deepEqual(failures, []);
  assert.equal(notes.length, 1);
  assert.match(notes[0], /no registry digest compared/);
});

test('an image that changed after the build fails, which is what the record is for', () => {
  const { failures } = evaluateRunner(goodInput({ inspected: { ...INSPECTED, id: DIGEST_B } }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /changed after it was built/);
});

test('an image that is absent fails rather than being skipped', () => {
  const { failures } = evaluateRunner(goodInput({ inspected: null }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /not present/);
});

test('an image with no inspectable content id fails', () => {
  const { failures } = evaluateRunner(goodInput({ inspected: { ...INSPECTED, id: '' } }));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /no inspectable content id/);
});

test('a missing build record fails, because nothing else proves the image was built', () => {
  for (const recorded of [undefined, null, 'a string']) {
    const { failures } = evaluateRunner(goodInput({ recorded }));
    assert.equal(failures.length, 1, `recorded=${String(recorded)}`);
    assert.match(failures[0], /nothing proves it was built/);
  }
});

test('the uid is parsed out of user[:group], which is the form Docker stores', () => {
  assert.equal(uidOf('65532'), 65532);
  assert.equal(uidOf('65532:65532'), 65532);
  assert.equal(uidOf('65532:65532:65532'), 65532);
  assert.equal(uidOf('0'), 0);
  assert.equal(uidOf('0:0'), 0);
  assert.equal(uidOf(''), null);
  assert.equal(uidOf('root'), null);
  assert.equal(uidOf('runner'), null);
  assert.equal(uidOf('-1'), null);
});

test('every spelling of root fails, and a non-root named user does not', () => {
  for (const user of ['', 'root', '0', '0:0']) {
    const { failures } = evaluateRunner(goodInput({ inspected: { ...INSPECTED, user } }));
    assert.ok(
      failures.some((failure) => /expected a non-root user/.test(failure)),
      `expected ${JSON.stringify(user)} to fail as root, got ${JSON.stringify(failures)}`,
    );
    assert.equal(runsAsRoot(user), true, `expected ${JSON.stringify(user)} to be root`);
  }
  for (const user of ['runner', 'node', '65532', '65532:65532']) {
    assert.equal(runsAsRoot(user), false, `expected ${JSON.stringify(user)} not to be root`);
  }
});

test('a named non-root user is exempt from the declared-uid cross-check, not failed', () => {
  const { failures } = evaluateRunner(goodInput({ inspected: { ...INSPECTED, user: 'runner' } }));
  assert.deepEqual(failures, []);
});

test('an image that runs as a different non-root uid than the manifest declares fails', () => {
  const { failures } = evaluateRunner(
    goodInput({ inspected: { ...INSPECTED, user: '1000:1000' } }),
  );
  assert.ok(
    failures.some((failure) =>
      /manifest declares user 65532 but the image runs as uid 1000/.test(failure),
    ),
    `expected the cross-check to fail, got ${JSON.stringify(failures)}`,
  );
});

test('a manifest and an image that disagree about the user fail on the disagreement', () => {
  const { failures } = evaluateRunner(goodInput({ manifest: { ...GOOD_MANIFEST, user: 1000 } }));
  assert.ok(
    failures.some((failure) =>
      /manifest declares user 1000 but the image runs as uid 65532/.test(failure),
    ),
    `expected the cross-check to fail, got ${JSON.stringify(failures)}`,
  );
});

test('incomplete declared isolation fails on each missing property', () => {
  for (const [manifest, expected] of [
    [{ network: 'bridge' }, /declared network is "bridge"/],
    [{ readOnly: false }, /declared readOnly is false/],
    [{ user: 0 }, /declared user is 0/],
    [{ schemaVersion: 2 }, /unsupported schemaVersion 2/],
  ]) {
    const { failures } = evaluateRunner(goodInput({ manifest: { ...GOOD_MANIFEST, ...manifest } }));
    assert.ok(
      failures.some((failure) => expected.test(failure)),
      `expected ${expected} for ${JSON.stringify(manifest)}, got ${JSON.stringify(failures)}`,
    );
  }
});

test('a declared digest the image does not have fails, so the check stays armed', () => {
  const { failures } = evaluateRunner(
    goodInput({
      manifest: { ...GOOD_MANIFEST, imageDigest: DIGEST_A },
      inspected: { ...INSPECTED, repoDigests: [] },
    }),
  );
  assert.ok(
    failures.some((failure) =>
      /declares a registry digest but .* has no RepoDigests/.test(failure),
    ),
    `expected a RepoDigests failure, got ${JSON.stringify(failures)}`,
  );
});

test('a declared digest that is not among the image digests fails', () => {
  const { failures } = evaluateRunner(
    goodInput({
      manifest: { ...GOOD_MANIFEST, imageDigest: DIGEST_A },
      inspected: { ...INSPECTED, repoDigests: [DIGEST_B] },
    }),
  );
  assert.ok(
    failures.some((failure) => /is not one of the image's/.test(failure)),
    `expected a digest mismatch, got ${JSON.stringify(failures)}`,
  );
});

test('a declared digest the image does have passes, so graduation is achievable', () => {
  const { failures, notes } = evaluateRunner(
    goodInput({
      manifest: { ...GOOD_MANIFEST, imageDigest: DIGEST_B },
      inspected: { ...INSPECTED, repoDigests: [DIGEST_A, DIGEST_B] },
    }),
  );
  assert.deepEqual(failures, []);
  assert.deepEqual(notes, []);
});

test('a declared digest that is not a digest is rejected rather than compared', () => {
  const { failures } = evaluateRunner(
    goodInput({ manifest: { ...GOOD_MANIFEST, imageDigest: 'latest' } }),
  );
  assert.ok(
    failures.some((failure) => /imageDigest is not a content digest/.test(failure)),
    `expected a shape failure, got ${JSON.stringify(failures)}`,
  );
});

test('an unreadable manifest fails with the reason rather than a crash', () => {
  const { failures } = evaluateRunner(
    goodInput({ manifest: null, manifestProblem: 'manifest is not valid JSON' }),
  );
  assert.deepEqual(failures, ['playwright: manifest is not valid JSON']);
});

test('a missing build record is reported once, not once per runner', () => {
  const { failures } = evaluateOciVerification({
    record: null,
    observed: RUNNER_NAMES.map((name) => ({
      name,
      manifest: { ...GOOD_MANIFEST, name },
      manifestProblem: null,
      inspected: { ...INSPECTED },
    })),
  });
  assert.equal(failures.filter((failure) => failure.startsWith('no build record')).length, 1);
  assert.equal(
    failures.filter((failure) => failure.includes('nothing proves it was built')).length,
    RUNNER_NAMES.length,
  );
});

test('one bad runner fails the gate and the others are still evaluated', () => {
  const { failures } = evaluateOciVerification({
    record: {
      schemaVersion: BUILD_RECORD_SCHEMA,
      runtime: 'docker',
      images: {
        playwright: { imageId: DIGEST_A },
        k6: { imageId: DIGEST_B },
        zap: { imageId: DIGEST_A },
      },
    },
    observed: RUNNER_NAMES.map((name) => ({
      name,
      manifest: { ...GOOD_MANIFEST, name },
      manifestProblem: null,
      inspected: { ...INSPECTED, id: DIGEST_A },
    })),
  });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^k6: /);
});
