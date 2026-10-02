/**
 * tenancy-scope.test.mjs — the policy half of the tenancy register gate.
 *
 * The parser is tested against real declarations copied from
 * `packages/db/src/schema/*.ts`, because a parser tested only against its own
 * idea of the syntax is a parser that has never met the code. Every behavioural
 * assertion carries a control arm.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseTableStates, auditTenancy, SCOPES, COLUMN_STATES } from './tenancy-scope.mjs';

// ── The parser, against declarations copied verbatim from the schema ─────────

test('a table with a not-null workspace column is read as both present and required', () => {
  // Verbatim from `dashboard.ts` — `runners`.
  const source = `
export const runners = pgTable('runners', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: text('workspace_id')
    .notNull()
    .default('global'),
  name: text('name').notNull(),
});
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'runners', hasWorkspaceColumn: true, notNull: true },
  ]);
});

test('a bare workspace column is read as present but nullable', () => {
  // Verbatim from `dashboard.ts:197` — `runs`. This is the shape P-20 is open on.
  const source = `
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey(),
  gateStatus: text('gate_status', { enum: GATE_STATUSES }),
  workspaceId: text('workspace_id'),
  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
});
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'runs', hasWorkspaceColumn: true, notNull: false },
  ]);
});

test('a table with no workspace column is read as absent, not as nullable', () => {
  // The distinction matters: `absent` means the boundary is missing entirely,
  // `nullable` means it exists and can be bypassed. They are different defects.
  const source = `
export const trends = pgTable('trends', {
  id: uuid('id').primaryKey(),
  bucket: text('bucket').notNull(),
});
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'trends', hasWorkspaceColumn: false, notNull: false },
  ]);
});

test('a workspace column mentioned only in an index is not a column', () => {
  const source = `
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
}, (table) => [
  index('workspaces_slug_idx').on(table.workspaceId),
]);
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'workspaces', hasWorkspaceColumn: false, notNull: false },
  ]);
});

test('a commented-out workspace column is not a column', () => {
  // The control arm that matters, and the shape this codebase actually contains:
  // `dashboard.ts:511-517` carries a multi-line historical note about
  // `schedules.workspaceId` having lived only inside JSONB. A parser that reads
  // comments would find a **live** `workspaceId` on a table that lost the column
  // and report the boundary present — a false all-clear on precisely the question
  // this gate exists to answer. Note that the index-callback split does NOT catch
  // this, because the comment sits among the columns; only stripping does.
  const source = `
export const message_attachments = pgTable('message_attachments', {
  id: uuid('id').primaryKey(),
  // This table used to declare
  //   workspaceId: text('workspace_id').notNull(),
  // and the column was never added — see the tenancy wave.
  url: text('url').notNull(),
});
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'message_attachments', hasWorkspaceColumn: false, notNull: false },
  ]);
});

test('a block comment containing a declaration is not a column', () => {
  const source = `
export const suites = pgTable('suites', {
  id: uuid('id').primaryKey(),
  /*
   * workspaceId: text('workspace_id').notNull(),
   */
  name: text('name').notNull(),
});
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'suites', hasWorkspaceColumn: false, notNull: false },
  ]);
});

test('a real column after a comment is still found', () => {
  // The control arm for comment stripping in the other direction. A strip that
  // ate too much would report every commented table as unscoped, which is the
  // false-alarm version of the same bug.
  const source = `
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey(),
  // Added in 0015; used to be only inside run_options JSONB.
  workspaceId: text('workspace_id').notNull(),
  cron: text('cron'),
});
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'schedules', hasWorkspaceColumn: true, notNull: true },
  ]);
});

test('several tables in one file are all read', () => {
  const source = `
export const alpha = pgTable('alpha', { workspaceId: text('workspace_id').notNull() });
export const beta = pgTable('beta', { workspaceId: text('workspace_id') });
export const gamma = pgTable('gamma', { id: uuid('id') });
`;
  assert.deepEqual(parseTableStates(source), [
    { table: 'alpha', hasWorkspaceColumn: true, notNull: true },
    { table: 'beta', hasWorkspaceColumn: true, notNull: false },
    { table: 'gamma', hasWorkspaceColumn: false, notNull: false },
  ]);
});

test('a source with no tables yields nothing rather than throwing', () => {
  for (const source of [
    '',
    '// just a comment\nexport const x = 1;\n',
    'pgTable(',
    'pgTable(unquoted)',
  ]) {
    assert.deepEqual(parseTableStates(source), []);
  }
});

// ── The audit ────────────────────────────────────────────────────────────────

/**
 * The register shape, identity so a test can read as the rows it means.
 *
 * @param {Record<string, { scope: string, column: string, reason: string }>} rows
 * @returns {Record<string, { scope: string, column: string, reason: string }>}
 */
const register = (rows) => rows;

/**
 * One schema-side table state.
 *
 * @param {string} table
 * @param {boolean} hasWorkspaceColumn
 * @param {boolean} [notNull]
 */
const state = (table, hasWorkspaceColumn, notNull = false) => ({
  table,
  hasWorkspaceColumn,
  notNull,
});
const scoped = {
  scope: 'workspace',
  column: 'not-null',
  reason: 'Tenant-owned; cross-workspace reads are refused in a test.',
};

test('a register and a schema that agree produce no findings at all', () => {
  const outcome = auditTenancy([state('runs', true, true)], register({ runs: scoped }));
  assert.deepEqual(outcome.regressions, []);
  assert.deepEqual(outcome.unclassified, []);
  assert.deepEqual(outcome.stale, []);
  assert.deepEqual(outcome.debt, []);
});

test('a new table with no register row is unclassified, and that blocks', () => {
  const outcome = auditTenancy([state('brand_new', true, true)], register({}));
  assert.deepEqual(outcome.unclassified, ['brand_new']);
});

test('a workspace-scoped table losing its not-null is a regression, and that blocks', () => {
  // The whole reason the register commits the observed state. If it committed only
  // the classification, this change would be invisible until a tenant's row was read
  // by another tenant — which is the defect the entire tenancy wave existed to close.
  const outcome = auditTenancy([state('runs', true, false)], register({ runs: scoped }));
  assert.equal(outcome.regressions.length, 1);
  assert.match(outcome.regressions[0], /runs/);
  assert.match(outcome.regressions[0], /weakened/);
});

test('a workspace-scoped table losing the column entirely is a regression', () => {
  const outcome = auditTenancy([state('runs', false)], register({ runs: scoped }));
  assert.equal(outcome.regressions.length, 1);
  assert.match(outcome.regressions[0], /weakened/);
});

test('a schema that improves past its register row is drift, not a pass', () => {
  // `absent` → `not-null` is good news, but a register that is wrong in the
  // flattering direction is still wrong. Allowing it would let the register drift
  // silently until it described a schema that no longer exists.
  const outcome = auditTenancy(
    [state('runs', true, true)],
    register({ runs: { scope: 'workspace', column: 'absent', reason: 'tracked in P-20' } }),
  );
  assert.equal(outcome.stale.length, 1);
  assert.match(outcome.stale[0], /improved past the register/);
});

test('tracked debt is reported and does not fail', () => {
  // The anti-permanently-red property. A workspace-scoped table without a hard
  // boundary is real debt and is counted; it must not be the reason the gate is
  // red, or the gate gets ignored and stops catching the regressions above.
  const outcome = auditTenancy(
    [state('trends', false), state('audit_events', true, false)],
    register({
      trends: { scope: 'workspace', column: 'absent', reason: 'No workspace_id. Tracked as P-20.' },
      audit_events: {
        scope: 'workspace',
        column: 'nullable',
        reason: 'Nullable workspace_id. Tracked as P-20.',
      },
    }),
  );
  assert.equal(outcome.regressions.length, 0);
  assert.equal(outcome.stale.length, 0);
  assert.equal(outcome.debt.length, 2);
});

test('a global table carrying a workspace column is not a finding', () => {
  // `installations` is the tenancy root; a workspace column on it would be a
  // self-reference, and this gate has no business ruling on it.
  const outcome = auditTenancy(
    [state('installations', true, true)],
    register({
      installations: { scope: 'global', column: 'not-null', reason: 'The tenancy root.' },
    }),
  );
  assert.deepEqual(outcome.regressions, []);
  assert.deepEqual(outcome.debt, []);
});

test('a register row with no reason is drift', () => {
  // A classification nobody can question is a classification nobody trusts — the
  // same 20-character rationale floor `scripts/review/ruleset.mjs` enforces on
  // review rules, for the same reason.
  const outcome = auditTenancy(
    [state('runs', true, true)],
    register({ runs: { scope: 'workspace', column: 'not-null', reason: '  ' } }),
  );
  assert.equal(outcome.stale.length, 1);
  assert.match(outcome.stale[0], /no reason/);
});

test('an unknown scope or column state is drift, not a silent pass', () => {
  const bad = auditTenancy(
    [state('runs', true, true)],
    register({ runs: { scope: 'tenant', column: 'not-null', reason: 'x'.repeat(30) } }),
  );
  assert.match(bad.stale[0], /scope/);
  const alsoBad = auditTenancy(
    [state('runs', true, true)],
    register({ runs: { scope: 'workspace', column: 'maybe', reason: 'x'.repeat(30) } }),
  );
  assert.match(alsoBad.stale[0], /column/);
});

test('the vocabularies are the ones the register validates against', () => {
  assert.deepEqual(SCOPES, ['workspace', 'global']);
  assert.deepEqual(COLUMN_STATES, ['not-null', 'nullable', 'absent']);
});

// ── The committed register ───────────────────────────────────────────────────

test('the register tally is derived from the schema, not asserted from memory', async () => {
  // The first version of this file carried a hand-written tally of 19 / 37 / 18 and
  // every field was wrong. Six numbers in a document that nothing recomputes are a
  // claim, and a claim is not evidence — the same defect as the rule this register
  // exists to end. So the six are recomputed here from the schema and the register,
  // and a mismatch fails.
  const { readFileSync, readdirSync } = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');

  const schemaDir = path.join(root, 'packages', 'db', 'src', 'schema');
  const declared = readdirSync(schemaDir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) => parseTableStates(readFileSync(path.join(schemaDir, file), 'utf8')));

  const parsed = JSON.parse(
    readFileSync(path.join(root, 'docs', 'quality', 'tenancy-scope.json'), 'utf8'),
  );
  const register = parsed.tables;
  const workspace = Object.entries(register).filter(([, row]) => row.scope === 'workspace');

  const computed = {
    total: declared.length,
    global: Object.keys(register).length - workspace.length,
    workspaceScoped: workspace.length,
    workspaceScopedWithHardBoundary: workspace.filter(([, row]) => row.column === 'not-null')
      .length,
    workspaceScopedNullable: workspace.filter(([, row]) => row.column === 'nullable').length,
    workspaceScopedAbsent: workspace.filter(([, row]) => row.column === 'absent').length,
  };

  for (const [key, value] of Object.entries(computed)) {
    assert.equal(
      parsed.tally[key],
      value,
      `docs/quality/tenancy-scope.json tally.${key} says ${parsed.tally[key]}, the tree says ${value}`,
    );
  }

  // The three workspace buckets must account for every workspace table, so a row
  // added with an unknown column state cannot pass by inflating the total.
  assert.equal(
    computed.workspaceScopedWithHardBoundary +
      computed.workspaceScopedNullable +
      computed.workspaceScopedAbsent,
    computed.workspaceScoped,
    'the workspace column-state buckets do not sum to the workspace total',
  );
});

test('the committed register classifies every table the schema declares', async () => {
  // The single assertion that matters. A new table shipping without a row is how
  // the boundary erodes one migration at a time — which is what the tenancy wave
  // already had to fix five times.
  const { readFileSync, readdirSync } = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(import.meta.dirname, '..', '..');

  const schemaDir = path.join(root, 'packages', 'db', 'src', 'schema');
  const declared = readdirSync(schemaDir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((file) => parseTableStates(readFileSync(path.join(schemaDir, file), 'utf8')));

  const parsed = JSON.parse(
    readFileSync(path.join(root, 'docs', 'quality', 'tenancy-scope.json'), 'utf8'),
  );
  /** @type {Record<string, { scope: string, column: string, reason: string }>} */
  const register = parsed.tables;

  const missing = declared
    .map((table) => table.table)
    .filter((table) => register[table] === undefined);
  assert.deepEqual(missing, [], `tables with no tenancy classification: ${missing.join(', ')}`);

  const outcome = auditTenancy(declared, register);
  assert.deepEqual(outcome.unclassified, []);
  assert.deepEqual(outcome.regressions, [], 'the register and the schema disagree on a boundary');
  assert.deepEqual(outcome.stale, [], 'the register is stale against the schema');
});
