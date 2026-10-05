import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertLocalRehearsal } from './lib/local-rehearsal-guard.mjs';
import { runClient } from './lib/rehearsal-client.mjs';
import { SEALED_ROWS_SQL as REHEARSAL_ROWS_SQL, parseSealedRows } from './lib/rehearsal-rows.mjs';
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
 * `spawnSync`, adapted to what `runClient` asks of it.
 *
 * The adapter is three lines and exists for a typing reason with a real consequence behind it:
 * `spawnSync`'s return type is generic over the encoding, so with `encoding: 'utf8'` its
 * `stdout` is a `string` and without it a `Buffer`. Handing the raw function to a parameter
 * typed as "returns text" is a type error, and the fix people reach for is a cast — which would
 * leave a `Buffer` concatenated into a report as `<Buffer 3c 45 52…>`. Converting here means
 * the report always holds the text the operator saw.
 *
 * @type {import('./lib/rehearsal-client.mjs').SpawnLike}
 */
const spawnText = (command, args, options) => {
  const result = spawnSync(command, [...args], { ...options, encoding: 'utf8' });
  return {
    ...(result.error === undefined ? {} : { error: result.error }),
    status: result.status,
    stdout: result.stdout === null ? '' : String(result.stdout),
    stderr: result.stderr === null ? '' : String(result.stderr),
  };
};

/**
 * Run a PostgreSQL client.
 *
 * `runClient` re-emits the child's output to the terminal **and** puts it in the thrown error,
 * which is what the phase detail is built from. `stdio: 'inherit'` would have shown the
 * operator everything and recorded nothing: the run against a restore carrying two unattributed
 * credentials printed `0020_connector_credentials_tenant.sql`'s own refusal to the console and
 * wrote `node exited 1` into `report.json`, which is the artefact the whole command exists to
 * leave behind.
 *
 * @param {string} command
 * @param {readonly string[]} args
 * @param {Record<string, string>} [extraEnv]
 */
function run(command, args, extraEnv) {
  runClient({
    spawn: spawnText,
    command,
    args,
    env,
    ...(extraEnv === undefined ? {} : { spawnOptions: { env: { ...env, ...extraEnv } } }),
  });
}

/**
 * The vault module, as this script uses it.
 *
 * Declared rather than inferred, because the runtime import below is a **computed**
 * path. `tsc` follows a string literal in `import()` and reports `TS2307` when the target
 * is a build artefact that has not been built — which is every CI machine and every
 * fresh checkout, and is why `pnpm typecheck:scripts` was red on `main` through five
 * consecutive commits. Computing the specifier is what makes it a runtime path, and this
 * typedef is what puts the checking back: the signature is the product's, written out
 * rather than inferred, so a change to `openSecret` is a change here too.
 *
 * A rehearsal that opened rows with a second implementation of the decryption would
 * prove the second implementation still works, so the module is loaded from the product's
 * own build — `pnpm build` is a prerequisite, and a missing build says so rather than
 * failing as an unreadable vault.
 *
 * @typedef {object} VaultModule
 * @property {(
 *   envelope: import('../apps/api/src/infrastructure/vault-crypto.js').VaultEnvelope,
 *   secret: string,
 *   binding: import('../apps/api/src/infrastructure/vault-crypto.js').VaultRowBinding,
 * ) => Promise<string>} openSecret
 * @property {new (entryId: string) => Error} VaultRowUnboundError
 */

/**
 * The built module's specifier.
 *
 * `pathToFileURL` rather than `new URL(..., import.meta.url)`, because URL is not a
 * declared global for the lint rules this file is checked against and a bare 
ew URL failed
 * `no-undef`. The path is still resolved against this file rather than the working
 * directory, so the rehearsal works from any cwd.
 */
const VAULT_MODULE = pathToFileURL(
  path.resolve(import.meta.dirname, '../apps/api/dist/infrastructure/vault-crypto.js'),
).href;

/** @type {VaultModule} */
const { openSecret, VaultRowUnboundError } = await import(VAULT_MODULE).catch((cause) => {
  throw new Error(
    'The vault module could not be loaded from apps/api/dist, so nothing here could prove a ' +
      `row is readable. Run "pnpm build" first. (${String(cause)})`,
  );
});

/**
 * Every sealed row, read through `psql` so this script needs no database driver.
 *
 * The query and the parser both live in `scripts/lib/rehearsal-rows.mjs`, which is a tested
 * pure function over `psql`'s stdout. That is not tidiness: the reader used to be inline here,
 * and the first real run of this command found that `--field-separator=` had set the
 * separator to *empty*, so the `split('|')` beside it never matched and every field of every
 * row came back `undefined`. The run reported three rows found and zero opened on an intact
 * vault and advised checking the vault key — a gate crying wolf, which is worse than a gate
 * that says nothing.
 *
 * `iterations` is carried but not used by the opener: `keyFor` derives at the cost the
 * product derives at, and a rehearsal that honoured a per-row iteration count would be
 * testing a decryption path nothing else uses. It is selected anyway so a migration that
 * narrows or drops the column is visible here rather than at the first production read.
 */
const SEALED_ROWS_SQL = REHEARSAL_ROWS_SQL;

/**
 * One sealed row as `psql` returns it, beside the shapes the product's own vault module
 * uses.
 *
 * The two `import()` types resolve to **`src/`, not `dist/`**. A type is a property of
 * the source and the source is always present; the build artefact is not, which is the
 * other half of the fix described on `VaultModule` above.
 *
 * @typedef {object} SealedInput
 * @property {import('../apps/api/src/infrastructure/vault-crypto.js').VaultEnvelope} envelope
 * @property {import('../apps/api/src/infrastructure/vault-crypto.js').VaultRowBinding} binding
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
        ['--dbname', restoreUrl, '--tuples-only', '--no-align', '--command', SEALED_ROWS_SQL],
        { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
      );
      if (out.error) throw new Error(`psql: ${out.error.message}`);
      if (out.status !== 0) throw new Error(`psql exited ${String(out.status)}`);
      // Parsed by `parseSealedRows`, which is a tested pure function. It was inline here
      // until the first real run of this command (2026-10-04) reported three rows found and
      // zero opened on an intact vault, because `--field-separator=` set the separator to
      // *empty* and the `split('|')` that followed it never matched. See
      // `scripts/lib/rehearsal-rows.mjs`.
      return parseSealedRows(out.stdout);
    },
    open: async (row) => {
      // The port's `input` is `unknown` because the verifier is generic over it; here it
      // is always what `parseSealedRows` built, so it is narrowed once rather than
      // re-checked on every row.
      const { envelope, binding } = /** @type {SealedInput} */ (row.input);
      try {
        // The binding is passed, not reconstructed: `openSecret` folds the row identity
        // into the tag check, which is exactly what detects a migration that renamed or
        // re-typed a column the AAD is bound to.
        //
        // Awaited because the key derivation is off the event loop (ledger Q-53) and
        // this verifier is sequential — which is right: the rehearsal exists to fail
        // on the *first* sealed row that will not open, and a rejected promise inside
        // a `try` would escape the `catch` and abort the run with an unhandled
        // rejection instead of a recorded `unreadable` row.
        return { ok: true, value: await openSecret(envelope, vaultSecret, binding) };
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
