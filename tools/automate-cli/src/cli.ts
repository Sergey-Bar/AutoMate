import { agentConfig, deploy, gate, upload, type Io } from './commands.js';
import { CliError, EXIT, type ExitCode } from './errors.js';

export const HELP = `automate — send CI evidence to an AutoMate install.

Usage:
  automate upload --format <format> --file <path> [--branch <b>] [--commit <sha>] [--digest sha256:<hex>]
  automate gate --branch <b> --commit <sha> [--pr <number>]
  automate deploy --environment <name> --status success|failure [--sha <sha>] [--id <id>] [--url <url>]
  automate agent-config [--branch <b>] [--commit <sha>] [--dir <path>]

Every command takes --project <id>, or reads AUTOMATE_PROJECT.
Environment: AUTOMATE_URL (https://, or http:// to loopback only), AUTOMATE_TOKEN (amt_…).
Exit codes: 0 done or gate passed, 1 gate failed, 2 usage, 3 refused or unreachable, 4 credential refused.`;

const COMMANDS: Readonly<Record<string, (argv: readonly string[], io: Io) => Promise<ExitCode>>> = {
  upload,
  gate,
  deploy,
  'agent-config': agentConfig,
};

/** One invocation. Never throws: every failure is a printed sentence and an exit code. */
export async function run(
  argv: readonly string[],
  io: Io & { err: (line: string) => void },
): Promise<ExitCode> {
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
