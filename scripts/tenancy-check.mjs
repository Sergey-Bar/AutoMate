#!/usr/bin/env node
/**
 * tenancy-check.mjs — is the tenancy boundary what the register says it is?
 *
 * `AGENTS.md` calls `WORKSPACE_ID` "the only tenancy boundary in the system".
 * That claim was restated in five places and none of them said which tables it
 * covers, which made it unenforceable: "any new workspace-scoped write needs a
 * cross-workspace isolation test" has no way to decide whether a write is
 * workspace-scoped, and "do not add a table without `workspace_id`" has no way to
 * know which tables that covers.
 *
 * `docs/quality/tenancy-scope.json` is the missing list. This script reads the
 * schema and that register and compares them.
 *
 * ## What it fails on, and why that is not a lot
 *
 * - **A table with no register row.** A new table must be classified before it
 *   ships, which is when the decision costs nothing.
 * - **A regression** — a row committing `not-null` whose column is now nullable
 *   or gone. This is the boundary weakening, and it is the whole reason the
 *   register commits the observed state and not just the classification.
 * - **A register that no longer matches the schema in either direction**, and any
 *   row missing its scope, column state, or reason.
 *
 * ## What it deliberately does not fail on
 *
 * The workspace-scoped tables without a hard `workspace_id` are real debt and are
 * reported as a count with pointers. Failing on them would make this gate
 * permanently red, and a permanently red gate is what SEM-2's 543 semgrep
 * findings taught this repository: the remedy for a noisy check is not to stop
 * running it, and a gate that is always red stops catching the regressions above.
 *
 * **The count is not written here.** An earlier version of this comment carried a
 * hand-written tally that was wrong, and `docs/quality/tenancy-scope.json` records the
 * same mistake surviving a correction once already — *"19 / 37 / 18", which was wrong in
 * every field*. The number this gate prints is recomputed from the schema and the
 * register, and `scripts/lib/tenancy-scope.test.mjs` fails if the register's own tallies
 * disagree with it. A third copy in a comment is a third copy to correct by hand, which
 * is the failure twice over.
 *
 * The debt itself is tracked in `docs/quality/findings-ledger.json` under `P-20`
 * and the migration guidance in `AGENTS.md`. This gate's job is to stop it getting
 * worse while that row is worked, not to relitigate it on every pull request.
 *
 * ## Tier
 *
 * `pr-blocking`, unlike `skill-scan`, `test:render` and `test:e2e`. It is fast,
 * dependency-free, and green against the tree as it stands — verified on
 * 2026-10-02 against all 56 declared tables. A gate that passes today and fails
 * on the next weakening is the useful kind.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { parseTableStates, auditTenancy } from './lib/tenancy-scope.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const SCHEMA_DIR = path.join(repoRoot, 'packages', 'db', 'src', 'schema');
const REGISTER_PATH = path.join(repoRoot, 'docs', 'quality', 'tenancy-scope.json');

export function main() {
  if (!existsSync(SCHEMA_DIR)) {
    console.error(`tenancy:check: no schema directory at ${SCHEMA_DIR}.`);
    return 2;
  }
  if (!existsSync(REGISTER_PATH)) {
    console.error(
      'tenancy:check: docs/quality/tenancy-scope.json is missing. Without the register there is\n' +
        'nothing to check against, and a gate with no register would pass every table it cannot\n' +
        'classify — the fail-open direction. Restore the file rather than bypassing the gate.',
    );
    return 2;
  }

  let register;
  try {
    const parsed = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'));
    const record = /** @type {Record<string, unknown>} */ (
      typeof parsed === 'object' && parsed !== null ? parsed : {}
    );
    register = /** @type {Record<string, { scope: string, column: string, reason: string }>} */ (
      typeof record.tables === 'object' && record.tables !== null ? record.tables : {}
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`tenancy:check: the register is unreadable (${detail}).`);
    return 2;
  }

  const files = readdirSync(SCHEMA_DIR).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.test.ts'),
  );
  const states = files.flatMap((file) =>
    parseTableStates(readFileSync(path.join(SCHEMA_DIR, file), 'utf8')),
  );

  const { regressions, unclassified, stale, debt } = auditTenancy(states, register);

  console.log(
    `tenancy:check: ${states.length} tables, ${Object.keys(register).length} classified.`,
  );
  console.log(`  boundary intact   ${states.length - debt.length} tables`);
  console.log(
    `  tracked debt      ${debt.length} workspace-scoped tables without a hard workspace_id`,
  );

  if (debt.length > 0) {
    console.log('');
    console.log('  Tracked debt (reported, not failing — see docs/quality/tenancy-scope.json):');
    for (const entry of debt) console.log(`    - ${entry}`);
    console.log('');
    console.log(
      '  P-20 in docs/quality/findings-ledger.json is the open row. Adding a table to this',
    );
    console.log('  list is not a regression; losing `not-null` on a row that has it is.');
  }

  if (unclassified.length === 0 && stale.length === 0 && regressions.length === 0) {
    console.log('');
    console.log(
      '  The register and the schema agree: no unclassified table, no stale row, no regression.',
    );
    return 0;
  }

  console.error('');
  if (unclassified.length > 0) {
    console.error(
      `  UNCLASSIFIED (${unclassified.length}) — a new table with no tenancy decision:`,
    );
    for (const table of unclassified) console.error(`    - ${table}`);
    console.error('    Add a row to docs/quality/tenancy-scope.json naming its scope, the column');
    console.error(
      '    state you are committing to, and the reason. A "temporarily" reason is a reason',
    );
    console.error('    that will be read as permanent.');
  }
  if (stale.length > 0) {
    console.error(`  STALE (${stale.length}) — the register no longer describes the schema:`);
    for (const entry of stale) console.error(`    - ${entry}`);
  }
  if (regressions.length > 0) {
    console.error(`  REGRESSION (${regressions.length}) — the tenancy boundary weakened:`);
    for (const entry of regressions) console.error(`    - ${entry}`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.exit(main());
}
