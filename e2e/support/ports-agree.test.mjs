import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The E2E suite's two halves must agree about where the servers are.
 *
 * ## What happened
 *
 * `playwright.config.ts` held `apiPort = 3000` and `e2e/support/config.ts` held
 * `API_BASE = 'http://127.0.0.1:3000'` and `WEB_BASE = 'http://localhost:5173'` — three
 * literals for two ports. Making the config's port overridable, on its own, **made the suite
 * worse on every machine**: it started its API on 3111 and posted every login to whatever was
 * listening on 3000, which answered `500`. The first version was a hazard on a busy machine;
 * the "fix" was a hazard everywhere, introduced by the fix.
 *
 * ## Why a source rule and not an import
 *
 * `playwright.config.ts` exports a `defineConfig` result, not its ports, so there is nothing to
 * import without evaluating a module that starts servers' worth of configuration. And the
 * failure is textual — a literal port number written beside a literal base URL — so the check
 * that catches it is textual too.
 *
 * The alternative was an assertion that both files read the same variable, which is what the
 * fix actually is; this test asserts the *consequence* instead, because the consequence is what
 * a reader needs protected and the mechanism is free to change.
 */

/** @returns {string} */
const configSource = () => readFileSync(path.join(repoRoot, 'playwright.config.ts'), 'utf8');

/** @returns {string} */
const supportSource = () =>
  readFileSync(path.join(repoRoot, 'e2e', 'support', 'config.ts'), 'utf8');

test('the suite reads its ports from one place rather than restating them', () => {
  const config = configSource();
  const support = supportSource();

  // `API_BASE`, `WEB_BASE`, `API_PORT` and `WEB_PORT` are imported from the support module.
  for (const name of ['API_BASE', 'API_PORT', 'WEB_BASE']) {
    assert.match(
      config,
      new RegExp(`\\b${name}\\b`),
      `playwright.config.ts does not read ${name}, so the server and the client can disagree`,
    );
  }
  assert.doesNotMatch(
    config,
    /const\s+apiPort\s*=\s*\d/,
    'playwright.config.ts declares a literal API port beside the imported base URL. That is the ' +
      'defect this test exists for: the suite booted on one port and posted to another.',
  );
  assert.doesNotMatch(
    config,
    /http:\/\/127\.0\.0\.1:\d+/,
    'playwright.config.ts writes a literal API URL, so it has its own copy of the address the ' +
      'specs post to.',
  );
  assert.match(
    support,
    /E2E_API_PORT/,
    'e2e/support/config.ts no longer reads E2E_API_PORT, so the override has nowhere to come from.',
  );
});

test('the override has an escape hatch on both ports and keeps the defaults', () => {
  const support = supportSource();
  // The defaults are what CI gets, and they are the ports the docs and the workflows name.
  assert.match(support, /E2E_API_PORT'\], 3000/, 'the API port default changed from 3000');
  assert.match(support, /E2E_WEB_PORT'\], 5173/, 'the web port default changed from 5173');
});
