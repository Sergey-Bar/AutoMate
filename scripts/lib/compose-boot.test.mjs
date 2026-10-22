import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  DEV_ONLY_PACKAGES,
  NODE_RUNTIME_IMAGES,
  bootEnvironment,
  bootProbes,
  budgetProblems,
  devPackageProbe,
  envFileText,
  requiredVariables,
} from './compose-boot.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

test('required variables are read from ${NAME:?…} only, once each', () => {
  const text = 'a: ${B:?set B}\nb: ${A:?set A}\nc: ${A:?again}\nd: ${C:-default}\n';
  assert.deepEqual(requiredVariables(text), ['A', 'B']);
});

test('the boot environment covers every variable the production stack requires', () => {
  // The coupling this gate depends on: a variable added to the compose file without a
  // value here would make `compose:boot` fail on a missing variable rather than on the
  // stack, which is the worst way for a boot gate to be red.
  const text = readFileSync(
    path.join(REPO_ROOT, 'infra/compose/docker-compose.unified.yml'),
    'utf8',
  );
  const names = requiredVariables(text);
  assert.ok(names.includes('AUTOMATE_INSTALLATION_KEY'), 'the stack must require the key');
  const values = bootEnvironment(names);
  assert.deepEqual([...values.keys()].sort(), names);
  for (const [name, value] of values) {
    if (name === 'OBJECT_STORE_BUCKET' || name === 'OBJECT_STORE_REGION') continue;
    assert.ok(value.length >= 20, `${name} is too short to pass the secret floor`);
  }
});

test('secrets are random per run and long enough for the policy floor', () => {
  const first = bootEnvironment(['COOKIE_SECRET']).get('COOKIE_SECRET') ?? '';
  const second = bootEnvironment(['COOKIE_SECRET']).get('COOKIE_SECRET') ?? '';
  assert.equal(first.length, 48);
  assert.notEqual(first, second);
});

test('the env file is one NAME=value line per variable', () => {
  assert.equal(
    envFileText(
      new Map([
        ['A', '1'],
        ['B', '2'],
      ]),
    ),
    'A=1\nB=2\n',
  );
});

test('the probes check readiness, the UI and a sign-in with the installation key', () => {
  const probes = bootProbes('http://127.0.0.1:8080', 'the-key');
  assert.deepEqual(
    probes.map((probe) => probe.url),
    [
      'http://127.0.0.1:8080/api/v1/ready',
      'http://127.0.0.1:8080/',
      'http://127.0.0.1:8080/api/v1/auth/login',
    ],
  );
  assert.equal(JSON.parse(String(probes[2]?.init?.body)).apiKey, 'the-key');
});

test('an image over its ceiling, or with none, is a finding', () => {
  const mb = 1024 * 1024;
  const problems = budgetProblems(
    new Map([
      ['api', 600 * mb],
      ['web', 50 * mb],
      ['extra', 10 * mb],
    ]),
    { api: { maxMegabytes: 560 }, web: { maxMegabytes: 100 } },
  );
  assert.deepEqual(problems, [
    'image `api` is 600 MB, over its 560 MB ceiling',
    'image `extra` (10 MB) has no ceiling in image-budget.json',
  ]);
});

test('the dev-package probe names every dev-only package and prints what resolves', () => {
  const probe = devPackageProbe();
  for (const name of DEV_ONLY_PACKAGES) assert.ok(probe.includes(`"${name}"`), name);
  assert.ok(NODE_RUNTIME_IMAGES.includes('api'));
});
