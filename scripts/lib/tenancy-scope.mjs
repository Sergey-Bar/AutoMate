/**
 * tenancy-scope.mjs — the tenancy boundary, as a checkable claim.
 *
 * ## Why this module exists
 *
 * `AGENTS.md` states that "`WORKSPACE_ID` is the only tenancy boundary in the
 * system" and that "any new workspace-scoped read or write needs a
 * cross-workspace isolation test". That rule has been restated in five places —
 * AGENTS.md, three of the `.kilo/agent/` personas, the `evidence-test` skill, and
 * roughly forty rows of the findings ledger — and **none of them says which
 * tables are workspace-scoped.**
 *
 * Without that list the rule is unenforceable in both directions. "Any new
 * workspace-scoped write needs a test" cannot be evaluated, because nothing
 * decides whether a given write *is* workspace-scoped. And "do not add a table
 * without `workspace_id`" cannot be applied, because no one can tell which of the
 * 56 tables that rule is supposed to cover.
 *
 * This is the same shape as `P-6`'s three startup-policy authorities and `P-5`'s
 * two disagreeing `gate_status` lists: a value duplicated into prose until the
 * copies drift and nothing notices. The remedy recorded for both was structural —
 * one source, derived rather than restated. So the classification lives in
 * `docs/quality/tenancy-scope.json`, one row per table, and this module decides
 * whether the schema agrees with it.
 *
 * ## The ratchet, not the red gate
 *
 * The schema has a real and large tenancy debt today, and most of it is recorded
 * rather than unknown. A gate that failed on the existing debt would be
 * permanently red — which is what SEM-2's 543 semgrep findings taught this
 * repository: the remedy for a noisy check is not to stop running it.
 *
 * So the register commits **both** the design decision (`scope`) and the observed
 * state (`column`), and the gate blocks on exactly two things:
 *
 * 1. **A table with no register row.** A new table must be classified before it
 *    ships, which is the moment the decision is cheap.
 * 2. **A regression** — a table whose register row says `not-null` and whose
 *    schema column is now nullable or gone. This is the boundary weakening, and
 *    it is the whole reason the register commits the observed state.
 *
 * The debt — workspace-scoped tables without a column — is reported as a count
 * with pointers, and each register row carries a `reason` naming where the debt
 * is tracked. It does not fail, because failing on it would not tell anyone
 * anything they do not already have from the ledger.
 */

/** What a table holds, in design terms. */
export const SCOPES = ['workspace', 'global'];

/** The column state a register row commits to. */
export const COLUMN_STATES = ['not-null', 'nullable', 'absent'];

/**
 * Remove comments from a schema source before parsing it.
 *
 * **This is not cosmetic, and the reason is this codebase specifically.** The
 * schema files carry long historical notes beside the columns they changed — the
 * comment at `dashboard.ts:511-517` explains that `schedules.workspaceId` used to
 * exist only inside `run_options->'request'`, and migration notes are written out
 * inline. A parser that does not strip comments will read a **commented-out**
 * `workspaceId: text('workspace_id').notNull()` as a live column and conclude the
 * boundary is present on a table that lost it — a false all-clear on the exact
 * question this gate exists to answer.
 *
 * The control arm is in the test file, and it fails without this function.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Read the table declarations out of one schema source file.
 *
 * The parse is deliberately narrow and is the kind that fails loudly rather than
 * quietly: Drizzle declares `workspace_id` in one shape in this codebase —
 * `text('workspace_id')`, then `.notNull()` if it is required, then optionally
 * `.references(() => workspaces.id, …)` — and the tests below pin that. `.notNull()`
 * must come first, which is how every declaration since MNT-17 is written. If someone
 * introduces a second shape, the declaration stops matching or reads as nullable, and the
 * gate reports a regression — which is the correct outcome for a parser that has met
 * something it does not understand.
 *
 * @param {string} raw the text of one `packages/db/src/schema/*.ts` file
 * @returns {Array<{ table: string, hasWorkspaceColumn: boolean, notNull: boolean }>}
 */
export function parseTableStates(raw) {
  const source = stripComments(raw);
  // Only the column head, with no greedy continuation — see the note at the call site.
  const COLUMN_HEAD = /workspaceId:\s*text\(\s*'workspace_id'\s*\)/;

  /** @type {Array<{ table: string, hasWorkspaceColumn: boolean, notNull: boolean }>} */
  const tables = [];

  // Each `pgTable('name', { … })` opens a declaration. Splitting on it is safe
  // because the call is not nested and is always the top-level constructor.
  const parts = source.split('pgTable(').slice(1);
  for (const part of parts) {
    const nameMatch = part.match(/['"]([a-z_][a-z0-9_]*)['"]/);
    if (nameMatch === null) continue;

    // The body runs until the index callback, which is where column declarations
    // stop. Taking a bounded window is enough because `workspaceId` is always
    // declared among the columns, which come first.
    const body = part.slice(0, 20000);
    const columnBlock = body.split(/\n\s*\(?\w*\)?\s*=>\s*\[/)[0] ?? body;

    const declaration = COLUMN_HEAD.exec(columnBlock);
    // The modifier chain, bounded by the next comma. Bounded rather than matched by
    // a greedy continuation because a continuation over `[^,\n]` backtracks. The first
    // comma after `.notNull()` is inside `.references(() => workspaces.id, …)` when there
    // is one, so the chain still contains `.notNull()`; a `.references()` written
    // *before* `.notNull()` would put the comma first and read as nullable, and the gate
    // reports a regression — which is the outcome a parser meeting something it does not
    // understand should have.
    const after =
      declaration === null
        ? ''
        : columnBlock.slice(
            declaration.index + declaration[0].length,
            declaration.index + declaration[0].length + 64,
          );
    const comma = after.indexOf(',');
    const chain = comma === -1 ? after : after.slice(0, comma);

    tables.push({
      table: nameMatch[1],
      hasWorkspaceColumn: declaration !== null,
      notNull: chain.includes('.notNull()'),
    });
  }

  return tables;
}

/**
 * What the schema actually has for a table's workspace column.
 *
 * @param {{ hasWorkspaceColumn: boolean, notNull: boolean }} state
 * @returns {'absent' | 'not-null' | 'nullable'}
 */
function observedColumnState(state) {
  if (!state.hasWorkspaceColumn) return 'absent';
  return state.notNull ? 'not-null' : 'nullable';
}

/**
 * Why a register row cannot be judged at all (an unknown scope or column state, or no reason),
 * or null when it is well formed.
 *
 * @param {string} table
 * @param {{ scope: string, column: string, reason: string }} row
 * @returns {string | null}
 */
function malformedRowMessage(table, row) {
  if (row.scope !== 'workspace' && row.scope !== 'global') {
    return `${table}: register says scope "${String(row.scope)}", which is not one of ${SCOPES.join(' / ')}`;
  }
  if (!COLUMN_STATES.includes(row.column)) {
    return `${table}: register says column "${String(row.column)}", which is not one of ${COLUMN_STATES.join(' / ')}`;
  }
  if (typeof row.reason !== 'string' || row.reason.trim() === '') {
    return `${table}: register row carries no reason, so a reader cannot judge the classification`;
  }
  return null;
}

/**
 * Both directions are drift. Dropping `notNull` is a regression that blocks; gaining it is an
 * improvement the register has not caught up with, which also blocks - a register that is wrong
 * in the flattering direction is still wrong, and letting it drift is how it becomes decorative.
 *
 * @param {string} table
 * @param {string} committed
 * @param {string} observed
 * @returns {{ weakening: boolean, message: string }}
 */
function columnDrift(table, committed, observed) {
  const weakening = committed === 'not-null' && observed !== 'not-null';
  const message =
    `${table}: register commits column "${committed}" and the schema has "${observed}"` +
    (weakening
      ? ' \u2014 the tenancy boundary weakened'
      : ' \u2014 the schema improved past the register');
  return { weakening, message };
}
/**
 * What one classified table contributes to the audit, if anything.
 *
 * @param {{ table: string, hasWorkspaceColumn: boolean, notNull: boolean }} state
 * @param {{ scope: string, column: string, reason: string }} row
 * @returns {{ bucket: 'regressions' | 'stale' | 'debt', message: string } | null}
 */
function auditRow(state, row) {
  const malformed = malformedRowMessage(state.table, row);
  if (malformed !== null) return { bucket: 'stale', message: malformed };

  const observed = observedColumnState(state);
  if (row.column !== observed) {
    const drift = columnDrift(state.table, row.column, observed);
    return { bucket: drift.weakening ? 'regressions' : 'stale', message: drift.message };
  }

  // Committed state matches. If the table is meant to be workspace-scoped and is
  // not yet carrying a hard boundary, that is the tracked debt.
  if (row.scope === 'workspace' && observed !== 'not-null') {
    return { bucket: 'debt', message: `${state.table}: workspace-scoped, column ${observed}` };
  }
  return null;
}
/**
 * Compare the schema against the register.
 *
 * @param {Array<{ table: string, hasWorkspaceColumn: boolean, notNull: boolean }>} states
 *   every table read from the schema
 * @param {Record<string, { scope: string, column: string, reason: string }>} register
 *   keyed by table name, read from `docs/quality/tenancy-scope.json`
 * @returns {{ regressions: string[], unclassified: string[], stale: string[], debt: string[] }}
 */
export function auditTenancy(states, register) {
  /** @type {string[]} */
  const regressions = [];
  /** @type {string[]} */
  const unclassified = [];
  /** @type {string[]} */
  const stale = [];
  /** @type {string[]} */
  const debt = [];
  const buckets = { regressions, stale, debt };

  for (const state of states) {
    const row = register[state.table];
    if (row === undefined) {
      unclassified.push(state.table);
      continue;
    }
    const finding = auditRow(state, row);
    if (finding === null) continue;
    buckets[finding.bucket].push(finding.message);
  }
  return { regressions, unclassified, stale, debt };
}
