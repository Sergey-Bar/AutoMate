/**
 * Process-tree termination approaches (spike S4). Throwaway prototype code.
 *
 * Ways to end a command and everything it started. The first three were measured on Windows:
 *
 * - `naive-kill`: signal the child only. This is what `apps/runner/src/generic-spawn.ts`
 *   does today (`child.kill('SIGTERM')`), and it is here as the baseline to show why it is
 *   not enough.
 * - `taskkill-tree`: the operating system's `taskkill /T /F`, which walks the parent
 *   relationships that exist at the moment it runs.
 * - `job-object`: start the command inside a Windows Job Object configured to kill every
 *   member when it closes. Needs a helper process; here a PowerShell launcher.
 * - `process-group` (POSIX only, written and not run on the host this was built on): start
 *   the command as the leader of its own process group and signal the whole group.
 *
 * Child stdio is ignored unless the caller passes file descriptors: in the sandbox this was
 * written in, a piped child hangs the parent, so the runner redirects output to files.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

export const APPROACHES = ['naive-kill', 'taskkill-tree', 'job-object', 'process-group'];

const LAUNCHER = path.resolve(import.meta.dirname, 'job-launcher.ps1');

/**
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnOptions} [options]
 * @returns {Promise<number | null>} the exit code
 */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true, ...options });
    child.once('error', () => resolve(null));
    child.once('exit', (code) => resolve(code));
  });
}

/**
 * Starts a command under one of the approaches.
 *
 * @param {{ approach: string, file: string, args: string[], detached?: boolean,
 *   stdio?: import('node:child_process').StdioOptions, cwd?: string,
 *   env?: Record<string, string>,
 *   options?: import('node:child_process').SpawnOptions }} request
 * @returns {{ pid: number | undefined, exited: Promise<number | null>,
 *   terminate: () => Promise<{ taskkillExit: number | null }> }}
 */
export function launch(request) {
  const verbatim = request.options?.windowsVerbatimArguments === true;
  const target =
    request.approach === 'job-object'
      ? {
          file: 'powershell.exe',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            LAUNCHER,
            JSON.stringify(
              verbatim
                ? { file: request.file, raw: request.args.join(' ') }
                : { file: request.file, args: request.args },
            ),
          ],
        }
      : { file: request.file, args: request.args };

  const child = spawn(target.file, target.args, {
    stdio: request.stdio ?? 'ignore',
    windowsHide: true,
    detached: request.detached === true || request.approach === 'process-group',
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    ...(request.env === undefined ? {} : { env: request.env }),
    ...(request.approach === 'job-object' ? {} : request.options),
    ...(verbatim && request.approach !== 'job-object' ? { windowsVerbatimArguments: true } : {}),
  });
  const exited = new Promise((resolve) => {
    child.once('error', () => resolve(null));
    child.once('exit', (code) => resolve(code));
  });

  return {
    pid: child.pid,
    exited,
    async terminate() {
      if (request.approach === 'naive-kill') {
        child.kill();
        return { taskkillExit: null };
      }
      if (request.approach === 'process-group') {
        try {
          process.kill(-(child.pid ?? 0), 'SIGKILL');
        } catch {
          child.kill('SIGKILL');
        }
        return { taskkillExit: null };
      }
      if (request.approach === 'job-object') {
        // Ending the launcher closes the only handle to the job, and the job kills its members.
        child.kill();
        return { taskkillExit: null };
      }
      const taskkillExit = await run('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      return { taskkillExit };
    },
  };
}
