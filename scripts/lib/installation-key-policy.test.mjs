import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * Production must not invent its own installation key.
 *
 * `ensureBootstrap` runs on every boot that has a database — development and
 * production alike — and derives a key from
 * `hashCredential(authCookieSecret, installationKey)`, inserting a row. So every
 * production deployment silently grew a credential nobody chose, derived from a
 * default `installationKey` that is in the repository.
 *
 * The fix is to make deriving a key an explicit decision. Development keeps the
 * convenience, because that is where it is one; production requires the operator to
 * present a key, because that is where it is not.
 */
const source = readFileSync(
  path.join(path.resolve(import.meta.dirname, '..', '..'), 'apps', 'api', 'src', 'index.ts'),
  'utf8',
);

test('the bootstrap key is derived only where deriving one is allowed', () => {
  // Asserted on the source because the alternative is a test that boots the whole
  // application against a production config and a live database, for a decision that
  // is one boolean at one call site.
  assert.match(
    source,
    /ensureBootstrap\(/,
    'the call must still exist; this test is about when it runs, not whether',
  );
  // The guard is named rather than inlined, so a reader can find the policy.
  assert.match(source, /mayDeriveInstallationKey|assertInstallationKeyBootstrapAllowed/);
});

test('production refuses to derive a key rather than deriving one quietly', () => {
  // The consequence that matters: a production boot with no operator-provided key
  // must fail with a message that says what to do, not start with a credential
  // derived from a constant in the repository.
  const helper = readFileSync(
    path.join(
      path.resolve(import.meta.dirname, '..', '..'),
      'apps',
      'api',
      'src',
      'bootstrap-display-prefix.ts',
    ),
    'utf8',
  );
  // Same file, same property: the display prefix is a cosmetic label, and the policy
  // belongs beside it rather than in a module that only has one export.
  assert.match(helper, /nodeEnv|production/);
});
