import { agentConfig, deploy, gate, upload, type Io } from './commands.js';
import { CliError, EXIT } from './errors.js';
import { shard } from './shard-command.js';
import { test } from './test-command.js';

export const HELP = `automate — send CI evidence to an AutoMate install.

Usage:
  automate upload --format <format> --file <path> [--branch <b>] [--commit <sha>] [--digest sha256:<hex>]
  automate test --format junit|playwright-json --report <path> [--branch <b>] [--commit <sha>] -- <command…>
  automate shard --total <n> --index <i> [--as-of <time>] (-- <files…> | --files-from <path>)
  automate gate --branch <b> --commit <sha> [--pr <number>]
  automate deploy --environment <name> --status success|failure [--sha <sha>] [--id <id>] [--url <url>]
  automate agent-config [--branch <b>] [--commit <sha>] [--dir <path>]

\`test\` runs the command, sends its report, and exits with the command's own code, or 0 when
every failure is an approved quarantined test. The command runs without a shell; on Windows,
write \`-- cmd /c npx playwright test\`.

\`shard\` prints the files shard i of n should run, balanced by how long each took in recent
runs. It never drops a file: if the plan cannot be had, it prints them all.

Every command takes --project <id>, or reads AUTOMATE_PROJECT.
Environment: AUTOMATE_URL (https://, or http:// to loopback only), AUTOMATE_TOKEN (amt_…).
Exit codes: 0 done or gate passed, 1 gate failed, 2 usage, 3 refused or unreachable, 4 credential refused.
\`test\` exits with its command's code instead, and 127 when the command could not start.`;

type Command = (
  argv: readonly string[],
  io: Io & { err: (line: string) => void },
) => Promise<number>;

const COMMANDS: Readonly<Record<string, Command>> = {
  upload,
  test,
  shard,
  gate,
  deploy,
  'agent-config': agentConfig,
};

/** One invocation. Never throws: every failure is a printed sentence and an exit code. */
export async function run(
  argv: readonly string[],
  io: Io & { err: (line: string) => void },
): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
    io.out(HELP);
    return name === undefined ? EXIT.usage : EXIT.ok;
  }
  const command = COMMANDS[name];
  if (command === undefined) {
    io.err(`Unknown command: ${name}\n\n${HELP}`);
    return EXIT.usage;
  }
  try {
    return await command(rest, io);
  } catch (error) {
    if (error instanceof CliError) {
      io.err(error.message);
      return error.exitCode;
    }
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.refused;
  }
}
