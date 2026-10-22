import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TuiView } from '@automate/shared-contracts';

/**
 * The entry point, run in-process.
 *
 * `main.ts` reads `argv`, writes to two streams and calls `process.exit`, all at module
 * scope. `command-line.ts` holds its decisions and is tested on its own; what is
 * asserted here is the wiring — which stream a message goes to, which exit code an
 * operator's script sees, and that the request is the one the command named.
 *
 * **`process.exit` throws instead of exiting.** A real exit would end the test worker.
 * Throwing a marker stops the module at exactly the line that would have exited, so
 * every assertion below is about what had happened by then and nothing after it.
 */

class ExitSignal extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

const SCORE: TuiView = {
  command: 'score.get',
  projectId: 'project-1',
  total: 62,
  cappedBy: 'security',
  rows: [{ key: 'security', row: 'security', title: 'security / backend', detail: '0.00' }],
  selected: [],
};

let stdout: string[];
let stderr: string[];
const originalArgv = process.argv;

beforeEach(() => {
  stdout = [];
  stderr = [];
  vi.resetModules();
  vi.spyOn(process, 'exit').mockImplementation((code?: number | string | null) => {
    throw new ExitSignal(code);
  });
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr.push(String(chunk));
    return true;
  });
  vi.stubEnv('AUTOMATE_API_URL', 'http://api.test');
});

afterEach(() => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** Runs `automate-tui ...args` and resolves to the exit code, or `undefined` if it did not exit. */
async function run(...args: string[]): Promise<number | string | null | undefined> {
  process.argv = ['node', 'automate-tui', ...args];
  try {
    await import('./main.js');
    return undefined;
  } catch (error) {
    if (error instanceof ExitSignal) return error.code;
    throw error;
  }
}

/** A `fetch` that answers every request with `body` and records the URLs it was asked for. */
function answer(body: unknown, status = 200): string[] {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    urls.push(String(input));
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  });
  return urls;
}

describe('with no command, or asking for help', () => {
  it('prints the usage to stdout and exits 1 when nothing was asked', async () => {
    expect(await run()).toBe(1);
    expect(stdout.join('')).toMatch(/no shell/iu);
    expect(stderr).toEqual([]);
  });

  it('exits 0 when help was asked for, because that is not a mistake', async () => {
    expect(await run('--help')).toBe(0);
    expect(await run('-h')).toBe(0);
    expect(stdout.join('')).toContain('automate-tui <command>');
  });
});

describe('a command the build does not know', () => {
  it('names it on stderr, prints the usage there too, and exits 2 before any request', async () => {
    const urls = answer(SCORE);
    expect(await run('exec', 'rm', '-rf', '/')).toBe(2);
    expect(stderr[0]).toBe('Unknown command "exec".\n\n');
    expect(stderr.join('')).toMatch(/no shell/iu);
    expect(stdout).toEqual([]);
    expect(urls).toEqual([]);
  });
});

describe('a known command', () => {
  it('sends the request the command names and renders a score with its limiter', async () => {
    const urls = answer(SCORE);
    expect(await run('score.get', 'project-1')).toBeUndefined();
    expect(urls).toEqual(['http://api.test/api/v1/projects/project-1/qa/score']);
    expect(stdout[0]).toBe('Score 62.0/100 — capped by security\n');
    expect(stdout.join('')).toContain('security / backend');
  });

  it('renders a list with no total as one line per row', async () => {
    answer({
      command: 'projects.list',
      rows: [{ key: 'p1', title: 'web-app', detail: 'registered' }],
      selected: [],
    });
    expect(await run('projects.list')).toBeUndefined();
    expect(stdout).toEqual([`  ${'web-app'.padEnd(40)}registered\n`]);
  });

  it('names a missing argument on stderr and exits 2 without sending anything', async () => {
    const urls = answer(SCORE);
    expect(await run('score.get')).toBe(2);
    expect(stderr[0]).toBe('Missing required argument "projectId" for score.get\n\n');
    expect(urls).toEqual([]);
  });

  it("prints the API's own error body and exits 1", async () => {
    answer('{"error":{"message":"no such project"}}', 404);
    expect(await run('score.get', 'missing')).toBe(1);
    expect(stderr.join('')).toBe('API answered 404\n{"error":{"message":"no such project"}}\n');
  });

  it('lets a failure it has no words for escape, rather than exiting as if it had', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network down');
    });
    await expect(run('projects.list')).rejects.toThrow('network down');
    expect(process.exit).not.toHaveBeenCalled();
  });
});

describe('where the request goes, and who it says it is', () => {
  /** Like nswer, but also records the Authorization header of each request. */
  function answerCapturingAuth(): { urls: string[]; auth: Array<string | undefined> } {
    const seen = { urls: [] as string[], auth: [] as Array<string | undefined> };
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      seen.urls.push(String(input));
      seen.auth.push((init?.headers as Record<string, string> | undefined)?.['authorization']);
      return new Response(JSON.stringify(SCORE), { status: 200 });
    });
    return seen;
  }

  it('talks to the loopback API on port 3000 when no URL is configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('AUTOMATE_API_URL', undefined as unknown as string);
    delete process.env['AUTOMATE_API_URL'];
    const seen = answerCapturingAuth();
    expect(await run('score.get', 'p1')).toBeUndefined();
    expect(seen.urls).toEqual(['http://127.0.0.1:3000/api/v1/projects/p1/qa/score']);
  });

  it('sends the bearer token from the environment, and none when it is unset', async () => {
    vi.stubEnv('AUTOMATE_API_TOKEN', 'operator-token');
    const withToken = answerCapturingAuth();
    await run('score.get', 'p1');
    expect(withToken.auth).toEqual(['Bearer operator-token']);

    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('AUTOMATE_API_URL', 'http://api.test');
    delete process.env['AUTOMATE_API_TOKEN'];
    const withoutToken = answerCapturingAuth();
    await run('score.get', 'p1');
    expect(withoutToken.auth).toEqual([undefined]);
  });

  it('prints a score and then its gap rows, separated by a blank line', async () => {
    answer({ ...SCORE, rows: [{ key: 'k', row: 'unit', title: 'a gap', detail: '0.50' }] });
    await run('score.get', 'p1');
    const lines = stdout.join('').split('\n');
    expect(lines[0]).toBe('Score 62.0/100 \u2014 capped by security');
    expect(lines).toContain('');
    expect(lines).toContain('  a gap  0.50');
  });
});
