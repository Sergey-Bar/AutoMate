import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { optional, parseOptions, required } from './args.js';
import { target, type Io } from './commands.js';
import { CliError, EXIT, usage } from './errors.js';
import { send } from './http.js';
import { projectUrl } from './target.js';

/**
 * `automate shard --total N --index i [--as-of <time>] -- <files…>` (or `--files-from <path>`)
 *
 * Prints the files shard `i` of `N` should run, one per line, balanced by how long each took
 * in the project's recent runs:
 *
 * ```sh
 * npx playwright test $(automate shard --total 4 --index 2 -- $(git ls-files 'e2e/*.spec.ts'))
 * ```
 *
 * **It never drops a file.** If the plan cannot be had — the server is down, refuses, answers
 * with something that is not a plan, or a plan that leaves out a file — this shard prints
 * every file. The build is slower and says why; nothing silently goes untested. A refused
 * *credential* is still an error, because that is a setup to fix rather than an outage to
 * ride out.
 *
 * **Every shard must ask with the same cut-off**, or a run finishing between two shards'
 * calls hands them different plans and a file to neither. The cut-off is `--as-of`, then
 * `AUTOMATE_SHARD_AS_OF`, then the checked-out commit's time — which every shard of one CI
 * run shares without being told.
 */

const MAX_SHARDS = 64;

interface PlannedShard {
  index: number;
  files: string[];
  estimatedMs: number;
}

interface Plan {
  runs: number;
  unknown: number;
  shards: PlannedShard[];
}

function wholeNumber(value: string, min: number, max: number, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw usage(`--${name} is a whole number from ${String(min)} to ${String(max)}`);
  }
  return parsed;
}

/** The plan, or `null` when the answer is not one. Read defensively: the CLI has no schema. */
function planOf(answer: unknown): Plan | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const body = answer as Record<string, unknown>;
  const shards = body['shards'];
  if (
    !Array.isArray(shards) ||
    typeof body['runs'] !== 'number' ||
    typeof body['unknown'] !== 'number'
  ) {
    return null;
  }
  const valid = shards.every((shard: unknown) => {
    const entry = shard as Record<string, unknown> | null;
    return (
      typeof entry?.['index'] === 'number' &&
      typeof entry['estimatedMs'] === 'number' &&
      Array.isArray(entry['files']) &&
      entry['files'].every((file: unknown) => typeof file === 'string')
    );
  });
  return valid
    ? { runs: body['runs'], unknown: body['unknown'], shards: shards as PlannedShard[] }
    : null;
}

function duration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  return seconds < 60
    ? `${String(seconds)}s`
    : `${String(Math.floor(seconds / 60))}m ${String(seconds % 60)}s`;
}

/** `git show -s --format=%cI HEAD`, or `undefined` outside a repository. */
function gitCommitTime(cwd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['show', '-s', '--format=%cI', 'HEAD'],
      { cwd, shell: false },
      (error, stdout) => {
        const value = stdout.trim();
        resolve(error === null && value !== '' ? value : undefined);
      },
    );
  });
}

async function filesOf(
  argv: readonly string[],
  split: number,
  from: string | undefined,
  cwd: string,
) {
  const listed = split === -1 ? [] : argv.slice(split + 1);
  let read: string[] = [];
  if (from !== undefined) {
    try {
      read = (await readFile(path.resolve(cwd, from), 'utf8')).split(/\r?\n/u);
    } catch {
      throw usage(`--files-from ${from} could not be read.`);
    }
  }
  const files = [
    ...new Set([...listed, ...read].map((file) => file.trim()).filter((file) => file !== '')),
  ];
  if (files.length === 0) {
    throw usage('Name the files to plan: automate shard … -- <files…>, or --files-from <path>.');
  }
  return files;
}

interface ShardOptions {
  total: number;
  index: number;
  files: string[];
  asOfFlag: string | undefined;
  destination: ReturnType<typeof target>;
}

/** The command line, validated: nothing is sent before every option is known to be sound. */
async function readOptions(argv: readonly string[], io: Io): Promise<ShardOptions> {
  const split = argv.indexOf('--');
  const parsed = parseOptions(split === -1 ? argv : argv.slice(0, split), {
    values: ['project', 'total', 'index', 'as-of', 'files-from'],
  });
  const total = wholeNumber(required(parsed, 'total'), 1, MAX_SHARDS, 'total');
  const index = wholeNumber(required(parsed, 'index'), 1, total, 'index');
  const asOfFlag = optional(parsed, 'as-of', io.env['AUTOMATE_SHARD_AS_OF']);
  if (asOfFlag !== undefined && Number.isNaN(Date.parse(asOfFlag))) {
    throw usage(`--as-of is an ISO-8601 time: ${asOfFlag}`);
  }
  const files = await filesOf(argv, split, optional(parsed, 'files-from'), io.cwd);
  return { total, index, files, asOfFlag, destination: target(io, parsed) };
}

/** The history cut-off every shard of one CI run shares: the flag, else the commit's time. */
async function cutOffOf(
  asOfFlag: string | undefined,
  io: Io & { commitTime?: () => Promise<string | undefined> },
  warn: (line: string) => void,
): Promise<string | undefined> {
  const cutOff = asOfFlag ?? (await (io.commitTime ?? (() => gitCommitTime(io.cwd)))());
  if (cutOff === undefined) {
    warn(
      'No commit time to plan from; shards that ask at different moments may disagree. Pass --as-of.',
    );
  }
  return cutOff === undefined || Number.isNaN(Date.parse(cutOff))
    ? undefined
    : new Date(cutOff).toISOString();
}

export async function shard(
  argv: readonly string[],
  io: Io & { err?: (line: string) => void },
): Promise<number> {
  const { total, index, files, asOfFlag, destination } = await readOptions(argv, io);
  const warn = (line: string) => (io.err ?? io.out)(line);
  const asOf = await cutOffOf(asOfFlag, io, warn);

  /** Every file, on this shard, and the reason. */
  const everything = (reason: string): number => {
    warn(`${reason}; running all ${String(files.length)} file(s) on this shard.`);
    for (const file of files) io.out(file);
    return EXIT.ok;
  };

  let answer: unknown;
  try {
    answer = await send(io.fetch, destination, projectUrl(destination, '/shards/plan'), {
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({ total, files, ...(asOf === undefined ? {} : { asOf }) }),
    });
  } catch (error) {
    if (error instanceof CliError && error.exitCode === EXIT.unauthorised) throw error;
    return everything(error instanceof Error ? error.message : 'The plan could not be fetched');
  }
  const plan = planOf(answer);
  if (plan === null) return everything('The server answered without a shard plan');
  const planned = new Set(plan.shards.flatMap((entry) => entry.files));
  if (files.some((file) => !planned.has(file))) {
    return everything('The plan leaves out a file');
  }
  const mine = plan.shards.find((entry) => entry.index === index);
  if (mine === undefined) return everything(`The plan has no shard ${String(index)}`);
  warn(
    `Shard ${String(index)}/${String(total)}: ${String(mine.files.length)} file(s), about ${duration(mine.estimatedMs)}, ` +
      `planned from ${String(plan.runs)} run(s); ${String(plan.unknown)} file(s) had no history.`,
  );
  for (const file of mine.files) io.out(file);
  return EXIT.ok;
}
