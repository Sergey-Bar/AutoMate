#!/usr/bin/env node

import { createPlan, readPlan, validatePlan, writePlan } from './engine.js';
import { readSqliteCatalog } from './catalog.js';
import { readPostgresCounts } from './postgres-catalog.js';
import { reconcileCounts } from './reconcile.js';
import { migrateToPostgres } from './migrate.js';

interface CliOptions {
  command: string;
  from?: string;
  to?: string;
  out?: string;
  sourceId?: string;
  sourceCommit?: string;
  targetCommit?: string;
  plan?: string;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'plan') {
    if (
      !options.from ||
      !options.sourceId ||
      !options.sourceCommit ||
      !options.targetCommit ||
      !options.out
    ) {
      throw new Error(
        'plan requires --from, --source-id, --source-commit, --target-commit, and --out',
      );
    }
    const plan = createPlan({
      source: options.from,
      sourceId: options.sourceId,
      sourceCommit: options.sourceCommit,
      targetCommit: options.targetCommit,
    });
    writePlan(options.out, plan);
    return;
  }
  if (options.command === 'validate') {
    if (!options.plan) throw new Error('validate requires --plan');
    validatePlan(readPlan(options.plan));
    return;
  }
  if (options.command === 'apply') {
    if (!options.from || !options.to || !options.plan)
      throw new Error('apply requires --from, --to, and --plan');
    validatePlan(readPlan(options.plan));
    if (!options.dryRun) {
      throw new Error(
        'Migration apply is blocked until the resumable wave engine and restore verification are enabled',
      );
    }
    const report = await migrateToPostgres({ from: options.from, to: options.to, dryRun: true });
    if (report.errors.length > 0) process.exitCode = 1;
    return;
  }
  if (options.command === 'verify') {
    if (!options.from || !options.to || !options.plan) {
      throw new Error('verify requires --from, --to, and --plan');
    }
    validatePlan(readPlan(options.plan));
    const sourceCounts = Object.fromEntries(
      readSqliteCatalog(options.from).map((table) => [table.name, table.rowCount]),
    );
    const targetCounts = await readPostgresCounts(options.to);
    const result = reconcileCounts(sourceCounts, targetCounts);
    if (!result.ok) throw new Error(`Reconciliation failed: ${result.discrepancies.join('; ')}`);
    console.info('Migration reconciliation passed');
    return;
  }
  throw new Error('Usage: migrate plan|apply|validate|verify');
}

function parseArgs(args: readonly string[]): CliOptions {
  const [command, ...rest] = args;
  if (!['plan', 'apply', 'validate', 'verify'].includes(command ?? '')) {
    throw new Error('Usage: migrate plan|apply|validate|verify');
  }
  const options: CliOptions = { command, dryRun: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    if (arg === '--from') options.from = value;
    else if (arg === '--to') options.to = value;
    else if (arg === '--out') options.out = value;
    else if (arg === '--source-id') options.sourceId = value;
    else if (arg === '--source-commit') options.sourceCommit = value;
    else if (arg === '--target-commit') options.targetCommit = value;
    else if (arg === '--plan') options.plan = value;
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  return options;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
