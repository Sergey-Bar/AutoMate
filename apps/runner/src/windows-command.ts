import { existsSync } from 'node:fs';
import { win32 } from 'node:path';
import { RunnerConfigurationError } from './execution.js';

// Windows path rules on every host, so the resolution is the same on a Linux CI runner.
const { extname, join } = win32;

/**
 * Making a shell-less argv runnable on Windows, without giving the shell back.
 *
 * ## The problem
 *
 * `pnpm`, `npm`, `yarn` and `npx` are `.cmd` shims on Windows. `spawn('pnpm', …)` with
 * `shell: false` fails with `ENOENT`, because `CreateProcess` does not consult `PATHEXT`,
 * and since CVE-2024-27980 Node refuses to start a `.cmd` or `.bat` directly at all. So
 * every package-manager script the runner page offers was unrunnable on a Windows host.
 *
 * ## The answer, and its boundary
 *
 * The command is resolved against `PATH` × `PATHEXT` here. An `.exe` or `.com` is spawned
 * directly by its full path, exactly as before. A `.cmd` or `.bat` can only run under
 * `cmd.exe`, so it is wrapped as `cmd.exe /d /s /c ""<shim>" <args>"` — **and every
 * argument must be a plain token** (letters, digits and `_ . : / \ @ = + , -`). Anything
 * `cmd.exe` would interpret — a space, a quote, `& | < > ^ %` — is refused as a
 * configuration error before a process exists. That is what keeps D7 true on this path: an
 * argv still cannot become a command line, because the only arguments that reach the shell
 * are ones the shell has nothing to do with.
 *
 * `/d` skips AutoRun, so a registry-configured startup command cannot run first.
 */
const SAFE_TOKEN = /^[A-Za-z0-9_.:/\\@=+,-]+$/u;
/** A shim's own path is quoted, so spaces and parentheses are fine; the metacharacters are not. */
const UNSAFE_IN_PATH = /["%!^&|<>\r\n]/u;
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/** Variables Windows programs need to start at all, none of which is a secret. */
export const WINDOWS_ENV_ALLOWLIST: readonly string[] = [
  'SystemRoot',
  'windir',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramFiles',
  'ProgramData',
  'HOMEDRIVE',
  'HOMEPATH',
];

export interface ResolvedSpawn {
  command: string;
  args: string[];
  /** True when the args were assembled into one `cmd.exe` line and must not be re-quoted. */
  verbatim: boolean;
}

export function resolveSpawn(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): ResolvedSpawn {
  if (platform !== 'win32') return { command, args: [...args], verbatim: false };
  const resolved = locate(command, env, exists);
  if (resolved === null) return { command, args: [...args], verbatim: false };
  const extension = extname(resolved).toLowerCase();
  if (extension !== '.cmd' && extension !== '.bat') {
    return { command: resolved, args: [...args], verbatim: false };
  }
  if (UNSAFE_IN_PATH.test(resolved)) {
    throw new RunnerConfigurationError(
      `${resolved} is a batch shim whose path contains a character cmd.exe would interpret`,
    );
  }
  const unsafe = args.find((argument) => !SAFE_TOKEN.test(argument));
  if (unsafe !== undefined) {
    throw new RunnerConfigurationError(
      `${command} is a batch shim on Windows, so it runs under cmd.exe, and the argument ` +
        `${JSON.stringify(unsafe)} contains characters cmd.exe would interpret. Wrap it in a ` +
        'package.json script and run the script instead.',
    );
  }
  return {
    command: env['ComSpec'] ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `""${resolved}" ${args.join(' ')}"`.replace(/ "$/u, '"')],
    verbatim: true,
  };
}

function locate(
  command: string,
  env: NodeJS.ProcessEnv,
  exists: (path: string) => boolean,
): string | null {
  const extensions = (env['PATHEXT'] ?? DEFAULT_PATHEXT)
    .split(';')
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0);
  const hasExtension = extname(command).length > 0;
  const candidates = (base: string): string[] =>
    hasExtension ? [base] : [base, ...extensions.map((extension) => `${base}${extension}`)];
  if (/[\\/]/u.test(command)) {
    return (
      candidates(command)
        .slice(hasExtension ? 0 : 1)
        .find((candidate) => exists(candidate)) ?? null
    );
  }
  const directories = (env['PATH'] ?? env['Path'] ?? '')
    .split(';')
    .filter((directory) => directory.length > 0);
  for (const directory of directories) {
    // An extension-less file on PATH is not executable on Windows, so the bare name is
    // only tried when the command already carries an extension.
    const found = candidates(join(directory, command))
      .slice(hasExtension ? 0 : 1)
      .find((candidate) => exists(candidate));
    if (found !== undefined) return found;
  }
  return null;
}
