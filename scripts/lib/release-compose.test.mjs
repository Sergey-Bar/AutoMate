import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { serviceNames, serviceScalar } from './compose-contract.mjs';
import {
  PUBLISHED_IMAGES,
  REGISTRY,
  envExample,
  imageReference,
  releaseCompose,
} from './release-compose.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const SOURCE = readFileSync(
  path.join(REPO_ROOT, 'infra/compose/docker-compose.unified.yml'),
  'utf8',
);

test('an image reference is the registry, the service and an overridable version', () => {
  assert.equal(
    imageReference('api', '2.5.0'),
    `${REGISTRY}/automate-api:\${AUTOMATE_VERSION:-2.5.0}`,
  );
  assert.equal(REGISTRY, 'ghcr.io/sergey-bar');
});

test('the release file keeps every service and builds none', () => {
  const out = releaseCompose(SOURCE, '2.5.0');
  assert.deepEqual(serviceNames(out), serviceNames(SOURCE));
  assert.doesNotMatch(out, /^\s+build:/m);
  assert.doesNotMatch(out, /^\s+(context|dockerfile):/m);
  for (const service of PUBLISHED_IMAGES) {
    assert.equal(serviceScalar(out, service, 'image'), imageReference(service, '2.5.0'), service);
  }
  // A service that was already an image keeps it.
  assert.equal(serviceScalar(out, 'postgres', 'image'), serviceScalar(SOURCE, 'postgres', 'image'));
});

test('every built service is a published image, and every published image is built', () => {
  const built = serviceNames(SOURCE).filter((service) =>
    new RegExp(`^  ${service}:\\n(?:    .*\\n|\\s*\\n)*?    build:`, 'm').test(SOURCE),
  );
  assert.deepEqual([...built].sort(), [...PUBLISHED_IMAGES].sort());
});

test('a built service the release does not publish is refused, not silently copied', () => {
  const source = [
    'services:',
    '  extra:',
    '    build:',
    '      context: ../..',
    '      dockerfile: infra/docker/extra.Dockerfile',
    '',
  ].join('\n');
  assert.throws(() => releaseCompose(source, '1.0.0'), /`extra` is built.*not a published image/);
});

test('the env example names every required variable, plus the release settings', () => {
  const out = releaseCompose(SOURCE, '2.5.0');
  const example = envExample(out);
  for (const match of out.matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)) {
    assert.match(example, new RegExp(`^${match[1] ?? ''}=`, 'm'), match[1]);
  }
  for (const name of ['AUTOMATE_VERSION', 'AUTOMATE_BIND', 'AUTOMATE_PORT']) {
    assert.match(example, new RegExp(`^#? ?${name}=`, 'm'), name);
  }
});
