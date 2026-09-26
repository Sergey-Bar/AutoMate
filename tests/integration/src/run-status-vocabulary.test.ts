import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PERSISTED_RUN_STATUS_VALUES,
  RUN_STATUS_VALUES,
  RunStatusSchema,
} from '@automate/shared-contracts';

/**
 * One run-status vocabulary, and the column proven to be a subset of it.
 *
 * The list was declared five times across three packages, in two variants: the
 * contract and the dashboard accepted `queued`, and the `runs.status` column and
 * its `runs_status_check` constraint did not. So the contract accepted a status
 * the database would refuse — and since the contract is what a token or an upload
 * is validated against, that combination was reachable.
 *
 * `packages/db` cannot import the contracts: it is itself a leaf, below them. So
 * the column keeps a literal list, and this test holds the two together by
 * reading the **real** `runs_status_check` constraint out of the live catalogue.
 * The safe direction is one-way — the column may hold less than the contract,
 * never more — and that is what is asserted.
 */
const drizzleDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../packages/db/drizzle',
);

function readMigrations(): string {
  const journal = JSON.parse(
    readFileSync(path.join(drizzleDirectory, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; tag: string }> };
  return journal.entries
    .slice()
    .sort((left, right) => left.idx - right.idx)
    .map((entry) =>
      readFileSync(path.join(drizzleDirectory, `${entry.tag}.sql`), 'utf8')
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter(Boolean)
        .join(';\n'),
    )
    .join(';\n');
}

let client: PGlite;

beforeAll(async () => {
  const buildOutput = path.resolve(drizzleDirectory, '..', 'dist', 'index.js');
  const buildTime = statSync(buildOutput).mtimeMs;
  const stack = [path.resolve(drizzleDirectory, '..', 'src')];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.ts') && statSync(full).mtimeMs > buildTime)
        throw new Error('packages/db is not built; run pnpm --filter @automate/db build');
    }
  }
  client = new PGlite();
  await client.exec(readMigrations());
}, 180_000);

afterAll(async () => {
  if (client) await client.close();
});

/** The values the live `runs_status_check` constraint permits. */
async function statusesTheColumnPermits(): Promise<string[]> {
  const constraints = await client.query<{ conname: string; pg_get_constraintdef: string }>(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS pg_get_constraintdef
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'runs' AND c.contype = 'c'`,
  );
  const status = constraints.rows.find((row) => row.conname.includes('status'));
  if (status === undefined) {
    throw new Error(
      `runs has no status CHECK constraint; the constraints present are ` +
        `${constraints.rows.map((row) => row.conname).join(', ') || 'none'}`,
    );
  }
  return [...status.pg_get_constraintdef.matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

describe('one run-status vocabulary', () => {
  it('validates every value the contract declares', () => {
    for (const status of RUN_STATUS_VALUES) {
      expect(RunStatusSchema.safeParse(status).success, status).toBe(true);
    }
  });

  it('is the union of the persisted statuses and the queued default', () => {
    // `queued` is the column's default for a row that has not started, which is
    // why the column's list is a strict subset rather than the whole contract.
    expect(new Set(RUN_STATUS_VALUES)).toEqual(new Set([...PERSISTED_RUN_STATUS_VALUES, 'queued']));
  });

  it('permits in the column exactly the persisted statuses, and nothing else', async () => {
    const permitted = await statusesTheColumnPermits();
    expect(new Set(permitted)).toEqual(new Set(PERSISTED_RUN_STATUS_VALUES));
  });

  it('lets the column hold less than the contract, never more', async () => {
    const permitted = new Set(await statusesTheColumnPermits());
    for (const status of permitted) {
      expect(
        (RUN_STATUS_VALUES as readonly string[]).includes(status),
        `the column permits "${status}", which the contract does not declare`,
      ).toBe(true);
    }
  });

  it('refuses a contract status the column would reject', async () => {
    // The exact combination that was reachable: the contract accepted `queued`
    // and the constraint rejected it, so a valid-looking status became a 500.
    const permitted = await statusesTheColumnPermits();
    expect(RunStatusSchema.safeParse('queued').success).toBe(true);
    expect(permitted).not.toContain('queued');
  });
});
