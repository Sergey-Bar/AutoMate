import { describe, expect, it } from 'vitest';
import {
  TUI_CAPABILITIES,
  TUI_COMMANDS,
  TUI_COMMAND_REQUIREMENTS,
  TuiCommandNameSchema,
  TuiCommandSchema,
  TuiViewSchema,
} from './tui-commands.js';

/**
 * The TUI's whole action surface.
 *
 * The property under test is **bounded**: a terminal in a multi-repo install holds a
 * repository path, so an unbounded action surface is an RCE surface. Every test here
 * is about that — that the set of things a key press can do is enumerable, that
 * nothing in it can name an executable, and that the limits are declared rather than
 * implied.
 */

describe('the command registry is the whole design', () => {
  it('enumerates every action, and the table covers all of them', () => {
    // The union and the requirements table are two declarations of one set. A
    // command added to the union without a row would render with no label and no
    // declared fields, which is a command nobody can discover.
    expect(Object.keys(TUI_COMMAND_REQUIREMENTS).sort()).toEqual([...TUI_COMMANDS].sort());
  });

  it('rejects a command this build has never heard of', () => {
    // Not `undefined` and not ignored. An unknown action reaching the server would
    // be a key press that does something nobody can name.
    expect(TuiCommandNameSchema.safeParse('run.shell').success).toBe(false);
    expect(TuiCommandSchema.safeParse({ command: 'exec' }).success).toBe(false);
  });

  it('has no field anywhere that could carry an executable', () => {
    // The whole security argument, asserted rather than asserted-to. A `command`
    // string or an `argv` array on this schema would be the raw-shell passthrough
    // the design exists to refuse, and it would compile.
    const fields = Object.keys(TuiCommandSchema.shape);
    expect(fields).not.toContain('argv');
    expect(fields).not.toContain('args');
    expect(fields).not.toContain('shell');
    expect(fields).not.toContain('script');
    // `command` is the *name* of an action, and the schema pins it to the enum.
    expect(TuiCommandSchema.shape.command).toBe(TuiCommandNameSchema);
  });

  it('starts a run by command id and idempotency key, never by anything executable', () => {
    const required = TUI_COMMAND_REQUIREMENTS['run.start'].fields;
    expect(required).toContain('commandId');
    expect(required).toContain('idempotencyKey');
    // No argv among the fields a run needs. The keypress names a command the
    // **server** resolved from the stored profile.
    expect(required).not.toContain('argv');
    expect(required).not.toContain('workingDirectory');
  });

  it('requires a reason on every stop', () => {
    // An interruption with no recorded reason is an interruption nobody can tell
    // apart from a crash.
    expect(TUI_COMMAND_REQUIREMENTS['run.stop'].fields).toContain('reason');
    expect(TuiCommandSchema.safeParse({ command: 'run.stop', runId: 'r' }).success).toBe(true);
  });

  it('names every required field in the label set, so the handler and the UI agree', () => {
    for (const [name, requirement] of Object.entries(TUI_COMMAND_REQUIREMENTS)) {
      for (const field of requirement.fields) {
        expect(
          Object.keys(TuiCommandSchema.shape),
          `${name} needs ${field}, which is not a field of the command`,
        ).toContain(field);
      }
      expect(requirement.label.length, name).toBeGreaterThan(0);
    }
  });

  it('restricts a project slug to something safe for a path and a URL', () => {
    // A slug that could carry `..` becomes a directory traversal in one install and
    // a URL segment in another, and no caller should have to sanitise it twice.
    expect(
      TuiCommandSchema.safeParse({
        command: 'project.add',
        name: 'a',
        slug: '../etc',
        repoPath: '/r',
      }).success,
    ).toBe(false);
    expect(
      TuiCommandSchema.safeParse({
        command: 'project.add',
        name: 'a',
        slug: 'ok-1_2.3',
        repoPath: '/r',
      }).success,
    ).toBe(true);
  });

  it('bounds a question and a reason, so neither can become a payload', () => {
    expect(
      TuiCommandSchema.safeParse({ command: 'copilot.ask', question: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(
      TuiCommandSchema.safeParse({ command: 'run.stop', runId: 'r', reason: 'x'.repeat(501) })
        .success,
    ).toBe(false);
  });
});

describe('a rendered view names its limiter', () => {
  it('refuses to carry a total without the row that capped it', () => {
    // The same clause the HTTP contract carries, for the same reason: a weighted
    // geometric total cannot be diluted by a zero, and for exactly that reason it
    // cannot be diagnosed either.
    expect(TuiViewSchema.safeParse({ command: 'score.get', total: 62, rows: [] }).success).toBe(
      false,
    );
  });

  it('accepts a total with its limiter', () => {
    const view = TuiViewSchema.parse({
      command: 'score.get',
      projectId: 'project-1',
      total: 62,
      cappedBy: 'security',
      rows: [{ key: 'unit:backend', title: 'unit / backend', detail: '0.84' }],
    });
    expect(view.rows).toHaveLength(1);
  });

  it('keys rows rather than numbering them', () => {
    // A positional list makes "select row 3" mean whatever is now third. A key does
    // not move when the list is re-sorted.
    const view = TuiViewSchema.parse({
      command: 'gaps.get',
      rows: [{ key: 'security:backend', title: 'a', detail: 'b' }],
      selected: ['security:backend'],
    });
    expect(view.selected).toEqual(['security:backend']);
  });
});

describe('the limits are declared, not implied', () => {
  it('says plainly that there is no raw shell and no arbitrary commands', () => {
    // A terminal that hides its own limits is asking the reader to trust it, and
    // `no-second-authority` is as true of a UI as of a database. These are asserted
    // as `false` rather than merely being absent, so adding one is a **failing
    // test**, not a silent capability.
    expect(TUI_CAPABILITIES.rawShell).toBe(false);
    expect(TUI_CAPABILITIES.arbitraryCommands).toBe(false);
    expect(TUI_CAPABILITIES.resolvesCommandsServerSide).toBe(true);
  });
});
