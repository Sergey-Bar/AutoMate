import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  REQUIRED_OBJECT_STORE_VARIABLES,
  composeProblems,
  environmentKeys,
  serviceNames,
} from './compose-contract.mjs';

/**
 * `pnpm compose:config` cannot catch this class. It resolves interpolation and reports
 * syntax, and a compose file that simply omits `OBJECT_STORE_*` is a perfectly valid
 * compose file. So the committed files are read here instead, and deleting the wiring
 * becomes a failing test rather than a deployment that stops working for whoever tries
 * it next.
 *
 * The two rules are deliberately both present. A production service declaring fewer
 * than the five variables produces a stack that **cannot boot** — the startup policy
 * throws. A declared endpoint naming a service the file does not declare produces a
 * stack that **does** boot and then fails every artifact write with a connection error,
 * which is the worse of the two precisely because it gets further before it fails.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const COMPOSE_FILES = ['docker-compose.unified.yml', 'infra/compose/compose.dev.yml'];

/** @param {string[]} problems @param {RegExp} pattern */
function has(problems, pattern) {
  return problems.some((problem) => pattern.test(problem));
}

test('the extractor reads a mapping environment block', () => {
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      A: "1"',
    '      B: "2"',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')].sort(), ['A', 'B']);
});

test('the extractor reads a list environment block', () => {
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      - A=1',
    '      - B=2',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')].sort(), ['A', 'B']);
});

test('the extractor stops at the end of the environment block', () => {
  // The bug this shape invites: reading on and attributing a sibling block's keys to
  // the service. `ports:` below would otherwise contribute `ports`.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      A: "1"',
    '    ports:',
    '      - "127.0.0.1:53000:3000"',
    '  web:',
    '    environment:',
    '      B: "2"',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')], ['A']);
  assert.deepEqual([...environmentKeys(compose, 'web')], ['B']);
});

test('a service with no environment block has no keys, and is not an error', () => {
  const compose = ['services:', '  worker:', '    restart: "no"', ''].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'worker')], []);
});

test('a value containing a hash is not treated as a comment', () => {
  // Compose values can legitimately contain `#`. Stripping it would corrupt the value
  // and, worse, teach the extractor to report a key whose value it misread.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      # a real comment',
    '      OBJECT_STORE_BUCKET: "bucket#1"',
    '      OTHER: "value" # trailing comment',
    '',
  ].join('\n');
  assert.deepEqual([...environmentKeys(compose, 'api')].sort(), ['OBJECT_STORE_BUCKET', 'OTHER']);
});

test('an unparseable line throws rather than returning a partial set', () => {
  // The whole reason this is a parser and not a regular expression. A partial set is
  // indistinguishable from a missing variable, so a silent truncation would report
  // "the variable is absent" for a file that declares it, and the finding would be
  // unactionable.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      GOOD: "1"',
    '      ?? this is not an environment entry ??',
    '',
  ].join('\n');
  assert.throws(() => environmentKeys(compose, 'api'), /unparseable line/);
});

test('service names are read from the services block only', () => {
  const compose = [
    'services:',
    '  postgres:',
    '    image: postgres:16-alpine',
    '  api:',
    '    build: .',
    'volumes:',
    '  data:',
    '',
  ].join('\n');
  assert.deepEqual(serviceNames(compose), ['postgres', 'api']);
});

/**
 * A synthetic compose file with the five object-store variables declared.
 *
 * `OBJECT_STORE_ENDPOINT` gets a real endpoint rather than `"value"` for every variable
 * — the first version of these fixtures set all five to the same string, so the
 * endpoint's host was literally `value`, which the undeclared-service rule correctly
 * flagged. The fixture was wrong, not the rule, and the two failures together were the
 * rule working.
 *
 * @param {{ omit?: string, endpoint?: string, declareMinio?: boolean }} [options]
 */
function composeWithObjectStore({
  omit,
  endpoint = 'http://minio:9000',
  declareMinio = true,
} = {}) {
  return [
    'services:',
    ...(declareMinio ? ['  minio:', '    image: minio/minio'] : []),
    '  api:',
    '    build:',
    '      dockerfile: infra/docker/api.Dockerfile',
    '    environment:',
    '      NODE_ENV: production',
    ...REQUIRED_OBJECT_STORE_VARIABLES.filter((name) => name !== omit).map((name) =>
      name === 'OBJECT_STORE_ENDPOINT' ? `      ${name}: "${endpoint}"` : `      ${name}: "v"`,
    ),
    '',
  ].join('\n');
}

test('a production service missing an object store variable is a finding', () => {
  const problems = composeProblems(
    'x.yml',
    composeWithObjectStore({ omit: 'OBJECT_STORE_BUCKET' }),
  );
  assert.equal(problems.length, 1);
  assert.ok(has(problems, /OBJECT_STORE_BUCKET/));
  assert.ok(has(problems, /startup-policy\.ts/), 'the message must say which check this is');
  assert.ok(
    has(problems, /would not boot/),
    'and what the consequence is, or the reader has to work it out',
  );
});

test('a production service declaring all five is clean', () => {
  assert.deepEqual(composeProblems('x.yml', composeWithObjectStore()), []);
});

test('a development service is not held to the production contract', () => {
  // The dev stack's API is `NODE_ENV: development`, which is why this defect survived in
  // one file and not the other. Holding dev to the production rule would be wrong: the
  // policy genuinely does not apply.
  const compose = [
    'services:',
    '  api:',
    '    environment:',
    '      NODE_ENV: development',
    '',
  ].join('\n');
  assert.deepEqual(composeProblems('x.yml', compose), []);
});

test('an endpoint naming an undeclared service is a finding', () => {
  // The failure that gets further before it fails: the stack boots, and then every
  // artifact write gets a DNS error for a name the compose network cannot resolve.
  const problems = composeProblems(
    'x.yml',
    composeWithObjectStore({ endpoint: 'http://object-store:9000', declareMinio: false }),
  );
  assert.ok(has(problems, /object-store/));
  assert.ok(has(problems, /does not declare as a service/));
});

test('an interpolated or external endpoint host is not treated as a service name', () => {
  // `https://s3.eu-west-1.amazonaws.com` and a `${VAR}` endpoint are legitimate; the
  // rule is about a bare hostname compose would try to resolve on its own network. An
  // interpolated value is the one that got this wrong first: `${OBJECT_STORE_ENDPOINT}`
  // has no dot and no port, so the first version flagged the repository's own
  // production file for an endpoint it resolves at deploy time.
  for (const endpoint of [
    'https://s3.eu-west-1.amazonaws.com',
    '${OBJECT_STORE_ENDPOINT}',
    '${MINIO_HOST:-minio}:9000',
  ]) {
    assert.deepEqual(
      composeProblems('x.yml', composeWithObjectStore({ endpoint, declareMinio: false })),
      [],
      `endpoint ${endpoint}`,
    );
  }
});

for (const file of COMPOSE_FILES) {
  test(`${file} satisfies the object-store contract`, () => {
    const text = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    assert.deepEqual(
      composeProblems(file, text),
      [],
      'a production service that does not declare the object store cannot start — see ' +
        'apps/api/src/startup-policy.ts and the C-5 row in the findings ledger.',
    );
  });
}

test('the production stack really does declare the object store', () => {
  // Belt and braces, and deliberately explicit rather than derived: this asserts the
  // specific wiring rather than only the absence of a finding, so a change that made
  // the contract vacuously true — no production service at all — still fails.
  const text = readFileSync(path.join(REPO_ROOT, 'docker-compose.unified.yml'), 'utf8');
  const keys = environmentKeys(text, 'api');
  for (const name of REQUIRED_OBJECT_STORE_VARIABLES) {
    assert.ok(keys.has(name), `docker-compose.unified.yml api must declare ${name}`);
  }
  assert.equal(
    keys.has('NODE_ENV'),
    true,
    'the api service must still claim to be production, or this file is testing nothing',
  );
  assert.ok(
    serviceNames(text).includes('minio'),
    'the production stack must declare the object store service the endpoint names',
  );
});
