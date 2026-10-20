#!/usr/bin/env node
/**
 * Writes or checks `docs/openapi.json` (ledger RF-11).
 *
 *   node scripts/openapi.mjs --write   regenerate the document
 *   node scripts/openapi.mjs --check   fail if the committed document is not what would be generated
 *
 * It reads the contracts from `packages/shared-contracts/dist`, so build first (`pnpm build`).
 * The drift gate that runs without a build is split in two so that `pnpm docs:check` stays a
 * pre-build step: `scripts/lib/openapi-drift.test.mjs` compares the routes, and
 * `packages/shared-contracts/src/openapi.test.ts` compares the schemas, both against the
 * committed file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as prettier from 'prettier';
import { buildOpenApiDocument, readApiSources, scanRoutes } from './lib/openapi-document.mjs';

const root = path.resolve(import.meta.dirname, '..');
const target = path.join(root, 'docs', 'openapi.json');
const mode = process.argv[2];

if (mode !== '--write' && mode !== '--check') {
  console.error('usage: node scripts/openapi.mjs --write | --check');
  process.exit(2);
}

const distEntry = path.join(root, 'packages', 'shared-contracts', 'dist', 'index.js');
if (!existsSync(distEntry)) {
  console.error('packages/shared-contracts/dist is missing; run `pnpm build` first.');
  process.exit(2);
}
const contracts = await import(pathToFileURL(distEntry).href);
const document = buildOpenApiDocument(
  scanRoutes(readApiSources(root)),
  contracts.buildComponentSchemas(contracts),
);
// Formatted with the repository's own Prettier configuration, so `pnpm format:check` has nothing
// to say about a generated file and no `.prettierignore` entry is needed to hide it.
const generated = await prettier.format(JSON.stringify(document), {
  ...(await prettier.resolveConfig(target)),
  parser: 'json',
});

if (mode === '--write') {
  writeFileSync(target, generated);
  console.log(`wrote docs/openapi.json: ${Object.keys(document.paths).length} path(s)`);
} else if (!existsSync(target) || readFileSync(target, 'utf8') !== generated) {
  console.error('docs/openapi.json is stale; run `pnpm openapi:generate` and commit the result.');
  process.exit(1);
} else {
  console.log('docs/openapi.json is current.');
}
