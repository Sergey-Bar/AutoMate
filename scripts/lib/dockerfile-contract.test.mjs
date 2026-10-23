import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { finalStage, stages } from './dockerfile-contract.mjs';

/**
 * What the published images must be: what they run and nothing else.
 *
 * Every Node image used to `COPY . .` the whole monorepo into its runtime and keep the
 * dev dependency tree — Vitest, ESLint, TypeScript, Storybook — in a container a user
 * downloads. The runtime stage now receives only a `pnpm deploy --prod` output. These
 * assertions read the Dockerfiles; `pnpm compose:boot` checks the built images.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const NODE_IMAGES = ['api', 'worker', 'runner', 'migrate'];

/** @param {string} relative */
function read(relative) {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

test('stages are split on FROM and named by AS', () => {
  const text = 'FROM a AS build\nRUN x\nFROM b AS runtime\nCOPY --from=build /out ./\n';
  assert.deepEqual(
    stages(text).map((stage) => stage.name),
    ['build', 'runtime'],
  );
  assert.match(finalStage(text).body, /COPY --from=build/);
});

for (const name of NODE_IMAGES) {
  const file = `infra/docker/${name}.Dockerfile`;

  test(`${file} ships a production deploy, not the monorepo`, () => {
    const text = read(file);
    assert.ok(stages(text).length >= 2, `${file} must build in one stage and run in another`);
    assert.match(
      text,
      /pnpm --filter "?@automate\/[a-z-]+"? --prod deploy --legacy \/out/,
      `${file} must produce its runtime with \`pnpm deploy --prod\``,
    );
    const runtime = finalStage(text).body;
    assert.doesNotMatch(runtime, /^COPY \. \./m, `${file}: the runtime stage copies the monorepo`);
    assert.doesNotMatch(
      runtime,
      /pnpm install/,
      `${file}: the runtime stage installs dependencies`,
    );
    assert.match(runtime, /COPY --from=build (--chown=node:node )?\/out \.\//);
  });

  test(`${file} labels the image with its source, version and revision`, () => {
    const runtime = finalStage(read(file)).body;
    for (const label of ['source', 'version', 'revision']) {
      assert.match(runtime, new RegExp(`org\\.opencontainers\\.image\\.${label}=`), label);
    }
  });

  test(`${file} runs as an unprivileged user`, () => {
    assert.match(finalStage(read(file)).body, /^USER node$/m);
  });
}

test('one migration image, used by both stacks', () => {
  assert.equal(existsSync(path.join(REPO_ROOT, 'infra/docker/db-migrate.Dockerfile')), false);
  for (const compose of [
    'infra/compose/docker-compose.unified.yml',
    'infra/compose/compose.dev.yml',
  ]) {
    assert.match(read(compose), /dockerfile: infra\/docker\/migrate\.Dockerfile/, compose);
  }
});

test('every built image has a size budget, and nothing else does', () => {
  /** @type {Record<string, unknown>} */
  const budget = JSON.parse(read('infra/docker/image-budget.json'));
  const budgeted = Object.keys(budget)
    .filter((key) => !key.startsWith('$'))
    .sort();
  const built = ['api', 'edge', 'migrate', 'runner', 'web', 'worker'];
  assert.deepEqual(budgeted, built);
  for (const name of built) {
    const entry = /** @type {Record<string, unknown>} */ (budget[name]);
    assert.equal(typeof entry['maxMegabytes'], 'number', name);
  }
});

test('the runner image advertises every capability an agent adapter requires (ledger MNT-150)', () => {
  // Two domains were merged separately, each adding its own capability to a different
  // place, and the image kept only `k6`: an `api.run` job was accepted with 202 and then
  // waited forever, because no runner in the production image could claim it.
  const image = /^ENV RUNNER_CAPABILITIES=(\S+)$/m.exec(read('infra/docker/runner.Dockerfile'));
  assert.ok(image !== null, 'runner.Dockerfile must set RUNNER_CAPABILITIES');
  const advertised = new Set((image[1] ?? '').split(','));
  const required = new Set(
    ['browser', 'api', 'load'].flatMap((domain) =>
      [
        ...read(`apps/api/src/agents/${domain}-adapter.ts`).matchAll(
          /requiredCapabilities: \[([^\]]*)\]/g,
        ),
      ]
        .flatMap((match) => (match[1] ?? '').split(','))
        .map((name) => name.trim().replace(/['"]/g, ''))
        .filter(Boolean),
    ),
  );
  assert.deepEqual([...required].sort(), ['api', 'k6', 'playwright']);
  for (const capability of required) {
    assert.ok(advertised.has(capability), `the runner image does not advertise \`${capability}\``);
  }
});
