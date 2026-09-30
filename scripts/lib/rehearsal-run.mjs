import { summarise, verifySealedRows } from './vault-rehearsal.mjs';

/**
 * The transport half of a migration rehearsal.
 *
 * `vault-rehearsal.mjs` answers the question that decides whether a destructive
 * migration is safe — *do the ciphertexts still open?* — and answers it as a pure
 * function with the opener injected, so it is testable with no database, no key and no
 * vault. That is the half with teeth, and it is the half that already exists.
 *
 * This module is the other half: the sequence that gets a real database in front of
 * that function. `pg_dump` the source, restore it onto a clean instance, apply the
 * migrations, and then hand every sealed row in the **restore** to the verifier.
 *
 * **The migration is applied to the restore, never to the source.** D1 is "rehearse
 * before breaking", and a rehearsal that migrated the source has proved that a
 * migration can run — which is the thing you already knew, because CI applied it to an
 * empty schema yesterday. What is unknown is whether it still runs over *data*: that
 * only exists in the source, so the source is dumped and the copy is destroyed.
 *
 * Every transport is injected for the same reason the opener is: the sequence is where
 * the mistakes live, and a sequence that can only be exercised by provisioning two
 * PostgreSQL instances is a sequence that gets exercised once, carefully, by one person,
 * and then the next migration re-implements it.
 *
 * **A phase that did not run is recorded as not run.** The rehearsal that this row
 * exists to replace printed a report whose own field read `rehearsalPerformed: false`
 * under a heading that read "rehearsal passed". A report here is an array of phase
 * results, each `ok`, `failed` or `not-run`, so a reader can tell a completed run from
 * a started one without trusting the script that wrote it.
 */

/** @typedef {'ok' | 'failed' | 'not-run'} PhaseStatus */

/**
 * @typedef {object} PhaseResult
 * @property {string} name
 * @property {PhaseStatus} status
 * @property {string} [detail]
 */

/**
 * @typedef {object} RehearsalTransports
 * @property {(to: string) => Promise<string>} dump writes the source to a dump file and
 *   resolves with the path it wrote, so the caller never has to reconstruct it
 * @property {(from: string, to: string) => Promise<void>} restore loads the dump into a
 *   clean instance
 * @property {(target: string) => Promise<void>} migrate applies the migration graph to
 *   the restore
 * @property {() => Promise<Array<{ rowId: string, input: unknown }>>} fetchSealedRows
 *   every sealed row in the restore
 * @property {(row: { rowId: string, input: unknown }) => ({ ok: true, value: string } | { ok: false, reason: string, detail?: string }) | Promise<{ ok: true, value: string } | { ok: false, reason: string, detail?: string }>} open
 *   attempts one row, and must not reject. Asynchronous because opening a sealed row
 *   derives its key off the event loop (ledger Q-53); a synchronous opener is still
 *   accepted because the verifier awaits, and the rehearsal tests use one to state an
 *   outcome directly.
 */

/**
 * Run the whole sequence and report what happened at every phase.
 *
 * A phase that throws is recorded as `failed` and the run stops: continuing after a
 * failed dump would restore from nothing, and a report that says "verified 0 rows"
 * after a failed restore is a report that has confused a broken transport with an empty
 * table — the exact confusion `verifySealedRows` exists to refuse.
 *
 * @param {RehearsalTransports} transports
 * @param {Record<string, unknown>} [context] echoed into the report so a stored report
 *   says which database and which commit it was about
 * @returns {Promise<{ ok: boolean, phases: PhaseResult[], verification: Awaited<ReturnType<typeof verifySealedRows>> | null, problems: string[] }>}
 */
export async function rehearseMigration(transports, context = {}) {
  /** @type {PhaseResult[]} */
  const phases = [];
  /** @type {string[]} */
  const problems = [];

  /**
   * @param {string} name
   * @param {() => Promise<string | void>} phase
   * @returns {Promise<boolean>} whether the run may continue
   */
  const step = async (name, phase) => {
    try {
      const detail = await phase();
      phases.push({ name, status: 'ok', ...(detail ? { detail } : {}) });
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      phases.push({ name, status: 'failed', detail: message });
      problems.push(`${name} failed: ${message}`);
      return false;
    }
  };

  /** @type {string | undefined} */
  let dumpPath;
  if (
    !(await step('dump', async () => {
      dumpPath = await transports.dump(String(context.source ?? ''));
      return `source dumped to ${String(dumpPath)}`;
    }))
  ) {
    return { ok: false, phases, verification: null, problems };
  }

  if (
    !(await step('restore', async () => {
      await transports.restore(String(dumpPath), String(context.restore ?? ''));
      return 'restored onto a clean instance';
    }))
  ) {
    return { ok: false, phases, verification: null, problems };
  }

  if (
    !(await step('migrate', async () => {
      await transports.migrate(String(context.restore ?? ''));
      return 'migration graph applied to the restore';
    }))
  ) {
    return { ok: false, phases, verification: null, problems };
  }

  /** @type {Array<{ rowId: string, input: unknown }>} */
  let rows = [];
  if (
    !(await step('fetch', async () => {
      rows = await transports.fetchSealedRows();
      return `${String(rows.length)} sealed row(s) found`;
    }))
  ) {
    return { ok: false, phases, verification: null, problems };
  }

  const verification = await verifySealedRows(rows, (row) => transports.open(row));
  for (const problem of verification.problems) problems.push(problem);
  phases.push({
    name: 'verify',
    status: verification.ok ? 'ok' : 'failed',
    detail: summarise(verification),
  });

  // `verification.ok` as well as `problems`. The verifier distinguishes "every row
  // opened" from "nothing was opened", and only the first of those is a pass — so a
  // run with one unreadable row and no structural problem is still a failure, and
  // omitting this term is exactly the mistake: a rehearsal that reports success over a
  // vault it could not read is worse than no rehearsal, because it is a green one.
  return {
    ok: problems.length === 0 && verification.ok,
    phases,
    verification,
    problems,
  };
}

/**
 * The report a stored rehearsal has to carry.
 *
 * `rehearsalPerformed` is the field the previous script got wrong, and it is derived
 * here from the phases rather than asserted by the code that ran them: a run where any
 * phase is `not-run` or `failed` did not perform a rehearsal, whatever the caller
 * believes.
 *
 * @param {{ ok: boolean, phases: PhaseResult[], verification: Awaited<ReturnType<typeof verifySealedRows>> | null, problems: string[] }} result
 * @param {Record<string, unknown>} [context]
 */
export function toReport(result, context = {}) {
  const performed =
    result.phases.length > 0 && result.phases.every((phase) => phase.status === 'ok');
  return {
    ...context,
    performedPhases: result.phases.filter((phase) => phase.status === 'ok').map((p) => p.name),
    phases: result.phases,
    rehearsalPerformed: performed,
    ok: result.ok,
    verifiedRows: result.verification?.verified ?? 0,
    failures: result.verification?.failures ?? [],
    problems: result.problems,
    /**
     * Never true from a rehearsal. The whole point is evidence for a human decision, and
     * a script that could authorise its own cutover would make the rehearsal a formality.
     */
    productionCutoverAuthorized: false,
  };
}
