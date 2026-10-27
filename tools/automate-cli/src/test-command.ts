import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { optional, parseOptions, required } from './args.js';
import { branchOf, commitOf, target, type Io } from './commands.js';
import { CliError, EXIT, usage } from './errors.js';
import { send } from './http.js';
import { projectUrl } from './target.js';

/**
 * `automate test --format junit|playwright-json --report <path> [--branch --commit] -- <command…>`
 *
 * Runs the test command, sends its report, and exits with the command's own code — except
 * when the server says every failure is an approved quarantined test, when it exits 0.
 *
 * **The rules, and why each is the safe one:**
 *
 * - the command passed → exit 0, whatever happens to the upload. Quarantine never turns a
 *   green build red, and a server that is down never does either.
 * - the command failed → exit 0 **only** if the server answered, parsed the report, and said
 *   `quarantine.excused: true`. Every other case — no report, server unreachable, a
 *   refusal, an answer that is not a verdict — keeps the command's code and says why. An
 *   automated excuse that cannot be confirmed is not given.
 *
 * The CLI never reads the report. The server decides from what it parsed, with the same
 * function the recorded gate uses, so a job and the dashboard cannot disagree.
 *
 * The command is spawned without a shell, so its arguments are passed as they are and never
 * re-parsed. On Windows a `.cmd` (such as `npx`) needs a shell, which is spelled out:
 * `-- cmd /c npx playwright test`.
 */

/** The exit code a shell reports for a command it could not find. */
const NOT_STARTED = 127;
const LISTED = 10;

interface Verdict {
  excused: boolean;
  excusedTests: string[];
  unexcusedFailures: string[];
  failed: number;
  reportErrors: number;
}

function runCommand(command: string, args: readonly string[], cwd: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.on('error', () => resolve(NOT_STARTED));
    // A command killed by a signal has no exit code; it failed.
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : null;

/** The verdict, or `null` when the answer is not one. Read defensively: the CLI has no schema. */
function verdictOf(answer: unknown): Verdict | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const body = answer as Record<string, unknown>;
  const quarantine = body['quarantine'] as Record<string, unknown> | undefined;
  const tests = body['tests'] as Record<string, unknown> | undefined;
  const excusedTests = strings(quarantine?.['excusedTests']);
  const unexcused = strings(quarantine?.['unexcusedFailures']);
  if (
    typeof quarantine?.['excused'] !== 'boolean' ||
    excusedTests === null ||
    unexcused === null ||
    typeof tests?.['failed'] !== 'number' ||
    typeof body['reportErrors'] !== 'number'
  ) {
    return null;
  }
  return {
    excused: quarantine['excused'],
    excusedTests,
    unexcusedFailures: unexcused,
    failed: tests['failed'],
    reportErrors: body['reportErrors'],
  };
}

function listed(io: Io, identities: readonly string[]): void {
  for (const identity of identities.slice(0, LISTED)) io.out(`  - ${identity}`);
  if (identities.length > LISTED) io.out(`  …and ${String(identities.length - LISTED)} more`);
}

/**
 * What to print and exit with once the server has answered. Order matters: a passing command
 * is always exit 0; otherwise only a confirmed excuse is.
 */
function conclude(
  verdict: Verdict,
  code: number,
  io: Io,
  keep: (reason: string) => number,
): number {
  if (code === 0) {
    io.out(`Recorded the run: ${String(verdict.failed)} failed test(s).`);
    return EXIT.ok;
  }
  if (verdict.excused) {
    io.out(
      `${String(verdict.failed)} failed test${verdict.failed === 1 ? '' : 's'}, all quarantined; exiting 0:`,
    );
    listed(io, verdict.excusedTests);
    return EXIT.ok;
  }
  if (verdict.reportErrors > 0) {
    return keep(`The report has ${String(verdict.reportErrors)} error(s) outside its tests`);
  }
  if (verdict.unexcusedFailures.length > 0) {
    io.out(`${String(verdict.unexcusedFailures.length)} failed test(s) not quarantined:`);
    listed(io, verdict.unexcusedFailures);
  }
  return keep('Not every failure is quarantined');
}

interface TestOptions {
  command: string;
  commandArgs: string[];
  report: string;
  destination: ReturnType<typeof target>;
  url: URL;
}

/** The command line, validated before anything runs: a bad flag must not cost a test run. */
function readOptions(argv: readonly string[], io: Io): TestOptions {
  const split = argv.indexOf('--');
  const [command, ...commandArgs] = split === -1 ? [] : argv.slice(split + 1);
  if (command === undefined)
    throw usage('Give the test command after --: automate test … -- <command>');
  const parsed = parseOptions(split === -1 ? argv : argv.slice(0, split), {
    values: ['project', 'format', 'report', 'branch', 'commit'],
  });
  const format = required(parsed, 'format');
  if (format !== 'junit' && format !== 'playwright-json') {
    throw usage('--format is junit or playwright-json');
  }
  const report = required(parsed, 'report');
  const destination = target(io, parsed);
  const url = projectUrl(destination, '/tests/reports', {
    format,
    branch: branchOf(io, optional(parsed, 'branch')),
    commit: commitOf(io, optional(parsed, 'commit')),
    startedAt: io.now().toISOString(),
  });
  return { command, commandArgs, report, destination, url };
}

export async function test(
  argv: readonly string[],
  io: Io & { err?: (line: string) => void },
): Promise<number> {
  const { command, commandArgs, report, destination, url } = readOptions(argv, io);
  const warn = (line: string) => (io.err ?? io.out)(line);

  const code = await runCommand(command, commandArgs, io.cwd);
  if (code === NOT_STARTED) {
    warn(`The test command did not start: ${command}.`);
    return code;
  }
  /** The command's own code, with the reason no excuse was given. */
  const keep = (reason: string): number => {
    warn(
      code === 0
        ? `${reason}; the run was not recorded.`
        : `${reason}; keeping exit code ${String(code)}.`,
    );
    return code;
  };

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = new Uint8Array(await readFile(path.resolve(io.cwd, report)));
  } catch {
    return keep(`Report ${report} was not written`);
  }
  let answer: unknown;
  try {
    answer = await send(io.fetch, destination, url, {
      method: 'POST',
      body: bytes,
      contentType: 'application/octet-stream',
    });
  } catch (error) {
    return keep(error instanceof CliError ? error.message : 'The report could not be sent');
  }
  const verdict = verdictOf(answer);
  if (verdict === null) return keep('The server answered without a quarantine verdict');
  return conclude(verdict, code, io, keep);
}
