import { describe, expect, it } from 'vitest';
import { RunnerConfigurationError } from './execution.js';
import { resolveSpawn } from './windows-command.js';

const ENV = { PATH: 'C:\\bin;;C:\\node', PATHEXT: '.COM;.EXE;.CMD', ComSpec: 'C:\\W\\cmd.exe' };
const on =
  (...files: string[]) =>
  (candidate: string) =>
    files.includes(candidate);

describe('resolving a command on Windows', () => {
  it('leaves every other platform exactly as it was', () => {
    expect(resolveSpawn('pnpm', ['run', 'a b'], ENV, 'linux', on())).toEqual({
      command: 'pnpm',
      args: ['run', 'a b'],
      verbatim: false,
    });
  });

  it('spawns an executable by its full path, with the argv untouched', () => {
    expect(resolveSpawn('node', ['a b', '&'], ENV, 'win32', on('C:\\node\\node.EXE'))).toEqual({
      command: 'C:\\node\\node.EXE',
      args: ['a b', '&'],
      verbatim: false,
    });
  });

  it('wraps a batch shim in cmd.exe with AutoRun off, quoting the shim path', () => {
    const resolved = resolveSpawn(
      'pnpm',
      ['run', 'test:e2e'],
      { ...ENV, PATH: 'C:\\Program Files (x86)\\node' },
      'win32',
      on('C:\\Program Files (x86)\\node\\pnpm.CMD'),
    );
    expect(resolved).toEqual({
      command: 'C:\\W\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\Program Files (x86)\\node\\pnpm.CMD" run test:e2e"'],
      verbatim: true,
    });
  });

  it('refuses an argument cmd.exe would interpret, rather than handing it a command line', () => {
    for (const argument of ['a&calc', 'a b', '"x"', '%PATH%', 'x|y', 'a^b']) {
      expect(() =>
        resolveSpawn('pnpm', ['run', argument], ENV, 'win32', on('C:\\bin\\pnpm.CMD')),
      ).toThrow(RunnerConfigurationError);
    }
  });

  it('refuses a shim whose own path carries a metacharacter', () => {
    expect(() => resolveSpawn('C:\\a&b\\x.cmd', [], ENV, 'win32', on('C:\\a&b\\x.cmd'))).toThrow(
      /path contains a character/u,
    );
  });

  it('resolves an explicit path and a bare shim with no arguments', () => {
    expect(resolveSpawn('C:\\bin\\tool', [], ENV, 'win32', on('C:\\bin\\tool.CMD'))).toEqual({
      command: 'C:\\W\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\bin\\tool.CMD""'],
      verbatim: true,
    });
  });

  it('falls back to the bare command when nothing on PATH matches, so ENOENT names it', () => {
    expect(resolveSpawn('ghost', ['x'], { Path: 'C:\\bin' }, 'win32', on())).toEqual({
      command: 'ghost',
      args: ['x'],
      verbatim: false,
    });
    expect(resolveSpawn('make.exe', [], {}, 'win32', on()).command).toBe('make.exe');
    // A command that already names its extension is looked for as written.
    expect(
      resolveSpawn('run.bat', [], { PATH: 'C:\\bin' }, 'win32', on('C:\\bin\\run.bat')),
    ).toEqual({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\bin\\run.bat""'],
      verbatim: true,
    });
  });
});
