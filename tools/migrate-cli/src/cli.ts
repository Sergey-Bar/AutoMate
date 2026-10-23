import { createPlan, readPlan, validatePlan, writePlan } from './engine.js';
import { readSqliteCatalog } from './catalog.js';
import { readPostgresCounts } from './postgres-catalog.js';
import { reconcileCounts } from './reconcile.js';
import { migrateToPostgres } from './migrate.js';

export interface CliOptions {
  command: string;
  from?: string;
  to?: string;
  out?: string;
  sourceId?: string;
  sourceCommit?: string;
  targetCommit?: string;
  plan?: string;
  /** The workspace every imported row belongs to; see `MigrateOptions.workspaceId`. */
  workspace?: string;
  dryRun: boolean;
}

/**
 * Runs one CLI invocation. `argv` is the argument list after the executable and
 * script (`process.argv.slice(2)`). Failures are printed and reported through
 * `process.exitCode = 1`; this function never rejects.
 */
export async function run(argv: readonly string[]): Promise<void> {
  try {
    await main(argv);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

async function main(argv: readonly string[]): Promise<void> {
  const options = parseArgs(argv);
  switch (options.command) {
    case 'plan':
      return runPlan(options);
    case 'validate':
      return runValidate(options);
    case 'apply':
      return runApply(options);
    default:
      // verify: parseArgs has already refused any other command.
      return runVerify(options);
  }
}

function runPlan(options: CliOptions): void {
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
}

function runValidate(options: CliOptions): void {
  if (!options.plan)
    throw new Error(
      'validate requires --plan <file>: it checks a plan written by migrate plan. ' +
        'To check the migration journal against the schema, run pnpm db:check.',
    );
  validatePlan(readPlan(options.plan));
}

async function runApply(options: CliOptions): Promise<void> {
  if (!options.from || !options.to || !options.plan)
    throw new Error('apply requires --from, --to, and --plan');
  validatePlan(readPlan(options.plan));
  if (!options.dryRun) {
    throw new Error(
      'Migration apply is blocked until the resumable wave engine and restore verification are enabled',
    );
  }
  const report = await migrateToPostgres({
    from: options.from,
    to: options.to,
    dryRun: true,
    ...(options.workspace === undefined ? {} : { workspaceId: options.workspace }),
  });
  if (report.errors.length > 0) process.exitCode = 1;
}

async function runVerify(options: CliOptions): Promise<void> {
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
}

/** The option each value-taking flag sets. */
const VALUE_FLAGS = {
  '--from': 'from',
  '--to': 'to',
  '--out': 'out',
  '--source-id': 'sourceId',
  '--source-commit': 'sourceCommit',
  '--target-commit': 'targetCommit',
  '--plan': 'plan',
  '--workspace': 'workspace',
} as const;

function isValueFlag(arg: string): arg is keyof typeof VALUE_FLAGS {
  return Object.hasOwn(VALUE_FLAGS, arg);
}

export function parseArgs(args: readonly string[]): CliOptions {
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
    if (!isValueFlag(String(arg))) throw new Error(`Unknown argument: ${arg}`);
    options[VALUE_FLAGS[arg as keyof typeof VALUE_FLAGS]] = value;
    index += 1;
  }
  return options;
}
