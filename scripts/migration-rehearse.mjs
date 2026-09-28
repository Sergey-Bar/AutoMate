import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertLocalRehearsal } from './lib/local-rehearsal-guard.mjs';
import { rehearseMigration, toReport } from './lib/rehearsal-run.mjs';

/**
 * `pnpm migrate:rehearse` — the command D1 asks for and RF-5 says is missing.
 *
 * Sequence, and the order is the content:
 *
 *  1. `pg_dump` the **source**. Nothing has been touched.
 *  2. `pg_restore` onto a **clean** instance. The copy is disposable; the source is not.
 *  3. Apply the migration graph **to the restore**. This is the step people get wrong.
 *     A rehearsal that migrates the source has proved that a migration runs, which CI
 *     already proved against an empty schema yesterday. The open question is whether it
 *     runs over data, and the only data is in the source, so the copy is what gets
 *     destroyed.
 *  4. Re-open **every sealed row** in the restore, through the product's own vault
 *     module, and fail if any will not open.
 *
 * `smoke:rehearsal` is not this and is not replaced by it: that script guards the
 * target and keeps doing so. What changed is that the report it wrote — whose own field
 * read `rehearsalPerformed: false` under a heading that read "rehearsal passed" — now
 * has a sibling that performs one and records which phases ran.
 *
 * **Deliberately not in `verify` and deliberately not in any workflow.** Both need a
 * live second database and CI has none; a rehearsal against a service container proves
 * that `pg_dump` exists. `scripts/gate-tooling.json` records the tool dependencies
 * (`pg_dump`, `pg_restore`, `psql`) and the tier, so the omission is a decision on the
 * record rather than an oversight nobody notices.
 *
 * **Loopback only, via the existing guard.** The same refusal `smoke:rehearsal` makes:
 * a rehearsal that can dump a production database is one keystroke away from a
 * production incident, and the guard is already written and tested.
 */

const env = process.env;

// The guard, not a re-implementation: it refuses a non-loopback target, a missing
// DATABASE_URL, and publication or cutover. A second copy of that decision is a second
// decision.
const target = assertLocalRehearsal(env);

const restoreUrl = env['REHEARSAL_RESTORE_URL'];
if (!restoreUrl) {
  throw new Error(
    'Rehearsal requires REHEARSAL_RESTORE_URL — a clean, disposable PostgreSQL instance. ' +
      'The source is dumped and the copy is migrated; there is no in-place mode, because ' +
      'in-place would prove nothing about the data.',
  );
}
// `globalThis.URL`, as `local-rehearsal-guard.mjs` writes it: the `scripts/` ESLint
// config does not declare `URL` as a global, and a bare `new URL` there is a
// `no-undef` error rather than a runtime difference.
const restoreParsed = new globalThis.URL(restoreUrl);
if (!['127.0.0.1', 'localhost', '::1'].includes(restoreParsed.hostname)) {
  throw new Error('REHEARSAL_RESTORE_URL must be loopback, for the same reason the source is');
}
if (restoreUrl === env['DATABASE_URL']) {
  throw new Error(
    'REHEARSAL_RESTORE_URL must not be the source. Migrating the source is the thing this ' +
      'command exists to avoid doing.',
  );
}

const vaultSecret = env['VAULT_SECRET'];
if (!vaultSecret) {
  throw new Error(
    'Rehearsal requires VAULT_SECRET. Without it every row fails to open, which reports as a ' +
      'destroyed vault rather than as a missing environment variable.',
  );
}

// `assertLocalRehearsal` has already refused a missing `DATABASE_URL`; the second read
// is for the type checker, which does not know that.
const sourceUrl = env['DATABASE_URL'];
if (!sourceUrl) throw new Error('DATABASE_URL is required, and the guard already said so');

const runId = createHash('sha256')
  .update(`${target.databaseName}:${restoreParsed.pathname}:${new Date().toISOString()}`)
  .digest('hex')
  .slice(0, 16);
const outputRoot = env['REHEARSAL_REPORT_DIR'] ?? path.join('var', 'migration-rehearsal', runId);
const dumpPath = path.join(outputRoot, `${runId}.dump`);
mkdirSync(outputRoot, { recursive: true });

/**
 * Run a PostgreSQL client, and fail loudly.
 *
 * `stdio: 'inherit'` on the dump rather than `'pipe'`: a `pg_dump` that fails halfway
 * has written a partial file, and a rehearsal that restored from it would be reporting
 * on a database nobody had.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} [extraEnv]
 */
function run(command, args, extraEnv) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    ...(extraEnv === undefined ? {} : { env: { ...env, ...extraEnv } }),
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited ${String(result.status)}`);
}

/**
 * The vault opener, from the product's own module rather than a reimplementation of it.
 *
 * A rehearsal that opened rows with a second implementation of the decryption would
 * prove the second implementation still works. Built output, so `pnpm build` is a
 * prerequisite and a missing build says so rather than failing as an unreadable vault.
 */
const { openSecret, VaultRowUnboundError } =
  await import('../apps/api/dist/infrastructure/vault-crypto.js').catch((cause) => {
    throw new Error(
      'The vault module could not be loaded from apps/api/dist, so nothing here could prove a ' +
        `row is readable. Run "pnpm build" first. (${String(cause)})`,
    );
  });

/**
 * Every sealed row, read through `psql` so this script needs no database driver.
 *
 * `iterations` is carried but not used by the opener: `keyFor` derives at the cost the
 * product derives at, and a rehearsal that honoured a per-row iteration count would be
 * testing a decryption path nothing else uses. It is selected anyway so a migration that
 * narrows or drops the column is visible here rather than at the first production read.
 */
const SEALED_ROWS_SQL = `SELECT id, workspace_id, connector_name, ciphertext, iv, auth_tag, salt, iterations
FROM vault_entries
ORDER BY id;`;

/**
 * @typedef {object} SealedInput
 * @property {import('../apps/api/dist/infrastructure/vault-crypto.js').VaultEnvelope} envelope
 * @property {import('../apps/api/dist/infrastructure/vault-crypto.js').VaultRowBinding} binding
 */

const result = await rehearseMigration(
  {
    dump: async () => {
      run('pg_dump', ['--format=custom', '--file', dumpPath, sourceUrl]);
      return dumpPath;
    },
    restore: async (from) => {
      run('pg_restore', ['--clean', '--if-exists', '--dbname', restoreUrl, from]);
    },
    migrate: async () => {
      // `DATABASE_URL` is repointed at the restore and nothing else changes, so the
      // migration that runs here is byte-for-byte the one that would run in production —
      // which is the only way this phase is worth running at all.
      run('node', ['packages/db/dist/migrate.js'], { DATABASE_URL: restoreUrl });
    },
    fetchSealedRows: async () => {
      const out = spawnSync(
        'psql',
        [
          '--dbname',
          restoreUrl,
          '--tuples-only',
          '--no-align',
          '--field-separator=',
          '--command',
          SEALED_ROWS_SQL,
        ],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
      );
      if (out.error) throw new Error(`psql: ${out.error.message}`);
      if (out.status !== 0) throw new Error(`psql exited ${String(out.status)}`);
      return out.stdout
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => {
          const [id, workspaceId, name, ciphertext, iv, authTag, salt, iterations] =
            line.split('|');
          return {
            rowId: id,
            input: {
              envelope: {
                // The vault has no `version` column: everything in `vault_entries` is a
                // bound envelope, because `0020_connector_credentials_tenant.sql` moved
                // the table to `(workspace_id, connector_name)` and the repair tool
                // re-sealed what it found. Stating 2 rather than reading a column is
                // correct, and `openLegacySecret` remains the path for a v1 row — which
                // this reports as `binding_mismatch`, because a rehearsal must not call
                // unbound data safe.
                version: 2,
                algorithm: 'aes-256-gcm',
                keyVersion: 1,
                ciphertext,
                iv,
                tag: authTag,
                salt,
                iterations: Number(iterations),
              },
              binding: { entryId: id, workspaceId, name },
            },
          };
        });
    },
    open: (row) => {
      // The port's `input` is `unknown` because the verifier is generic over it; here it
      // is always what `fetchSealedRows` above built, so it is narrowed once rather than
      // re-checked on every row.
      const { envelope, binding } = /** @type {SealedInput} */ (row.input);
      try {
        // The binding is passed, not reconstructed: `openSecret` folds the row identity
        // into the tag check, which is exactly what detects a migration that renamed or
        // re-typed a column the AAD is bound to.
        return { ok: true, value: openSecret(envelope, vaultSecret, binding) };
      } catch (cause) {
        return {
          ok: false,
          reason: cause instanceof VaultRowUnboundError ? 'binding_mismatch' : 'unreadable',
          detail: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
  },
  { rehearsalId: runId, source: target, restore: restoreUrl },
);

const report = toReport(result, {
  rehearsalId: runId,
  source: target,
  restore: restoreUrl,
  dumpPath,
});

writeFileSync(path.join(outputRoot, 'report.json'), JSON.stringify(report, null, 2));

for (const phase of report.phases) {
  console.info(
    `${phase.status.padEnd(8)} ${phase.name}${phase.detail ? ` — ${phase.detail}` : ''}`,
  );
}
for (const problem of report.problems) console.error(`problem: ${problem}`);

console.info(`Report: ${path.join(outputRoot, 'report.json')}`);
if (!report.ok) {
  console.error('Rehearsal FAILED. This migration is not cleared to merge.');
  process.exit(1);
}
console.info('Rehearsal passed. The migration is cleared; the cutover decision is still yours.');
