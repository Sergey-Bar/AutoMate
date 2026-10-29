import assert from 'node:assert/strict';
import test from 'node:test';
import { smokeRunArgs, smokeVerdict, SMOKE_TIMEOUT_MS } from './oci-smoke.mjs';

/**
 * `oci:build` builds the runner images and `oci:verify` inspects them, and neither starts
 * one. The ZAP image exited 1 on every start as its own user for as long as it existed
 * (ledger MNT-157), and both gates were green. These are the rules `oci:smoke` applies.
 */

const manifest = {
  user: 65532,
  network: 'none',
  readOnly: true,
  resources: { cpu: 2, memoryMb: 1024, pids: 128, timeoutMs: 300000 },
};

test('the image is started with the isolation its manifest declares', () => {
  const args = smokeRunArgs('automate/zap:local', manifest);
  assert.equal(args[0], 'run');
  assert.ok(args.includes('--rm'));
  for (const [flag, value] of [
    ['--user', '65532:65532'],
    ['--network', 'none'],
    ['--cap-drop', 'ALL'],
    ['--security-opt', 'no-new-privileges'],
    ['--memory', '1024m'],
    ['--pids-limit', '128'],
    ['--cpus', '2'],
  ]) {
    assert.equal(args[args.indexOf(flag) + 1], value, flag);
  }
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--tmpfs'), 'a read-only root still gets a writable /tmp');
  assert.equal(args.at(-1), 'automate/zap:local', 'the image runs its own entrypoint');
});

test('a writable manifest is not started read-only, and an open network is not cut', () => {
  const args = smokeRunArgs('automate/k6:local', {
    ...manifest,
    readOnly: false,
    network: 'bridge',
  });
  assert.ok(!args.includes('--read-only'));
  assert.ok(!args.includes('--tmpfs'));
  assert.equal(args[args.indexOf('--network') + 1], 'bridge');
});

test('a manifest without a numeric user is refused rather than run as the image default', () => {
  assert.throws(() => smokeRunArgs('automate/k6:local', { ...manifest, user: undefined }), /user/);
  assert.throws(() => smokeRunArgs('automate/k6:local', { ...manifest, user: 0 }), /root/);
});

test('a clean exit with output passes', () => {
  assert.deepEqual(smokeVerdict({ status: 0, signal: null, timedOut: false, output: '2.17.0\n' }), {
    ok: true,
  });
});

/** @param {Parameters<typeof smokeVerdict>[0]} run @returns {string} */
function reasonOf(run) {
  const verdict = smokeVerdict(run);
  assert.equal(verdict.ok, false);
  return verdict.ok ? '' : verdict.reason;
}

test('a non-zero exit, a hang, a signal and silence each fail with the reason', () => {
  assert.match(
    reasonOf({ status: 1, signal: null, timedOut: false, output: 'Unable to create home' }),
    /exited 1/,
  );
  assert.match(
    reasonOf({ status: null, signal: 'SIGKILL', timedOut: true, output: '' }),
    new RegExp(`${String(SMOKE_TIMEOUT_MS / 1000)} s`),
  );
  assert.match(
    reasonOf({ status: null, signal: 'SIGTERM', timedOut: false, output: 'x' }),
    /SIGTERM/,
  );
  assert.match(reasonOf({ status: 0, signal: null, timedOut: false, output: '  \n' }), /no output/);
});
