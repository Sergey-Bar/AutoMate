/**
 * The facts `oci:build` writes and `oci:verify` reads.
 *
 * Split from `oci-checks.test.mjs` to match the modules: these are the I/O and the
 * shapes, and those are the rules. The shipped-file assertions live here too —
 * that every runner manifest declares the isolation the rules require, and that
 * every Dockerfile ends on the uid its manifest declares — because they are facts
 * about the repository rather than rules about a record.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  BUILD_RECORD_SCHEMA,
  RUNNER_NAMES,
  imageRefOf,
  isContentDigest,
  readBuildRecord,
  readManifest,
  writeBuildRecord,
} from '../../scripts/oci-images.mjs';

const DIGEST_A = `sha256:${'a'.repeat(64)}`;

/**
 * A record path inside a fresh temporary directory.
 *
 * Never the real `var/oci-build.json`: ledger row `D-4` holds a measured claim
 * that every suite under `scripts/lib/` is read-only over the repository, and a
 * test writing the shared path would falsify it silently.
 *
 * @returns {string}
 */
function tempRecordPath() {
  return join(mkdtempSync(join(tmpdir(), 'oci-record-')), 'oci-build.json');
}

test('a locally built image is tagged where both scripts look for it', () => {
  assert.equal(imageRefOf('k6'), 'automate/k6:local');
  assert.equal(imageRefOf('playwright'), 'automate/playwright:local');
  assert.equal(imageRefOf('zap'), 'automate/zap:local');
});

test('the three runners are the ones this repository ships', () => {
  assert.deepEqual(RUNNER_NAMES, ['playwright', 'k6', 'zap']);
});

test('the digest shape is a full sha256 and nothing looser', () => {
  assert.equal(isContentDigest(DIGEST_A), true);
  assert.equal(isContentDigest('sha256:abc'), false);
  assert.equal(isContentDigest(`sha256:${'a'.repeat(63)}`), false);
  assert.equal(isContentDigest(`sha256:${'A'.repeat(64)}`), false);
  assert.equal(isContentDigest(`sha512:${'a'.repeat(64)}`), false);
  assert.equal(isContentDigest(null), false);
  assert.equal(isContentDigest(42), false);
  assert.equal(isContentDigest(undefined), false);
});

test('a build record round-trips', () => {
  const at = tempRecordPath();
  try {
    writeBuildRecord(
      {
        schemaVersion: BUILD_RECORD_SCHEMA,
        runtime: 'docker',
        images: {
          k6: { imageRef: 'automate/k6:local', imageId: DIGEST_A, user: '65532', repoDigests: [] },
        },
      },
      at,
    );
    assert.equal(readBuildRecord(at)?.images.k6.imageId, DIGEST_A);
  } finally {
    rmSync(dirname(at), { force: true, recursive: true });
  }
});

test('a record of another shape is refused, and the bytes on disk are what proves it', () => {
  const at = tempRecordPath();
  try {
    // Raw JSON rather than `writeBuildRecord`, because the point is what the
    // *reader* does with a shape the writer would never produce — and the type
    // system is right that none of these is a build record.
    for (const body of [
      '',
      'not json at all',
      '[]',
      '"a string"',
      'null',
      JSON.stringify({ schemaVersion: BUILD_RECORD_SCHEMA + 1, images: {} }),
      JSON.stringify({ schemaVersion: BUILD_RECORD_SCHEMA }),
      JSON.stringify({ schemaVersion: BUILD_RECORD_SCHEMA, images: null }),
      JSON.stringify({ schemaVersion: BUILD_RECORD_SCHEMA, images: 'not a table' }),
    ]) {
      writeFileSync(at, body, 'utf8');
      assert.equal(readBuildRecord(at), null, `expected ${JSON.stringify(body)} to be refused`);
    }
  } finally {
    rmSync(dirname(at), { force: true, recursive: true });
  }
});

test('a record that was never written is absent rather than empty', () => {
  const at = tempRecordPath();
  try {
    assert.equal(readBuildRecord(at), null);
  } finally {
    rmSync(dirname(at), { force: true, recursive: true });
  }
});

test('every shipped runner manifest declares the isolation the rules require', () => {
  for (const name of RUNNER_NAMES) {
    const { manifest, problem } = readManifest(name);
    assert.equal(problem, null, `${name}: ${problem}`);
    if (manifest === null) {
      assert.fail(`${name}: no manifest, and problem was ${String(problem)}`);
    }
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(manifest.user, 65532);
    assert.equal(manifest.network, 'none');
    assert.equal(manifest.readOnly, true);
    assert.deepEqual(manifest.capabilities, ['CAP_DROP']);
  }
});

test('every shipped Dockerfile ends on the uid its manifest declares, and never on root', () => {
  // The rules compare this at runtime against the built image. Asserting it here
  // too means a Dockerfile that dropped its `USER` fails without docker, and a
  // manifest that moved the declared uid fails beside it.
  for (const name of RUNNER_NAMES) {
    const { manifest } = readManifest(name);
    if (manifest === null) {
      assert.fail(`${name}: no manifest`);
    }
    const dockerfile = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'runners', name, 'Dockerfile'),
      { encoding: 'utf8' },
    );
    const users = [...dockerfile.matchAll(/^USER\s+(\S+)\s*$/gim)].map((entry) => entry[1]);
    assert.ok(users.length > 0, `${name}: no USER instruction`);
    const last = users[users.length - 1];
    assert.notEqual(last, 'root', `${name} ends on USER root`);
    assert.match(
      last,
      new RegExp(`^${manifest.user}(:.*)?$`),
      `${name} does not end on its declared uid`,
    );
  }
});
