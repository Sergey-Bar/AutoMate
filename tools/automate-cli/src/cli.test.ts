import { createServer, type IncomingMessage, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HELP, run } from './cli.js';
import { EXIT } from './errors.js';

/** A stub AutoMate: records each request and answers from `reply`. */
interface Seen {
  method: string;
  url: string;
  authorization: string | undefined;
  contentType: string | undefined;
  body: Buffer;
}

let server: Server;
let origin: string;
const seen: Seen[] = [];
let reply: (request: Seen) => { status: number; body: unknown } = () => ({ status: 200, body: {} });

async function read(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

beforeAll(async () => {
  server = createServer((request, response) => {
    void read(request).then((body) => {
      const entry: Seen = {
        method: request.method ?? '',
        url: request.url ?? '',
        authorization: request.headers.authorization,
        contentType: request.headers['content-type'],
        body,
      };
      seen.push(entry);
      const answer = reply(entry);
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(answer.body === undefined ? '' : JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const temporary: string[] = [];
afterEach(async () => {
  seen.length = 0;
  reply = () => ({ status: 200, body: {} });
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const PROJECT = '11111111-1111-4111-8111-111111111111';
// Assembled at runtime, the way `apps/api/src/test-support/synthetic-credentials.ts` builds
// its fixtures (this package cannot import it): a credential-shaped literal is exactly what
// `no-hardcoded-secret-literal` and gitleaks exist to find.
const TOKEN = ['amt_', 'ci', '_uploader_token'].join('');
const SHA = 'abcdef1234567';

async function invoke(
  argv: string[],
  env: Record<string, string | undefined> = {},
  cwd = process.cwd(),
) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, {
    env: { AUTOMATE_URL: origin, AUTOMATE_TOKEN: TOKEN, AUTOMATE_PROJECT: PROJECT, ...env },
    cwd,
    fetch: globalThis.fetch,
    now: () => new Date('2026-10-26T12:00:00.000Z'),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'automate-cli-'));
  temporary.push(dir);
  return dir;
}

describe('automate upload', () => {
  it('posts the report bytes with the format, branch, commit and digest, and the token as a bearer', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'semgrep.sarif'), '{"runs":[]}');
    reply = () => ({ status: 201, body: { findings: { new: 2 }, grade: { letter: 'B' } } });
    const digest = `sha256:${'a'.repeat(64)}`;
    const result = await invoke(
      [
        'upload',
        '--format',
        'sarif',
        '--file',
        'semgrep.sarif',
        '--branch=main',
        '--commit',
        SHA,
        '--digest',
        digest,
      ],
      { GITHUB_WORKSPACE: '/work' },
      dir,
    );
    expect(result).toMatchObject({ code: EXIT.ok });
    expect(result.out).toBe('Uploaded semgrep.sarif as sarif: 2 new finding(s), grade B.');
    const [request] = seen;
    expect(request?.method).toBe('POST');
    const url = new URL(request?.url ?? '', origin);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT}/health/reports`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: 'sarif',
      branch: 'main',
      commit: SHA,
      digest,
      sourceRoot: '/work',
    });
    expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.contentType).toBe('application/octet-stream');
    expect(request?.body.toString()).toBe('{"runs":[]}');
    expect(result.out + result.err).not.toContain(TOKEN);
  });

  it('fails when the scanner wrote nothing, and maps refusals to their exit codes', async () => {
    expect((await invoke(['upload', '--format', 'sarif', '--file', 'missing.sarif'])).code).toBe(
      EXIT.usage,
    );
    const dir = await tempDir();
    await writeFile(path.join(dir, 'r.json'), '{}');
    reply = () => ({
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'This token cannot upload to this project' } },
    });
    const forbidden = await invoke(['upload', '--format', 'k6', '--file', 'r.json'], {}, dir);
    expect(forbidden).toMatchObject({ code: EXIT.unauthorised });
    expect(forbidden.err).toBe('Refused: FORBIDDEN: This token cannot upload to this project');
    reply = () => ({ status: 400, body: { error: { message: 'Invalid upload query' } } });
    expect((await invoke(['upload', '--format', 'nope', '--file', 'r.json'], {}, dir)).err).toBe(
      'Refused: Invalid upload query',
    );
    reply = () => ({ status: 502, body: undefined });
    expect(await invoke(['upload', '--format', 'k6', '--file', 'r.json'], {}, dir)).toMatchObject({
      code: EXIT.refused,
      err: 'Refused: HTTP 502',
    });
    expect(
      (await invoke(['upload', '--format', 'k6', '--file', 'r.json', '--digest', 'md5:x'], {}, dir))
        .code,
    ).toBe(EXIT.usage);
  });
});

describe('automate gate', () => {
  it('exits 0 on a passed gate and 1 on a failed one, printing every reason', async () => {
    reply = () => ({
      status: 200,
      body: { verdict: 'passed', reasons: [], grade: { letter: 'A' } },
    });
    const passed = await invoke(['gate', '--branch', 'feature/x', '--commit', SHA, '--pr', '12']);
    expect(passed).toMatchObject({ code: EXIT.ok, out: 'Gate passed on feature/x — grade A.' });
    expect(JSON.parse(seen[0]?.body.toString() ?? '{}')).toEqual({
      branch: 'feature/x',
      commit: SHA,
      pullRequest: 12,
    });
    expect(new URL(seen[0]?.url ?? '', origin).pathname).toBe(
      `/api/v1/projects/${PROJECT}/health/gate/report`,
    );
    reply = () => ({
      status: 200,
      body: { verdict: 'failed', reasons: ['1 new critical finding'], grade: { letter: null } },
    });
    const failed = await invoke(['gate'], { GITHUB_HEAD_REF: 'pr-branch', GITHUB_SHA: SHA });
    expect(failed.code).toBe(EXIT.gateFailed);
    expect(failed.out).toBe(
      'Gate failed on pr-branch — grade incomplete.\n- 1 new critical finding',
    );
  });

  it('refuses to guess a branch, a commit or a pull request, and an answer with no verdict', async () => {
    expect((await invoke(['gate', '--commit', SHA])).code).toBe(EXIT.usage);
    expect((await invoke(['gate', '--branch', 'main'])).code).toBe(EXIT.usage);
    expect((await invoke(['gate', '--branch', 'main', '--commit', 'not-a-sha'])).code).toBe(
      EXIT.usage,
    );
    expect((await invoke(['gate', '--branch', 'main', '--commit', SHA, '--pr', '0'])).code).toBe(
      EXIT.usage,
    );
    reply = () => ({ status: 200, body: { grade: {} } });
    expect(await invoke(['gate', '--branch', 'main', '--commit', SHA])).toMatchObject({
      code: EXIT.refused,
      err: 'The server answered without a gate verdict.',
    });
    expect(seen).toHaveLength(1);
  });
});

describe('automate deploy', () => {
  it('pushes one deployment through the push door', async () => {
    const result = await invoke(
      [
        'deploy',
        '--environment',
        'production',
        '--status',
        'success',
        '--sha',
        SHA,
        '--rollback',
        '--url',
        'https://ci.example/1',
      ],
      { GITHUB_RUN_ID: '991', GITHUB_RUN_ATTEMPT: '2' },
    );
    expect(result).toMatchObject({ code: EXIT.ok });
    expect(result.out).toBe('Recorded a success deployment to production (production-991-2).');
    expect(new URL(seen[0]?.url ?? '', origin).pathname).toBe(
      `/api/v1/projects/${PROJECT}/delivery/deployments`,
    );
    expect(JSON.parse(seen[0]?.body.toString() ?? '{}')).toEqual({
      externalId: 'production-991-2',
      environment: 'production',
      status: 'success',
      createdAt: '2026-10-26T12:00:00.000Z',
      sha: SHA,
      url: 'https://ci.example/1',
      rollback: true,
    });
    await invoke([
      'deploy',
      '--environment',
      'staging',
      '--status',
      'failure',
      '--created-at',
      '2026-10-25T00:00:00Z',
    ]);
    expect(JSON.parse(seen[1]?.body.toString() ?? '{}')).toMatchObject({
      externalId: 'staging-2026-10-25T00:00:00Z',
      createdAt: '2026-10-25T00:00:00Z',
    });
  });

  it('refuses a status it does not know and a time that is not one', async () => {
    expect((await invoke(['deploy', '--environment', 'p', '--status', 'maybe'])).code).toBe(
      EXIT.usage,
    );
    expect(
      (
        await invoke([
          'deploy',
          '--environment',
          'p',
          '--status',
          'success',
          '--created-at',
          'soon',
        ])
      ).code,
    ).toBe(EXIT.usage);
    expect((await invoke(['deploy', '--status', 'success'])).err).toBe('--environment is required');
    expect(seen).toHaveLength(0);
  });
});

describe('automate agent-config', () => {
  it('collects the agent files under the directory and posts them, skipping dependencies and oversized files', async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'AGENTS.md'), '# rules');
    await mkdir(path.join(dir, '.cursor', 'rules', 'deep'), { recursive: true });
    await writeFile(path.join(dir, '.cursor', 'rules', 'deep', 'style.mdc'), 'be kind');
    await writeFile(path.join(dir, '.mcp.json'), '{"mcpServers":{}}');
    await mkdir(path.join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules', 'pkg', 'AGENTS.md'), 'not ours');
    await mkdir(path.join(dir, 'docs'), { recursive: true });
    await writeFile(path.join(dir, 'docs', 'CLAUDE.md'), 'x'.repeat(256 * 1024 + 1));
    await writeFile(path.join(dir, 'README.md'), 'not an agent file');
    reply = () => ({ status: 201, body: { findings: 1, mcpServers: 0 } });
    const result = await invoke(['agent-config', '--branch', 'main', '--commit', SHA], {}, dir);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toContain('Skipped docs/CLAUDE.md: over the size or file limit.');
    expect(result.out).toContain('Sent 3 agent-config file(s): 1 finding(s), 0 MCP server(s).');
    const body = JSON.parse(seen[0]?.body.toString() ?? '{}') as {
      branch: string;
      commit: string;
      files: Array<{ path: string }>;
    };
    expect(body).toMatchObject({ branch: 'main', commit: SHA });
    expect(body.files.map((file) => file.path)).toEqual([
      '.cursor/rules/deep/style.mdc',
      '.mcp.json',
      'AGENTS.md',
    ]);
    expect(new URL(seen[0]?.url ?? '', origin).pathname).toBe(
      `/api/v1/projects/${PROJECT}/health/agent-config`,
    );
  });

  it('needs a branch', async () => {
    expect((await invoke(['agent-config'])).code).toBe(EXIT.usage);
  });
});

describe('the command line and the environment', () => {
  it('prints help, and refuses an unknown command or option', async () => {
    expect(await invoke(['--help'])).toMatchObject({ code: EXIT.ok, out: HELP });
    expect((await invoke([])).code).toBe(EXIT.usage);
    expect((await invoke(['launch'])).err).toMatch(/^Unknown command: launch/u);
    expect((await invoke(['gate', '--brnach', 'main'])).err).toBe('Unknown option --brnach');
    expect((await invoke(['gate', 'main'])).err).toBe('Unexpected argument: main');
    expect((await invoke(['gate', '--branch'])).err).toBe('--branch needs a value');
    expect((await invoke(['gate', '--branch', '--commit', SHA])).err).toBe(
      '--branch needs a value',
    );
  });

  it('refuses plain http to a host that is not this machine, before anything is sent', async () => {
    const result = await invoke(['gate', '--branch', 'main', '--commit', SHA], {
      AUTOMATE_URL: 'http://automate.lan:3000',
    });
    expect(result.code).toBe(EXIT.usage);
    expect(result.err).toMatch(/in the clear/u);
    expect(seen).toHaveLength(0);
  });

  it('says what is missing from the environment', async () => {
    const gateArgs = ['gate', '--branch', 'main', '--commit', SHA];
    expect((await invoke(gateArgs, { AUTOMATE_URL: undefined })).err).toMatch(/Set AUTOMATE_URL/u);
    expect((await invoke(gateArgs, { AUTOMATE_TOKEN: 'secret' })).err).toMatch(/AUTOMATE_TOKEN/u);
    expect((await invoke(gateArgs, { AUTOMATE_PROJECT: 'checkout' })).err).toMatch(
      /Name the project/u,
    );
    expect(
      (await invoke([...gateArgs, '--project', PROJECT], { AUTOMATE_PROJECT: undefined })).code,
    ).not.toBe(EXIT.usage);
    expect((await invoke(gateArgs, { AUTOMATE_URL: 'not a url' })).err).toMatch(/not a URL/u);
    expect((await invoke(gateArgs, { AUTOMATE_URL: 'https://user:pw@a.example' })).err).toMatch(
      /credentials/u,
    );
  });

  it('reports an unreachable install as refused', async () => {
    const result = await invoke(['gate', '--branch', 'main', '--commit', SHA], {
      AUTOMATE_URL: 'http://127.0.0.1:1',
    });
    expect(result.code).toBe(EXIT.refused);
    expect(result.err).toMatch(/^Could not reach http:\/\/127\.0\.0\.1:1/u);
  });
});

describe('an unexpected failure', () => {
  it('is a printed sentence and exit 3, never a thrown error, for an Error and for anything else', async () => {
    for (const [failure, sentence] of [
      [new Error('stream reset'), 'stream reset'],
      ['socket hang up', 'socket hang up'],
    ] as const) {
      const out: string[] = [];
      const err: string[] = [];
      // The answer arrives, then its body cannot be read: not a refusal the CLI words itself.
      const broken = (async () =>
        ({
          status: 200,
          ok: true,
          text: () => Promise.reject(failure),
        }) as unknown as Response) as typeof fetch;
      const code = await run(['gate', '--branch', 'main', '--commit', SHA], {
        env: { AUTOMATE_URL: origin, AUTOMATE_TOKEN: TOKEN, AUTOMATE_PROJECT: PROJECT },
        cwd: process.cwd(),
        fetch: broken,
        now: () => new Date('2026-10-26T12:00:00.000Z'),
        out: (line) => out.push(line),
        err: (line) => err.push(line),
      });
      expect(code).toBe(EXIT.refused);
      expect(err).toEqual([sentence]);
      expect([...out, ...err].join('\n')).not.toContain(TOKEN);
    }
  });
});

describe('automate test', () => {
  const REPORT =
    '<testsuite><testcase classname="Checkout" name="pays"><failure/></testcase></testsuite>';
  /** A command that exits with `code`, run by this very Node. */
  const exiting = (code: number) => ['--', process.execPath, '-e', `process.exit(${String(code)})`];
  const verdict = (excused: boolean) => ({
    status: 200,
    body: {
      runId: '6b0c1c4e-1f3a-5b2d-8c4e-1234567890ab',
      ingested: 'accepted',
      status: 'failed',
      tests: { total: 2, passed: 1, failed: 1, flaky: 0, skipped: 0 },
      reportErrors: 0,
      quarantine: {
        excused,
        excusedTests: excused ? ['tests/pay.spec.ts › Checkout › pays'] : [],
        unexcusedFailures: excused ? [] : ['tests/pay.spec.ts › Checkout › pays'],
      },
    },
  });

  async function withReport(): Promise<string> {
    const dir = await tempDir();
    await writeFile(path.join(dir, 'results.xml'), REPORT);
    return dir;
  }
  const args = ['test', '--format', 'junit', '--report', 'results.xml', '--commit', SHA];

  it('exits 0 when the only failures are quarantined, and says which', async () => {
    const dir = await withReport();
    reply = () => verdict(true);
    const result = await invoke([...args, ...exiting(1)], {}, dir);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toContain('1 failed test, all quarantined');
    expect(result.out).toContain('tests/pay.spec.ts › Checkout › pays');
    const [request] = seen;
    const url = new URL(request?.url ?? '', origin);
    expect(url.pathname).toBe(`/api/v1/projects/${PROJECT}/tests/reports`);
    expect(url.searchParams.get('format')).toBe('junit');
    expect(url.searchParams.get('commit')).toBe(SHA);
    expect(url.searchParams.get('startedAt')).toBe('2026-10-26T12:00:00.000Z');
    expect(request?.body.toString()).toBe(REPORT);
    expect(request?.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("keeps the command's exit code when a failure is not quarantined", async () => {
    const dir = await withReport();
    reply = () => verdict(false);
    const result = await invoke([...args, ...exiting(7)], {}, dir);
    expect(result.code).toBe(7);
    expect(result.out).toContain('not quarantined');
    expect(result.out).toContain('tests/pay.spec.ts › Checkout › pays');
  });

  it("keeps the command's exit code when the server cannot be reached", async () => {
    const dir = await withReport();
    const result = await invoke(
      [...args, ...exiting(1)],
      { AUTOMATE_URL: 'http://127.0.0.1:9' },
      dir,
    );
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/keeping exit code 1/u);
  });

  it("keeps the command's exit code when the server refuses the report", async () => {
    const dir = await withReport();
    reply = () => ({
      status: 400,
      body: { error: { code: 'INVALID_REPORTER_UPLOAD', message: 'bad' } },
    });
    const result = await invoke([...args, ...exiting(1)], {}, dir);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/INVALID_REPORTER_UPLOAD/u);
  });

  it("keeps the command's exit code when the answer is not a verdict", async () => {
    const dir = await withReport();
    reply = () => ({ status: 200, body: { quarantine: { excused: 'yes' } } });
    expect((await invoke([...args, ...exiting(1)], {}, dir)).code).toBe(1);
  });

  it("keeps the command's exit code when no report was written", async () => {
    const dir = await tempDir();
    const result = await invoke([...args, ...exiting(1)], {}, dir);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/results\.xml was not written/u);
    expect(seen).toHaveLength(0);
  });

  it('exits 0 for a passing command, and still records the run', async () => {
    const dir = await withReport();
    reply = () => verdict(false);
    expect((await invoke([...args, ...exiting(0)], {}, dir)).code).toBe(EXIT.ok);
    expect(seen).toHaveLength(1);
    // A passing command is never turned red by the upload failing.
    reply = () => ({ status: 503, body: {} });
    expect((await invoke([...args, ...exiting(0)], {}, dir)).code).toBe(EXIT.ok);
  });

  it('refuses a missing command, and reports one that cannot start', async () => {
    expect((await invoke([...args])).code).toBe(EXIT.usage);
    const dir = await withReport();
    const result = await invoke([...args, '--', 'definitely-not-a-command-automate'], {}, dir);
    expect(result.code).toBe(127);
    expect(seen).toHaveLength(0);
  });
});
