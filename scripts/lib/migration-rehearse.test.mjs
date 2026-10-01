import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

/**
 * `migrate:rehearse` refuses before it touches anything.
 *
 * Every one of these refusals is the reason the command is safe to hand to somebody
 * before W7 lands. A rehearsal that can dump a production database, or that can
 * migrate the source, is worse than no rehearsal: it is a rehearsal that destroys
 * evidence. They are tested here by running the command, because a refusal asserted
 * about the source rather than about the process is a comment.
 */

const COMMAND = 'node';
const SCRIPT = ['scripts/migration-rehearse.mjs'];

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ status: number | null, stderr: string }}
 */
function run(env) {
  const result = spawnSync(COMMAND, SCRIPT, {
    env: { ...process.env, DATABASE_URL: undefined, REHEARSAL_RESTORE_URL: undefined, ...env },
    encoding: 'utf8',
  });
  return { status: result.status, stderr: String(result.stderr ?? '') };
}

const LOCAL = 'postgresql://automate:local@127.0.0.1:5432/automate';
const RESTORE = 'postgresql://automate:local@127.0.0.1:5433/automate_restore';

/**
 * A vault secret, assembled rather than written.
 *
 * `apps/api/src/test-support/synthetic-credentials.ts` is the repository's fixture for
 * this, and it is not reachable from here: this is a `.mjs` gate script, and reaching into
 * another package's `test-support` directory would make `scripts/` depend on `apps/api`'
 * test layout. So the value is assembled the same way the fixture assembles its own —
 * `['a-vault', '-secret-that-is-long-enough-for-this'].join('')` — which keeps it out of
 * the committed tree as a credential-shaped literal for any scanner to find.
 */
const LONG_SECRET = ['a-vault', '-secret-that-is-long-enough-for-this'].join('');

test('refuses without REHEARSAL_MODE=local', () => {
  const result = run({ REHEARSAL_MODE: 'production', DATABASE_URL: LOCAL });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REHEARSAL_MODE=local/);
});

test('refuses a non-loopback source, before connecting to anything', () => {
  const result = run({
    REHEARSAL_MODE: 'local',
    DATABASE_URL: 'postgresql://automate:pw@db.production.internal:5432/automate',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be loopback/);
});

test('refuses without a restore target, because in-place would prove nothing', () => {
  const result = run({ REHEARSAL_MODE: 'local', DATABASE_URL: LOCAL, VAULT_SECRET: LONG_SECRET });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REHEARSAL_RESTORE_URL/);
  assert.match(result.stderr, /no in-place mode/);
});

test('refuses a non-loopback restore target', () => {
  const result = run({
    REHEARSAL_MODE: 'local',
    DATABASE_URL: LOCAL,
    REHEARSAL_RESTORE_URL: 'postgresql://automate:pw@restore.production.internal:5432/x',
    VAULT_SECRET: LONG_SECRET,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /REHEARSAL_RESTORE_URL must be loopback/);
});

test('refuses a restore target that is the source', () => {
  // The one that matters most. Migrating the source is the mistake D1 exists to
  // prevent, and the rehearsal would otherwise do it silently and report a pass.
  const result = run({
    REHEARSAL_MODE: 'local',
    DATABASE_URL: LOCAL,
    REHEARSAL_RESTORE_URL: LOCAL,
    VAULT_SECRET: LONG_SECRET,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must not be the source/);
});

test('refuses without VAULT_SECRET, rather than reporting an empty vault', () => {
  // Without the key every row fails to open, and the report would read as a
  // destroyed vault — which sends an operator after the data instead of after the
  // environment.
  const result = run({
    REHEARSAL_MODE: 'local',
    DATABASE_URL: LOCAL,
    REHEARSAL_RESTORE_URL: RESTORE,
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VAULT_SECRET/);
});

test('refuses publication and cutover, reusing the guard that already says so', () => {
  const result = run({
    REHEARSAL_MODE: 'local',
    DATABASE_URL: LOCAL,
    REHEARSAL_RESTORE_URL: RESTORE,
    VAULT_SECRET: LONG_SECRET,
    PRODUCTION_CUTOVER: 'true',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cutover are forbidden/);
});
