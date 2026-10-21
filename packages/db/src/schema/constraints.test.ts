import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { getTableName, is } from 'drizzle-orm';
import { getTableConfig, IndexedColumn, PgTable } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from './index.js';
import {
  artifacts,
  environments,
  executionJobs,
  gateEvaluations,
  qualityPolicies,
  releases,
  runEvents,
} from './execution.js';

/**
 * The TypeScript schema against the migration graph it claims to describe.
 *
 * Every `.references(() => ...)` callback and every table-config callback in
 * `src/schema` is evaluated here through `getTableConfig`, and the result is
 * compared with what the journal-ordered migrations actually create in an
 * in-process PostgreSQL. A foreign key whose `onDelete` was edited in
 * TypeScript without a migration, an index renamed on one side only, or a
 * check constraint that exists only in a comment are each a failure here, and none of them is something `drizzle-kit check` looks at, because that
 * only checks the journal against itself.
 */

const drizzleDirectory = new URL('../../drizzle/', import.meta.url);

function migrationGraph(): string {
  const { entries } = JSON.parse(
    readFileSync(new URL('meta/_journal.json', drizzleDirectory), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return [...entries]
    .sort((left, right) => left.idx - right.idx)
    .flatMap((entry) =>
      readFileSync(new URL(`${entry.tag}.sql`, drizzleDirectory), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement !== ''),
    )
    .join(';\n');
}

const tables: PgTable[] = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
);

const DELETE_ACTIONS: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
};

interface ForeignKeyShape {
  name: string;
  table: string;
  columns: string;
  foreignTable: string;
  foreignColumns: string;
  onDelete: string;
}

interface IndexShape {
  name: string;
  table: string;
  columns: string;
  unique: boolean;
  partial: boolean;
}

/**
 * PostgreSQL truncates an identifier to 63 bytes (`NAMEDATALEN - 1`), so a long
 * generated constraint name is stored shortened. That is the server's rule, not drift.
 */
function postgresIdentifier(name: string): string {
  return Buffer.from(name, 'utf8').subarray(0, 63).toString('utf8');
}

/** Entries of `left` with no equal entry in `right`, in a stable order. */
function missingFrom<T extends { name: string }>(left: readonly T[], right: readonly T[]): T[] {
  const present = new Set(right.map((entry) => JSON.stringify(entry)));
  return left
    .filter((entry) => !present.has(JSON.stringify(entry)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function declaredForeignKeys(table: PgTable): ForeignKeyShape[] {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      name: postgresIdentifier(foreignKey.getName()),
      table: getTableName(table),
      columns: reference.columns.map((column) => column.name).join(','),
      foreignTable: getTableName(reference.foreignTable),
      foreignColumns: reference.foreignColumns.map((column) => column.name).join(','),
      onDelete: foreignKey.onDelete ?? 'no action',
    };
  });
}

function declaredIndexes(table: PgTable): IndexShape[] {
  return getTableConfig(table).indexes.map((index) => ({
    name: index.config.name ?? '<unnamed>',
    table: getTableName(table),
    columns: index.config.columns
      .map((column) => (is(column, IndexedColumn) ? column.name : '<expression>'))
      .join(','),
    unique: index.config.unique,
    partial: index.config.where !== undefined,
  }));
}

/**
 * Drift that exists today, recorded exactly rather than tolerated loosely.
 *
 * The comparison is an equality against this list, in both directions, so a new
 * divergence fails and so does fixing one of these without deleting its entry, so
 * the list can only shrink deliberately. None of it is corrected here: each entry
 * is a defect in `src/schema` or `drizzle/`, reported rather than patched.
 */
const KNOWN_FOREIGN_KEY_DRIFT: { declaredOnly: ForeignKeyShape[]; createdOnly: ForeignKeyShape[] } =
  {
    // Empty since 0027 and the schema declarations that came with it (ledger MNT-15).
    declaredOnly: [],
    createdOnly: [],
  };

const KNOWN_INDEX_DRIFT: { declaredOnly: IndexShape[]; createdOnly: IndexShape[] } = {
  declaredOnly: [],
  createdOnly: [],
};

function sortedDrift<T extends { name: string }>(drift: { declaredOnly: T[]; createdOnly: T[] }) {
  const sorted = (rows: T[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name));
  return { declaredOnly: sorted(drift.declaredOnly), createdOnly: sorted(drift.createdOnly) };
}

let client: PGlite;
let databaseForeignKeys: ForeignKeyShape[];
let databaseIndexes: IndexShape[];
let databaseChecks: Array<{ name: string; table: string }>;

beforeAll(async () => {
  client = new PGlite();
  await client.exec(migrationGraph());

  const foreignKeys = await client.query<{
    name: string;
    table: string;
    columns: string;
    foreign_table: string;
    foreign_columns: string;
    confdeltype: string;
  }>(`
    SELECT c.conname AS name,
           t.relname AS table,
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum) AS columns,
           f.relname AS foreign_table,
           (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
              FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum) AS foreign_columns,
           c.confdeltype::text AS confdeltype
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_class f ON f.oid = c.confrelid
     WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`);
  databaseForeignKeys = foreignKeys.rows.map((row) => ({
    name: row.name,
    table: row.table,
    columns: row.columns,
    foreignTable: row.foreign_table,
    foreignColumns: row.foreign_columns,
    onDelete: DELETE_ACTIONS[row.confdeltype] ?? `unknown:${row.confdeltype}`,
  }));

  const indexes = await client.query<{
    name: string;
    table: string;
    columns: string;
    unique: boolean;
    partial: boolean;
  }>(`
    SELECT i.relname AS name,
           t.relname AS table,
           (SELECT string_agg(CASE WHEN k.attnum = 0 THEN '<expression>' ELSE a.attname END, ',' ORDER BY k.ord)
              FROM unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
              LEFT JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum) AS columns,
           x.indisunique AS unique,
           x.indpred IS NOT NULL AS partial
      FROM pg_index x
      JOIN pg_class i ON i.oid = x.indexrelid
      JOIN pg_class t ON t.oid = x.indrelid
     WHERE t.relnamespace = 'public'::regnamespace
       AND NOT x.indisprimary
       AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = x.indexrelid AND c.contype = 'u')`);
  databaseIndexes = indexes.rows;

  const checks = await client.query<{ name: string; table: string }>(`
    SELECT c.conname AS name, t.relname AS table
      FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
     WHERE c.contype = 'c' AND c.connamespace = 'public'::regnamespace`);
  databaseChecks = checks.rows;
}, 60_000);

afterAll(async () => {
  if (client) await client.close();
});

describe('the schema module and the migration graph agree', () => {
  it('finds tables to compare, so the comparison cannot pass vacuously', () => {
    expect(tables.length).toBeGreaterThan(40);
    expect(databaseForeignKeys.length).toBeGreaterThan(20);
    expect(databaseIndexes.length).toBeGreaterThan(20);
  });

  it('declares every foreign key the migrations create, with the same referential action', () => {
    const declared = tables.flatMap(declaredForeignKeys);
    const declaredTables = new Set(tables.map((table) => getTableName(table)));
    const created = databaseForeignKeys.filter((fk) => declaredTables.has(fk.table));
    expect({
      declaredOnly: missingFrom(declared, created),
      createdOnly: missingFrom(created, declared),
    }).toEqual(sortedDrift(KNOWN_FOREIGN_KEY_DRIFT));
  });

  it('declares every index the migrations create, with the same columns and uniqueness', () => {
    const declared = tables.flatMap(declaredIndexes);
    const declaredTables = new Set(tables.map((table) => getTableName(table)));
    const created = databaseIndexes.filter((index) => declaredTables.has(index.table));
    expect({
      declaredOnly: missingFrom(declared, created),
      createdOnly: missingFrom(created, declared),
    }).toEqual(sortedDrift(KNOWN_INDEX_DRIFT));
  });

  it('creates every check constraint the schema declares, on the same table', () => {
    const declared = tables.flatMap((table) =>
      getTableConfig(table).checks.map((check) => ({
        name: check.name,
        table: getTableName(table),
      })),
    );
    expect(declared.length).toBeGreaterThan(20);
    expect(
      missingFrom(declared, databaseChecks),
      'declared in TypeScript, absent from the database',
    ).toEqual([]);
  });
});

describe('execution schema referential intent', () => {
  function targets(table: PgTable): Record<string, string> {
    return Object.fromEntries(
      declaredForeignKeys(table).map((fk) => [
        fk.columns,
        `${fk.foreignTable}.${fk.foreignColumns} on delete ${fk.onDelete}`,
      ]),
    );
  }

  it('never lets deleting a workspace cascade into execution history', () => {
    // A workspace delete that cascaded would silently erase runs, events and gate
    // decisions: the evidence a release decision was made on. `restrict` makes the
    // operator remove the dependants deliberately.
    for (const table of [
      environments,
      releases,
      qualityPolicies,
      executionJobs,
      runEvents,
      gateEvaluations,
    ]) {
      expect(targets(table)['workspace_id'], getTableName(table)).toBe(
        'workspaces.id on delete restrict',
      );
    }
  });

  it("removes a run's jobs, events, artifacts and gate evaluations with the run", () => {
    for (const table of [executionJobs, runEvents, artifacts, gateEvaluations]) {
      expect(targets(table)['run_id'], getTableName(table)).toBe('runs.id on delete cascade');
    }
  });

  it('keeps evidence when an optional parent goes, by nulling the pointer', () => {
    expect(targets(environments)['project_id']).toBe('projects.id on delete set null');
    expect(targets(runEvents)['job_id']).toBe('execution_jobs.id on delete set null');
    expect(targets(artifacts)['job_id']).toBe('execution_jobs.id on delete set null');
    expect(targets(artifacts)['result_id']).toBe('results.id on delete set null');
    expect(targets(gateEvaluations)['release_id']).toBe('releases.id on delete set null');
  });

  it('refuses to delete a project with releases, a runner holding a lease, or a policy in use', () => {
    expect(targets(releases)['project_id']).toBe('projects.id on delete restrict');
    expect(targets(executionJobs)['lease_owner']).toBe('runners.id on delete restrict');
    expect(targets(gateEvaluations)['policy_id']).toBe('quality_policies.id on delete restrict');
  });

  it('keys run events on (workspace, event) and orders them uniquely per run', () => {
    const config = getTableConfig(runEvents);
    expect(config.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([
      ['workspace_id', 'event_id'],
    ]);
    const unique = declaredIndexes(runEvents).filter((index) => index.unique);
    expect(unique.map((index) => [index.name, index.columns])).toEqual([
      ['run_events_run_sequence_unique', 'run_id,sequence'],
      ['run_events_workspace_event_key_unique', 'workspace_id,event_key'],
      ['run_events_run_hash_unique', 'run_id,hash'],
    ]);
    const terminal = declaredIndexes(runEvents).find(
      (index) => index.name === 'run_events_terminal_idx',
    );
    expect(terminal).toEqual({
      name: 'run_events_terminal_idx',
      table: 'run_events',
      columns: 'run_id',
      unique: false,
      partial: true,
    });
  });

  it('allows one default quality policy per workspace through a partial unique index', () => {
    expect(
      declaredIndexes(qualityPolicies).find(
        (index) => index.name === 'quality_policies_workspace_default_unique',
      ),
    ).toMatchObject({ columns: 'workspace_id', unique: true, partial: true });
  });

  it('orders the claim index by state, availability and priority', () => {
    expect(
      declaredIndexes(executionJobs).find((index) => index.name === 'execution_jobs_claim_idx'),
    ).toMatchObject({ columns: 'state,available_at,priority', unique: false, partial: false });
  });

  it('names the integrity checks each execution table depends on', () => {
    const checks = (table: PgTable) => getTableConfig(table).checks.map((check) => check.name);
    expect(checks(executionJobs)).toEqual([
      'execution_jobs_attempt_check',
      'execution_jobs_timeout_check',
      'execution_jobs_state_check',
      'execution_jobs_fencing_token_check',
      'execution_jobs_lease_check',
    ]);
    expect(checks(runEvents)).toEqual([
      'run_events_sequence_check',
      'run_events_hash_check',
      'run_events_fencing_token_check',
    ]);
    expect(checks(artifacts)).toEqual([
      'artifacts_kind_check',
      'artifacts_attempt_check',
      'artifacts_size_check',
      'artifacts_evidence_check',
    ]);
    expect(checks(gateEvaluations)).toEqual([
      'gate_evaluations_status_check',
      'gate_evaluations_decision_check',
      'gate_evaluations_policy_hash_check',
    ]);
    expect(checks(qualityPolicies)).toHaveLength(4);
    expect(checks(environments)).toEqual([]);
  });
});
