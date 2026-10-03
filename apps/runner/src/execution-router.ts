import type { GenericCommand } from './generic-spawn.js';
import {
  RunnerConfigurationError,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
} from './execution.js';

/**
 * Chooses the executor for a job, from the shape of the job itself.
 *
 * Two modes, one seam. `PlaywrightExecutionAdapter` drives a browser suite with an
 * allowlist of projects and target origins; `GenericSpawnAdapter` runs a declared
 * argv in a registered repository. Which one runs is decided by **which keys the
 * job's `configuration` carries**, and there is no third mode and no fallback: a
 * job with neither key is a configuration failure, not something to guess at.
 *
 * Guessing would be the dangerous failure. A job that arrived with a malformed
 * command and fell back to "run Playwright" would execute the wrong suite against
 * the wrong target and report it as the operator's intent.
 */
export class RoutingExecutionAdapter implements ExecutionProvider {
  constructor(
    private readonly generic: ExecutionProvider,
    private readonly playwright: ExecutionProvider,
  ) {}

  async execute(context: ExecutionContext): Promise<ExecutionResult> {
    const command = (context as { command?: GenericCommand }).command;
    if (command === undefined) return this.playwright.execute(context);
    if (context.playwrightProject !== undefined) {
      throw new RunnerConfigurationError(
        'A job cannot declare both a generic command and a Playwright project',
      );
    }
    return this.generic.execute({ ...context, command });
  }

  async cleanup(workspacePath: string): Promise<void> {
    await this.generic.cleanup?.(workspacePath);
  }
}

/**
 * Reads a generic command out of a job's `configuration`.
 *
 * Parsed against `RunCommandSchema` rather than cast, because a job spec arrives
 * from a database and from other runners: a malformed argv would otherwise reach
 * `spawn` as something the operator never wrote. The parse is the boundary where
 * a bad row becomes a `CONFIG_FAILED` instead of a process spawn.
 */
export function readGenericCommand(
  configuration: Record<string, unknown>,
): GenericCommand | undefined {
  const raw = configuration['command'];
  if (raw === undefined || raw === null) return undefined;
  const record =
    typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (record === null) {
    throw new RunnerConfigurationError('Job command must be an object');
  }
  const argv = readArgv(record);
  return {
    argv,
    workingDirectory:
      typeof record['workingDirectory'] === 'string' ? record['workingDirectory'] : '.',
    artifactGlobs: readGlobs(record),
    env: resolveDeclaredEnvironment(record['env']),
  };
}

/**
 * The argv, or a refusal.
 *
 * Extracted because it is the only part of this function that can **throw**, and
 * folding a guard into the middle of an object literal is how the throwing path ends
 * up three branches deep and unreadable. A malformed argv would otherwise reach
 * `spawn` as something no operator wrote, and `spawn` does not validate.
 */
function readArgv(record: Record<string, unknown>): string[] {
  const argv = record['argv'];
  if (
    !Array.isArray(argv) ||
    argv.length === 0 ||
    argv.some((part) => typeof part !== 'string' || part.length === 0)
  ) {
    throw new RunnerConfigurationError('Job command must declare a non-empty argv of strings');
  }
  return argv as string[];
}

/** Only the string globs. A number or `null` in the list is dropped, not forwarded. */
function readGlobs(record: Record<string, unknown>): string[] {
  const globs = record['artifactGlobs'];
  if (!Array.isArray(globs)) return [];
  return globs.filter((glob): glob is string => typeof glob === 'string');
}

/**
 * Named variables, resolved from the **runner's** environment.
 *
 * The spec names a variable; the runner supplies its value. That is the whole point:
 * a spec that could carry a credential would be a credential in a database row, and
 * a variable that is unset is **omitted** rather than forwarded empty — a child
 * receiving `TOKEN=` cannot be distinguished from one receiving no `TOKEN` at all,
 * which is a failure the child cannot report and the operator cannot see.
 */
function resolveDeclaredEnvironment(declared: unknown): Record<string, string> {
  if (!Array.isArray(declared)) return {};
  const environment: Record<string, string> = {};
  for (const name of declared) {
    if (typeof name !== 'string' || name.length === 0) continue;
    const value = process.env[name];
    if (value !== undefined && value.length > 0) environment[name] = value;
  }
  return environment;
}
