import {
  TUI_COMMANDS,
  TUI_COMMAND_REQUIREMENTS,
  TuiCommandSchema,
  type TuiCommand,
  type TuiCommandName,
} from '@automate/shared-contracts';

/**
 * The command line, as pure functions.
 *
 * ## Why this is not in `main.ts`
 *
 * `main.ts` is a **process entry point**: it reads `argv`, writes to `stdout`, and
 * calls `process.exit`. Testing it means either running it as a subprocess — which
 * needs a server to talk to — or mocking three globals at once. The alternative, and
 * the one used here, is to keep the decision-making in this file and let `main.ts`
 * be a shim that does the I/O.
 *
 * The argument this replaces is "an entry point is exempt from coverage". It is not
 * exempt, it is *hard to reach*, and moving logic out of it is the fix rather than
 * an exclusion row.
 */

/** A missing required argument, named. */
export class MissingArgumentError extends Error {
  constructor(
    readonly command: string,
    readonly field: string,
  ) {
    super(`Missing required argument "${field}" for ${command}`);
    this.name = 'MissingArgumentError';
  }
}

/**
 * Builds one command from `argv`, refusing a missing or unknown one.
 *
 * Refused **here** rather than sent as `undefined`, so the operator is told which
 * argument they forgot instead of receiving a 400 that says the body is malformed.
 * Parsed through `TuiCommandSchema` as well, because `main` is the layer an
 * operator's keystrokes reach first and a bad argument should not become a request.
 */
export function buildCommand(name: string, args: readonly string[]): TuiCommand {
  if (!isKnownCommand(name)) throw new UnknownCommandError(name);
  const requirement = TUI_COMMAND_REQUIREMENTS[name];
  const fields: Record<string, unknown> = { command: name };
  requirement.fields.forEach((field, index) => {
    const value = args[index];
    if (value === undefined) throw new MissingArgumentError(name, field);
    fields[field] = value;
  });
  return TuiCommandSchema.parse(fields);
}

export class UnknownCommandError extends Error {
  constructor(readonly requested: string) {
    super(`Unknown command "${requested}"`);
    this.name = 'UnknownCommandError';
  }
}

export function isKnownCommand(name: string): name is TuiCommandName {
  return (TUI_COMMANDS as readonly string[]).includes(name);
}

/**
 * The help text.
 *
 * Ends with the sentence that matters: **this terminal has no shell**. A reader
 * deciding whether to trust it with a repository path deserves to be told the
 * answer before they look for the flag that would change it.
 */
export function printUsage(): string[] {
  const lines = ['automate-tui <command> [arguments]', '', 'Commands:'];
  for (const [name, requirement] of Object.entries(TUI_COMMAND_REQUIREMENTS)) {
    const args = requirement.fields.length > 0 ? ` (${requirement.fields.join(' ')})` : '';
    lines.push(`  ${name.padEnd(16)} ${requirement.label}${args}`);
  }
  lines.push('', 'This terminal runs registered commands only. It has no shell.');
  return lines;
}
