import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

/**
 * Ledger P-72b, read structurally.
 *
 * `apps/api/src/index.ts` writes an installation key whenever a database exists. Production
 * must never *derive* one, so the refusal has to come first. The composition test in
 * `index-production-composition.test.ts` proves the refusal behaviourally; this one fails at
 * the line that moved, which is the faster thing to read when the order is broken.
 *
 * The call that writes the key is `ensureConfigured` (which uses `ensureBootstrap` for the
 * first write): it also replaces a key the operator has since changed, so a rotation takes
 * effect on restart. Either name is accepted, so the guard is about order, not spelling.
 */
const source = readFileSync(path.join(REPO_ROOT, 'apps', 'api', 'src', 'index.ts'), 'utf8');
const KEY_WRITE = /\.(?:ensureBootstrap|ensureConfigured)\(/;

test('the bootstrap key is derived only where deriving one is allowed', () => {
  const guard = source.indexOf('throw new Error(NO_INSTALLATION_KEY)');
  const write = source.search(KEY_WRITE);

  assert.ok(write > -1, 'the call must still exist; this test is about when it runs, not whether');
  assert.ok(guard > -1, 'the production refusal must still exist');
  assert.ok(guard < write, 'the refusal must be evaluated before any key is written');
});

test('the refusal is conditional on the deriving policy, not unconditional', () => {
  assert.match(source, /!mayDeriveInstallationKey\(runtimeConfig\)/);
});

test('production refuses to derive a key rather than deriving one quietly', () => {
  // The policy lives beside the cosmetic display prefix, in the one module that knows about
  // the environment, rather than being inlined at the call site.
  const helper = readFileSync(
    path.join(REPO_ROOT, 'apps', 'api', 'src', 'bootstrap-display-prefix.ts'),
    'utf8',
  );
  assert.match(helper, /nodeEnv|production/);
});
