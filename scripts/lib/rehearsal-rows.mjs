/**
 * Reading sealed rows out of a restore, for `pnpm migrate:rehearse`.
 *
 * **The server encodes the row; this module does not invent a delimiter.** The command used
 * to run `psql --field-separator=` — an *empty* separator — and then `line.split('|')`, so the
 * split never matched and every field came back `undefined` with the whole line as `rowId`.
 * The first real run of the rehearsal (2026-10-04, ledger `RF-5`) consequently reported three
 * rows found and zero opened on an intact vault, and advised checking the vault key. The
 * guard that stops a run which verified nothing from reporting success did hold; the
 * diagnosis did not, and a healthy migration would have been called a destroyed vault.
 *
 * `json_build_object` removes the whole class of bug rather than this instance of it: Postgres
 * escapes whatever the columns contain — a pipe, a newline, a quote, a backslash — and emits
 * one line per row, so there is no delimiter to get wrong and no ordering to guess at. The
 * alternative, a delimiter chosen to be absent from base64, is still a separator and still
 * wrong for the one column whose contents nobody controls.
 */

/**
 * The query, and the encoding is the point of it.
 *
 * `::text` rather than letting `json_build_object` pick a representation, so the output is
 * one JSON object per line with no header and no padding — which is what makes the
 * line-based reader sound.
 *
 * `ORDER BY id` because the report lists rows in this order and a rehearsal that reported the
 * same rows in a different order on two runs would be harder to read for no benefit.
 */
export const SEALED_ROWS_SQL = `SELECT json_build_object(
  'id', id,
  'workspaceId', workspace_id,
  'name', connector_name,
  'ciphertext', ciphertext,
  'iv', iv,
  'authTag', auth_tag,
  'salt', salt,
  'iterations', iterations
)::text
FROM vault_entries
ORDER BY id;`;

/**
 * One sealed row as the verifier's port wants it.
 *
 * @typedef {object} SealedRow
 * @property {string} rowId
 * @property {{
 *   envelope: import('../../apps/api/src/infrastructure/vault-crypto.js').VaultEnvelope,
 *   binding: import('../../apps/api/src/infrastructure/vault-crypto.js').VaultRowBinding,
 * }} input
 */

/**
 * One row as `json_build_object` returns it.
 *
 * @typedef {object} EncodedRow
 * @property {string} id
 * @property {string} workspaceId
 * @property {string} name
 * @property {string} ciphertext
 * @property {string} iv
 * @property {string} authTag
 * @property {string} salt
 * @property {number} iterations
 */

/**
 * `psql`'s stdout into the rows the verifier opens.
 *
 * **Throwing on a line it cannot read is deliberate.** The alternative — skipping it —
 * produces a rehearsal that reports fewer rows than exist and calls that a pass, which is the
 * same failure as the one this module was written to fix: a report that is green over data it
 * never looked at.
 *
 * @param {string} stdout
 * @returns {SealedRow[]}
 */
export function parseSealedRows(stdout) {
  return stdout
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => decodeRow(line));
}

/**
 * One field of an encoded row, or a failure naming the row.
 *
 * Narrowing in one place rather than a bare `!== undefined` per field: the check has to be
 * *and* a type narrowing for `tsconfig.scripts.json` to accept the result, and a check that
 * narrows nothing is a check the compiler cannot see.
 *
 * @param {Record<string, string | number | undefined>} parsed
 * @param {string} field
 * @param {string} line
 * @returns {string}
 */
function text(parsed, field, line) {
  const value = parsed[field];
  if (typeof value !== 'string' || value === '') {
    throw new Error(
      `a sealed row is missing "${field}", so it cannot be opened or reported honestly: ${line}`,
    );
  }
  return value;
}

/**
 * @param {Record<string, string | number | undefined>} parsed
 * @param {string} field
 * @param {string} line
 * @returns {number}
 */
function count(parsed, field, line) {
  const value = parsed[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(
      `a sealed row has a non-numeric "${field}", so it cannot be reported honestly: ${line}`,
    );
  }
  return value;
}

/**
 * @param {string} line
 * @returns {SealedRow}
 */
function decodeRow(line) {
  const parsed = parseObject(line);
  const id = text(parsed, 'id', line);
  const workspaceId = text(parsed, 'workspaceId', line);
  const name = text(parsed, 'name', line);
  // Selected and checked, then **not** carried into the envelope. `VaultEnvelope` has no
  // `iterations` field, because `keyFor` derives at a hardcoded cost rather than at whatever
  // the row records — so an envelope carrying one would be an object lying about its own
  // shape, and the old reader smuggled exactly that in behind a cast. Reading it here is
  // still the point: a migration that narrows or drops the column now fails loudly at this
  // line rather than at the first production read, which is the property the selection was
  // for.
  count(parsed, 'iterations', line);

  return {
    rowId: id,
    input: {
      envelope: {
        // Stated rather than read, because there is no `version` column: everything in
        // `vault_entries` is a bound envelope, since `0020_connector_credentials_tenant.sql`
        // moved the table to `(workspace_id, connector_name)` and the repair tool re-sealed
        // what it found. `openLegacySecret` remains the path for a v1 row, and the rehearsal
        // reports that as `binding_mismatch` — a rehearsal must not call unbound data safe.
        version: 2,
        algorithm: 'aes-256-gcm',
        keyVersion: 1,
        ciphertext: text(parsed, 'ciphertext', line),
        iv: text(parsed, 'iv', line),
        tag: text(parsed, 'authTag', line),
        salt: text(parsed, 'salt', line),
      },
      binding: { entryId: id, workspaceId, name },
    },
  };
}

/**
 * `JSON.parse`, with the failure naming the line.
 *
 * @param {string} line
 * @returns {Record<string, string | number | undefined>}
 */
function parseObject(line) {
  try {
    return JSON.parse(line);
  } catch (cause) {
    throw new Error(
      `psql returned a line that is not the JSON object the query asked for, so the row ` +
        `cannot be read: ${line} (${String(cause)})`,
    );
  }
}
