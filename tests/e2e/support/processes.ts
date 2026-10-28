/**
 * Real `apps/api`, `apps/worker` and `apps/runner` processes for the specs that must not stand
 * in for them.
 *
 * Every other spec in this suite plays the runner itself over HTTP, which proves the API's half
 * of the protocol and says nothing about whether the shipped runner speaks it. A spec that needs
 * the shipped processes starts them here, against the same API and the same PostgreSQL the
 * Playwright `webServer` is running, and stops them in a `finally`. The profile matrix starts
 * the API itself the same way, once per deployment profile, beside the suite's own.
 *
 * They run the TypeScript sources under `tsx` rather than `dist/`, which is what
 * `pnpm --filter @automate/worker dev` runs and what `playwright.config.ts` already does for the
 * API, so nothing here depends on a build step the suite does not perform.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export interface ServiceHandle {
  readonly name: string;
  /** The TCP port the service's health server bound (it is asked for port 0). */
  readonly port: number;
  /** Everything the process has written so far, for a failure message. */
  output(): string;
  stop(): Promise<void>;
}

/** A started process, what it has written, and whether and how it has exited. */
interface Spawned {
  readonly child: ChildProcess;
  output(): string;
  exited(): boolean;
  exitCode(): number | null;
}

/**
 * Start `entry` in `apps/<app>` under `tsx`.
 *
 * @param env the whole environment of the child: nothing is inherited, so a variable the
 *   service reads that this call does not name is absent, not silently taken from the developer's
 *   shell
 */
function spawnApp(
  app: 'api' | 'worker' | 'runner',
  entry: string,
  env: Record<string, string>,
): Spawned {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    cwd: path.join(REPOSITORY_ROOT, 'apps', app),
    env: { PATH: process.env['PATH'] ?? '', SystemRoot: process.env['SystemRoot'] ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let captured = '';
  const collect = (chunk: Buffer): void => {
    captured += chunk.toString('utf8');
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let exited = false;
  let code: number | null = null;
  child.once('exit', (status) => {
    exited = true;
    code = status;
  });

  return { child, output: () => captured, exited: () => exited, exitCode: () => code };
}

/**
 * Start `apps/<app>/src/main.ts` and resolve once it has said where it is listening and answered
 * its readiness probe.
 *
 * @param app the directory under `apps/`
 * @param env the whole environment of the child, as {@link spawnApp} takes it
 */
export async function startService(
  app: 'worker' | 'runner',
  env: Record<string, string>,
): Promise<ServiceHandle> {
  const name = `apps/${app}`;
  const { child, output, exited } = spawnApp(app, 'src/main.ts', env);

  const port = await waitForListening(child, output, exited, name);
  await waitForReady(port, exited, output, name);

  return {
    name,
    port,
    output,
    stop: () => terminate(child, exited),
  };
}

export interface ApiHandle {
  /** `http://127.0.0.1:<PORT>`, from the `PORT` it was given. */
  readonly url: string;
  /** Everything the process has written so far, for a failure message. */
  output(): string;
  stop(): Promise<void>;
}

/**
 * Start `apps/api/src/index.ts`, the API's own entry point, with exactly `env`, and resolve once
 * `/api/v1/health` answers. `env` must name `PORT`: the API refuses port 0, so the caller picks
 * one that nothing else in the suite binds.
 */
export async function startApi(env: Record<string, string>): Promise<ApiHandle> {
  const { child, output, exited } = spawnApp('api', 'src/index.ts', env);
  const url = `http://127.0.0.1:${env['PORT'] ?? ''}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !exited()) {
    try {
      if ((await fetch(`${url}/api/v1/health`)).ok) {
        return { url, output, stop: () => terminate(child, exited) };
      }
    } catch {
      // not accepting connections yet
    }
    await sleep(250);
  }
  await terminate(child, exited);
  throw new Error(
    `apps/api never answered ${url}/api/v1/health (exited: ${String(exited())}):\n${output()}`,
  );
}

/**
 * Start the API with `env` and wait for it to refuse to start: its exit status and everything it
 * wrote. An API that starts listening instead is stopped and reported, because a refusal that
 * does not happen is the failure this exists to catch.
 */
export async function bootRefusal(
  env: Record<string, string>,
): Promise<{ code: number | null; output: string }> {
  const { child, output, exited, exitCode } = spawnApp('api', 'src/index.ts', env);
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline && !exited()) {
    if (/listening on http:/u.test(output())) {
      await terminate(child, exited);
      throw new Error(`apps/api started although it should have refused to:\n${output()}`);
    }
    await sleep(100);
  }
  if (!exited()) {
    await terminate(child, exited);
    throw new Error(`apps/api neither started nor refused within 90 s:\n${output()}`);
  }
  return { code: exitCode(), output: output() };
}

async function waitForListening(
  child: ChildProcess,
  read: () => string,
  hasExited: () => boolean,
  name: string,
): Promise<number> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const match = /listening on http:\/\/[^:\s]+:(\d+)/u.exec(read());
    if (match?.[1] !== undefined) return Number(match[1]);
    if (hasExited()) break;
    await sleep(100);
  }
  child.kill();
  throw new Error(`${name} did not start listening (exited: ${String(hasExited())}):\n${read()}`);
}

async function waitForReady(
  port: number,
  hasExited: () => boolean,
  read: () => string,
  name: string,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && !hasExited()) {
    try {
      const response = await fetch(`http://127.0.0.1:${String(port)}/ready`);
      if (response.ok) return;
    } catch {
      // not accepting connections yet
    }
    await sleep(200);
  }
  throw new Error(`${name} never reported ready on port ${String(port)}:\n${read()}`);
}

async function terminate(child: ChildProcess, hasExited: () => boolean): Promise<void> {
  if (hasExited()) return;
  const gone = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill();
  const forced = setTimeout(() => child.kill('SIGKILL'), 10_000);
  await gone;
  clearTimeout(forced);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
