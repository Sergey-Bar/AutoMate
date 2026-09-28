/**
 * The verification half of a migration rehearsal.
 *
 * D1 is "rehearse before breaking": a destructive migration does not merge until a
 * rehearsal has restored a post-migration database **and re-opened every encrypted row**.
 * W7 is roughly ten irreversible tenancy migrations against live data, so D1 is the gate
 * standing in front of the largest irreversible work in the programme — and there is no
 * harness to run it. `pnpm smoke:rehearsal` is not that harness: it calls
 * `assertLocalRehearsal` and writes a report whose own field reads
 * `rehearsalPerformed: false` (ledger RF-5).
 *
 * **This is the second half, and the half that has teeth.** A dump/restore proves the
 * database came back; it does not prove the *ciphertexts are still readable*, which is
 * the property a migration can silently destroy. Renaming a column the AAD is bound to,
 * changing a type that truncates, or re-sealing under a different key all leave a
 * restored database that looks perfect and holds nothing anyone can read. P-8 is the
 * shape of that failure in the other direction: the ciphertext was readable and belonged
 * to the wrong row, so nothing looked broken at all.
 *
 * Three properties, and they are why this is a function rather than a loop in a script:
 *
 *  - **Every row is attempted.** Stopping at the first failure reports one broken row
 *    and hides the other four, and an operator who fixes the first and re-runs then
 *    discovers the second, one migration at a time.
 *  - **A run that verified nothing is a failure, not a pass.** Zero rows means either a
 *    genuinely empty table or a query that matched the wrong shape. The distinction is
 *    invisible from the outside, so it is refused here rather than assumed — the same
 *    rule the repo already applies to a coverage baseline and a command that produced no
 *    report.
 *  - **Failures are classified, not concatenated.** "The key did not match" and "the
 *    ciphertext is corrupt" need different responses — one is a re-key, the other is a
 *    restore from backup — and a single list of identical-looking errors cannot tell an
 *    operator which they have.
 *
 * The opener is injected rather than imported, so this is testable without a database,
 * an encryption key, or a vault.
 */

/** Why a row could not be opened. The classes are the operator's decision points. */
export const FailureReason = {
  /** The row's identity no longer matches what the ciphertext was bound to. */
  BINDING_MISMATCH: 'binding_mismatch',
  /** The bytes are wrong, or the key is. Restoring from backup is the only recovery. */
  UNREADABLE: 'unreadable',
  /** The row could not even be read from the database. */
  UNREAD: 'unread',
};

const REASON_ADVICE = {
  [FailureReason.BINDING_MISMATCH]:
    'the row identity changed, so the ciphertext no longer belongs to it. Check for a ' +
    'renamed or re-typed column in this migration, and for a row whose workspace or ' +
    'entry id was edited after it was sealed.',
  [FailureReason.UNREADABLE]:
    'the bytes or the key are wrong. No migration can repair this; restore the row from ' +
    'backup and confirm the vault secret has not rotated.',
  [FailureReason.UNREAD]:
    'the row could not be read at all, which points at the query or the column type ' +
    'rather than at the encryption.',
};

/**
 * What a caller reports for one row.
 *
 * `ok: true` carries the plaintext so the caller can assert something about it — a
 * rehearsal that only checks "it decrypted" proves the key still works, not that the
 * value is the one that was stored.
 */
/**
 * What a caller reports for one row.
 *
 * `ok: true` carries the plaintext so the caller can assert something about it — a
 * rehearsal that only checks "it decrypted" proves the key still works, not that the
 * value is the one that was stored.
 *
 * @typedef {{ ok: true, value: string }
 *   | { ok: false, reason: string, detail?: string }} OpenOutcome
 */

/**
 * One row to verify.
 *
 * @typedef {object} SealedRow
 * @property {string} rowId a stable identifier for the report — the row's primary key
 * @property {unknown} input whatever the opener needs: the envelope and the row identity
 */

/**
 * One row that failed, classified.
 *
 * @typedef {object} RowFailure
 * @property {string} rowId
 * @property {string} reason
 * @property {string} [detail]
 * @property {string} advice
 */

/**
 * Open every sealed row and report every one that could not be opened.
 *
 * @param {ReadonlyArray<SealedRow>} rows every row to verify — completeness is the
 *   caller's responsibility and this function's `verified` count is the evidence that it
 *   was met
 * @param {(row: SealedRow) => OpenOutcome} open attempts one row and reports the
 *   outcome; must not throw
 * @returns {{ verified: number, failures: RowFailure[], ok: boolean, problems: string[] }}
 *   the tally, the classified failures, and whether the run may pass
 */
export function verifySealedRows(rows, open) {
  /** @type {RowFailure[]} */
  const failures = [];
  let verified = 0;

  for (const row of rows) {
    /** @type {OpenOutcome} */
    let outcome;
    try {
      outcome = open(row);
    } catch (cause) {
      // An opener that throws is a broken opener, not a broken row, and the two must
      // not be conflated: a thrown error on the first row would otherwise look like one
      // unreadable row rather than a harness that cannot do its job.
      outcome = {
        ok: false,
        reason: FailureReason.UNREADABLE,
        detail: `the opener threw: ${cause instanceof Error ? cause.message : String(cause)}`,
      };
    }

    if (outcome.ok) {
      verified += 1;
      continue;
    }

    failures.push({
      rowId: row.rowId,
      reason: outcome.reason,
      ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
      advice: REASON_ADVICE[outcome.reason],
    });
  }

  /** @type {string[]} */
  const problems = [];

  if (rows.length === 0) {
    // Refused rather than passed. A rehearsal over no rows is either an empty table or
    // a query that matched nothing, and the two are indistinguishable from here — and
    // the second is exactly the state in which a destructive migration would be declared
    // safe and then destroy data nobody was watching.
    problems.push(
      'no rows were verified. An empty table and a query that matched nothing look ' +
        'identical from here, and declaring a destructive migration safe on the strength ' +
        'of a rehearsal that opened nothing is the failure this check exists to prevent.',
    );
  }

  if (verified === 0 && rows.length > 0) {
    problems.push(
      'no row could be opened, so the vault key is the first thing to check — a rotated ' +
        'secret fails every row identically and is a different problem from a ' +
        'migration that broke the binding.',
    );
  }

  return { verified, failures, ok: problems.length === 0 && failures.length === 0, problems };
}

/**
 * A one-line summary, for a log or a CI step.
 *
 * @param {{ verified: number, failures: RowFailure[], problems: string[] }} result the
 *   outcome of {@link verifySealedRows}
 * @returns {string} a human-readable line naming the counts
 */
export function summarise(result) {
  const parts = [`${String(result.verified)} row(s) opened`];
  if (result.failures.length > 0) parts.push(`${String(result.failures.length)} failed`);
  for (const problem of result.problems) parts.push(problem);
  return parts.join('; ');
}
