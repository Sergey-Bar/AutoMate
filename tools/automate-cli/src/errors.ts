/**
 * Exit codes. A CI step reads only the number, so each one means exactly one thing.
 *
 * - `0` — done; for `gate`, the gate passed.
 * - `1` — the gate failed. Nothing went wrong: the answer was no.
 * - `2` — the command line or the environment is wrong; nothing was sent.
 * - `3` — the server refused the request, or could not be reached.
 * - `4` — the credential was refused (401 or 403).
 */
export const EXIT = {
  ok: 0,
  gateFailed: 1,
  usage: 2,
  refused: 3,
  unauthorised: 4,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/** A failure with the exit code it maps to and a sentence safe to print. */
export class CliError extends Error {
  override readonly name = 'CliError';
  constructor(
    message: string,
    readonly exitCode: ExitCode,
  ) {
    super(message);
  }
}

export const usage = (message: string): CliError => new CliError(message, EXIT.usage);
