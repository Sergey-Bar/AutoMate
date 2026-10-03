import { describe, expect, it } from 'vitest';
import { TUI_COMMANDS, TUI_COMMAND_REQUIREMENTS } from '@automate/shared-contracts';
import {
  buildCommand,
  isKnownCommand,
  MissingArgumentError,
  printUsage,
  UnknownCommandError,
} from './command-line.js';

/**
 * The command line, which is where `main.ts` keeps its decisions.
 *
 * These are the assertions a subprocess test could not make cleanly: `main` writes
 * to `stdout` and calls `process.exit`, so every one of its interesting behaviours is
 * unreachable without spawning a process and reading its output. Here they are
 * ordinary function calls, and the **behaviour** — not the printing — is what is
 * asserted.
 */

describe('a command is built from its named arguments', () => {
  it('pairs each declared field with the argument in that position', () => {
    expect(buildCommand('run.start', ['project-1', 'node.test', 'key-1'])).toMatchObject({
      command: 'run.start',
      projectId: 'project-1',
      commandId: 'node.test',
      idempotencyKey: 'key-1',
    });
  });

  it('builds a command with no arguments', () => {
    expect(buildCommand('projects.list', [])).toEqual({ command: 'projects.list' });
  });

  it('names the argument that is missing, rather than sending a partial body', () => {
    // A 400 from the API would say "malformed body"; this says "you forgot the
    // commandId". The difference is whether the operator can act on the message.
    try {
      buildCommand('run.start', ['project-1']);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingArgumentError);
      expect((error as MissingArgumentError).field).toBe('commandId');
      expect((error as MissingArgumentError).command).toBe('run.start');
    }
  });

  it('refuses a command this build has never heard of', () => {
    expect(() => buildCommand('exec', ['rm', '-rf', '/'])).toThrow(UnknownCommandError);
  });

  it('answers "is this a command" without throwing', () => {
    for (const command of TUI_COMMANDS) {
      expect(isKnownCommand(command), command).toBe(true);
    }
    expect(isKnownCommand('exec')).toBe(false);
    expect(isKnownCommand('')).toBe(false);
  });

  it('ignores extra arguments rather than passing them through', () => {
    // `automate-tui score.get project-1 --shell` must not smuggle a flag into the
    // body. The command takes exactly the fields it declares and the rest is not
    // ours to forward — a CLI that echoed unknown flags into a request is a CLI whose
    // request shape depends on the user's shell completion.
    expect(buildCommand('score.get', ['project-1', '--shell', 'rm'])).toEqual({
      command: 'score.get',
      projectId: 'project-1',
    });
  });
});

describe('the help text says the thing a reader most needs to know', () => {
  const lines = printUsage();

  it('lists every registered command', () => {
    for (const name of TUI_COMMANDS) {
      expect(
        lines.some((line) => line.includes(name)),
        name,
      ).toBe(true);
    }
  });

  it("shows each command's arguments", () => {
    const start = lines.find((line) => line.includes('run.start')) ?? '';
    expect(start).toContain('projectId commandId idempotencyKey');
  });

  it('states that there is no shell, before the reader goes looking for one', () => {
    expect(lines[lines.length - 1]).toMatch(/no shell/iu);
  });

  it('labels a command that takes no arguments without an empty parenthesis', () => {
    // `projects.list ()` is noise; the label alone is the sentence.
    const start = lines.find((line) => line.includes('projects.list')) ?? '';
    expect(start).not.toContain('()');
  });

  it('uses the label the requirements table declares, not a second copy', () => {
    for (const [name, requirement] of Object.entries(TUI_COMMAND_REQUIREMENTS)) {
      expect(
        lines.some((line) => line.includes(requirement.label)),
        name,
      ).toBe(true);
    }
  });
});
