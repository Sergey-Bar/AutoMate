import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalRouteKeys } from './route-manifest.mjs';

/**
 * The generated OpenAPI document is current, or a reader is reading a stale contract.
 *
 * The document is generated, so the routes in it are not a claim anybody made: the
 * paths come from `route-manifest.ts`, which its own test proves equal to the
 * running app's route set, and the response statuses come from the recorded authz
 * matrix. What *can* go wrong is that the committed artefact stops matching those
 * sources — a route added to the manifest and never regenerated is a document that
 * describes a smaller product while being read as the whole one.
 *
 * **What this check does not do, and why it differs from the generated-pages check.**
 *
 * The staleness test for the status pages copies the generator into
 * `node_modules/.cache` and runs the copy, because that generator resolves its own
 * output directory and would otherwise rewrite the very files being checked. This
 * generator takes an explicit `--out`, so it never writes into the checkout unless
 * it is told the committed path — which means the read-only property can be had by
 * running it **in place** with a `--out` pointing at a temporary file, and the copy
 * step is unnecessary complexity. The first version copied it, and the only effect
 * was that the schema imports then resolved against a tree with no `node_modules`
 * beside them.
 *
 * So: run in place, write to a temporary file, compare. The working tree is never
 * touched, and a failure names a path rather than leaving a modified file behind.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const generator = path.join(root, 'scripts', 'openapi.mjs');
const committed = path.join(root, 'docs', 'api', 'openapi.json');

/** The temporary directory, removed by the last thing that runs. */
const scratch = mkdtempSync(path.join(os.tmpdir(), 'openapi-stale-'));

process.on('exit', () => {
  rmSync(scratch, { recursive: true, force: true });
});

test('the generated OpenAPI document is current', () => {
  assert.ok(
    existsSync(generator),
    'scripts/openapi.mjs is missing, so nothing can regenerate the document.',
  );
  assert.ok(
    existsSync(committed),
    'docs/api/openapi.json is missing. Run `pnpm openapi` to generate and commit it.',
  );

  const produced = path.join(scratch, 'openapi.json');
  const run = spawnSync(process.execPath, [generator, `--out=${produced}`], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    run.status,
    0,
    'the OpenAPI generator failed, so the document cannot be shown to be current: ' +
      String(run.stderr ?? run.stdout),
  );

  assert.equal(
    readFileSync(produced, 'utf8'),
    readFileSync(committed, 'utf8'),
    'docs/api/openapi.json is stale; run `pnpm openapi` and commit the result. The ' +
      'working tree was not modified.',
  );
});

test('the generated document describes every canonical route, and derives its bodies', () => {
  // Read out of the artefact rather than trusted. The drift check above compares
  // to a committed file, so on its own it cannot tell a *complete* document from a
  // *wrong* one; this is what proves the artefact is the route set.
  const document = JSON.parse(readFileSync(committed, 'utf8'));
  const operations = Object.entries(document.paths ?? {}).flatMap(([routePath, verbs]) =>
    Object.entries(verbs).map(([method]) => `${String(method).toUpperCase()} ${routePath}`),
  );
  assert.deepEqual(
    operations.slice().sort(),
    canonicalRouteKeys().slice().sort(),
    'the document and the canonical route set are not the same set',
  );

  const derived = Object.keys(document.components?.schemas ?? {});
  assert.ok(
    derived.length > 0,
    'no request body is derived. `z.toJSONSchema` is the reason this document exists rather ' +
      'than a manifest with extra syntax, so a document with none is a hand-written one.',
  );
  for (const [routePath, verbs] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(verbs)) {
      const reference =
        /** @type {{ requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> } }} */ (
          operation
        ).requestBody?.content?.['application/json']?.schema?.$ref;
      if (typeof reference === 'string') {
        assert.ok(
          derived.includes(reference.replace('#/components/schemas/', '')),
          `${method.toUpperCase()} ${routePath} references ${reference}, which no component defines.`,
        );
      }
    }
  }
});
