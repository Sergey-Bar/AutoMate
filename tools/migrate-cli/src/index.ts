#!/usr/bin/env node

import { migrateToPostgres } from './migrate.js';

interface CliOptions {
  from: string;
  to: string;
  dryRun: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const report = await migrateToPostgres(options);

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

function parseArgs(args: readonly string[]): CliOptions {
  const [command, subcommand, ...rest] = args;

  if (command !== 'migrate' || subcommand !== 'sqlite-to-postgres') {
    throw new Error('Usage: node dist/index.js migrate sqlite-to-postgres --from <path> --to <pg-url> [--dry-run]');
  }

  let from: string | undefined;
  let to: string | undefined;
  let dryRun = false;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--from') {
      from = readFlagValue(rest, index, '--from');
      index += 1;
    } else if (arg === '--to') {
      to = readFlagValue(rest, index, '--to');
      index += 1;
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (from === undefined) {
    throw new Error('Missing required --from <path>');
  }
  if (to === undefined) {
    throw new Error('Missing required --to <pg-url>');
  }

  return { from, to, dryRun };
}

function readFlagValue(args: readonly string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
