import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from './migrations.js';
import type { PGlite } from '@electric-sql/pglite';

/**
 * Every enum column is constrained by the database.
 *
 * Drizzle's `text(..., { enum: [...] })` is compile-time only. Twenty-five
 * columns across nineteen tables accepted any value at the database level: a
 * typo, a stale writer, or a direct SQL write could put a state in the column
 * that the schema says is impossible, and it would then split every `GROUP BY`
 * over that column and surface as an unclassified 500 on the next read.
 *
 * This test is the gate that keeps it that way. It reads the enum declarations
 * out of the Drizzle schema and the constraints out of the *live* catalogue, so
 * an enum added to the schema without a matching migration fails here — which
 * is the whole point, since a source-level check would only prove the
 * declaration is self-consistent.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const schemaDirectory = path.join(repoRoot, 'packages/db/src/schema');

interface DeclaredEnum {
  table: string;
  column: string;
  values: string[];
}

function declaredEnums(): DeclaredEnum[] {
  const files = readdirSync(schemaDirectory).filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  const found = new Map<string, DeclaredEnum>();
  for (const file of files) {
    const source = readFileSync(path.join(schemaDirectory, file), 'utf8');
    for (const tableMatch of source.matchAll(/export const \w+ = pgTable\(\s*\n?\s*'(\w+)',/g)) {
      const table = tableMatch[1];
      const start = tableMatch.index;
      const rest = source.slice(start + tableMatch[0].length);
      const next = rest.search(/\nexport const |\n\/\/ ───/);
      const block = next === -1 ? rest : rest.slice(0, next);
      for (const column of block.matchAll(/(\w+):\s*text\(\s*'(\w+)'\s*,\s*\{([\s\S]*?)\}\s*\)/g)) {
        const enumMatch = /enum:\s*\[([^\]]*)\]/.exec(column[3] ?? '');
        if (!enumMatch) continue;
        const values = [...enumMatch[1].matchAll(/'([^']+)'/g)].map((value) => value[1]);
        if (values.length === 0) continue;
        found.set(`${table}.${column[2]}`, { table, column: column[2], values });
      }
    }
  }
  return [...found.values()];
}

let client: PGlite;
let declared: DeclaredEnum[];

/**
 * The values a column's enum CHECK permits, read from the live catalogue.
 *
 * The constraint is selected **by name** (`<table>_<column>_check`, the name the
 * generator emits) rather than by "the first check that mentions the column".
 * `api_keys.role` is the case that makes that difference: it also has
 * `api_keys_admin_role_explicit_check`, whose definition quotes `'admin'`, so a
 * first-match lookup read the value list as `["admin"]` and reported a mismatch
 * that was really a lookup bug.
 */
async function permittedValues(table: string, column: string): Promise<string[] | null> {
  const result = await client.query<{ conname: string; pg_get_constraintdef: string | null }>(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS pg_get_constraintdef
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
      WHERE t.relname = $1 AND a.attname = $2 AND c.contype = 'c'`,
    [table, column],
  );
  const named = `${table}_${column}_check`;
  const candidates = result.rows
    .map((row) => ({ name: row.conname, definition: row.pg_get_constraintdef ?? '' }))
    .filter(
      (entry) => entry.definition.includes(`"${column}"`) || entry.definition.includes(column),
    )
    .map((entry) => ({
      name: entry.name,
      values: [...entry.definition.matchAll(/'([^']+)'/g)].map((value) => value[1]),
    }))
    .filter((entry) => entry.values.length > 0);

  const exact = candidates.find((entry) => entry.name === named);
  if (exact) return exact.values;
  // A table may already constrain the column under a different name; take the
  // widest list, which is the enum-shaped one.
  return (
    candidates.sort((left, right) => right.values.length - left.values.length)[0]?.values ?? null
  );
}

beforeAll(async () => {
  declared = declaredEnums();
  client = await createMigratedDatabase();
}, 120_000);

afterAll(async () => {
  if (client) await client.close();
});

describe('enum column constraints', () => {
  it('finds the enum declarations to check', () => {
    // An empty list would make every assertion below vacuous, which is the exact
    // failure mode this suite exists to prevent.
    expect(declared.length).toBeGreaterThan(20);
  });

  it('constrains every declared enum column in the database', async () => {
    const unconstrained: string[] = [];
    for (const entry of declared) {
      const permitted = await permittedValues(entry.table, entry.column);
      if (permitted === null) unconstrained.push(`${entry.table}.${entry.column}`);
    }
    expect(
      unconstrained,
      'Drizzle enum declarations are compile-time only. These columns accept any ' +
        'value at the database level, so a stale writer or a direct SQL write can ' +
        'put in a state the schema says is impossible. Add a CHECK in a migration — ' +
        'the generator reads the value lists from the schema so they cannot drift.',
    ).toEqual([]);
  }, 120_000);

  it('permits exactly the values the schema declares', async () => {
    const mismatched: string[] = [];
    for (const entry of declared) {
      const permitted = await permittedValues(entry.table, entry.column);
      if (permitted === null) continue;
      const declaredSet = [...entry.values].sort();
      const permittedSet = [...new Set(permitted)].sort();
      // A constraint that permits a value the schema does not declare is as
      // wrong as one that permits everything: it is a value nothing produces and
      // nothing reads, so it only ever splits an aggregation.
      if (
        declaredSet.length !== permittedSet.length ||
        declaredSet.some((value, index) => value !== permittedSet[index])
      ) {
        mismatched.push(
          `${entry.table}.${entry.column}: schema ${JSON.stringify(declaredSet)} vs ` +
            `database ${JSON.stringify(permittedSet)}`,
        );
      }
    }
    expect(mismatched).toEqual([]);
  }, 120_000);
});
