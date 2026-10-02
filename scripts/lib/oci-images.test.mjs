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

test('a build record round-trips, and a record of another shape is refused', () => {
  // Its own temporary directory, never the real `var/oci-build.json`: ledger row
  // `D-4` holds a measured claim that every suite here is read-only over the
  // repository, and this one writing the shared path would falsify it silently.
  const at = join(mkdtempSync(join(tmpdir(), 'oci-record-')), 'oci-build.json');
  try {
    writeBuildRecord(
      {
        schemaVersion: BUILD_RECORD_SCHEMA,
        runtime: 'docker',
        images: { k6: { imageId: DIGEST_A } },
      },
      at,
    );
    assert.equal(readBuildRecord(at)?.images.k6.imageId, DIGEST_A);

    writeBuildRecord({ schemaVersion: BUILD_RECORD_SCHEMA + 1, images: {} }, at);
    assert.equal(readBuildRecord(at), null, 'a record from another schema is not read as one');

    writeBuildRecord({ schemaVersion: BUILD_RECORD_SCHEMA }, at);
    assert.equal(readBuildRecord(at), null, 'a record with no images table is refused');

    writeBuildRecord({ schemaVersion: BUILD_RECORD_SCHEMA, images: null }, at);
    assert.equal(readBuildRecord(at), null);
  } finally {
    rmSync(dirname(at), { force: true, recursive: true });
  }
});

test('a record that is not JSON is refused rather than crashing the gate', () => {
  const at = join(mkdtempSync(join(tmpdir(), 'oci-record-')), 'oci-build.json');
  try {
    writeFileSync(at, 'not json at all', 'utf8');
    assert.equal(readBuildRecord(at), null);
  } finally {
    rmSync(dirname(at), { force: true, recursive: true });
  }
});

test('a record that was never written is absent rather than empty', () => {
  const at = join(mkdtempSync(join(tmpdir(), 'oci-record-')), 'never-written.json');
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
