import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from './cli.js';
import { EXIT } from './errors.js';

/**
 * `automate shard --total N --index i -- <files…>` — prints the files shard `i` runs.
 *
 * **It never drops a file.** When the plan cannot be had, the shard runs every file: twice
 * the work is a slow build, and a skipped file is a test that silently never ran.
 */
const PROJECT = '11111111-1111-4111-8111-111111111111';
const TOKEN = ['amt_', 'ci', '_uploader_token'].join('');
const COMMIT_TIME = '2026-10-25T09:30:00+02:00';

interface Sent {
  url: string;
  body: Record<string, unknown>;
}

const PLAN = {
  total: 2,
  asOf: '2026-10-25T07:30:00.000Z',
  runs: 12,
  known: 2,
  unknown: 1,
  shards: [
    { index: 1, files: ['e2e/slow.spec.ts'], estimatedMs: 90_000 },
    { index: 2, files: ['e2e/fast.spec.ts', 'e2e/new.spec.ts'], estimatedMs: 65_500 },
  ],
};

function fakeFetch(answer: (sent: Sent) => Response | Promise<Response>, sent: Sent[]) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const entry = {
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    };
    sent.push(entry);
    return answer(entry);
  }) as typeof fetch;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function invoke(
  argv: string[],
  options: {
    answer?: (sent: Sent) => Response | Promise<Response>;
    env?: Record<string, string | undefined>;
    commitTime?: string | undefined;
    git?: boolean;
    cwd?: string;
  } = {},
) {
  const out: string[] = [];
  const err: string[] = [];
  const sent: Sent[] = [];
  const code = await run(['shard', ...argv], {
    env: {
      AUTOMATE_URL: 'https://automate.example.com',
      AUTOMATE_TOKEN: TOKEN,
      AUTOMATE_PROJECT: PROJECT,
      ...options.env,
    },
    cwd: options.cwd ?? process.cwd(),
    fetch: fakeFetch(options.answer ?? (() => json(200, PLAN)), sent),
    now: () => new Date('2026-10-26T12:00:00.000Z'),
    ...(options.git === true
      ? {}
      : { commitTime: async () => ('commitTime' in options ? options.commitTime : COMMIT_TIME) }),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err, sent };
}

const FILES = ['e2e/slow.spec.ts', 'e2e/fast.spec.ts', 'e2e/new.spec.ts'];
const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('automate shard', () => {
  it("prints this shard's files, one per line, and the estimate on stderr", async () => {
    const result = await invoke(['--total', '2', '--index', '2', '--', ...FILES]);
    expect(result.code).toBe(EXIT.ok);
    expect(result.out).toEqual(['e2e/fast.spec.ts', 'e2e/new.spec.ts']);
    expect(result.err).toEqual([
      'Shard 2/2: 2 file(s), about 1m 6s, planned from 12 run(s); 1 file(s) had no history.',
    ]);
    expect(result.sent).toEqual([
      {
        url: `https://automate.example.com/api/v1/projects/${PROJECT}/shards/plan`,
        body: { total: 2, files: FILES, asOf: '2026-10-25T07:30:00.000Z' },
      },
    ]);
  });

  it('sends the same cut-off from every shard: the commit time, as UTC', async () => {
    const one = await invoke(['--total', '2', '--index', '1', '--', ...FILES]);
    const two = await invoke(['--total', '2', '--index', '2', '--', ...[...FILES].reverse()]);
    expect(one.sent[0]?.body['asOf']).toBe('2026-10-25T07:30:00.000Z');
    expect(two.sent[0]?.body['asOf']).toBe(one.sent[0]?.body['asOf']);
  });

  it('takes --as-of, then AUTOMATE_SHARD_AS_OF, over the commit time', async () => {
    const flag = await invoke([
      '--total',
      '2',
      '--index',
      '1',
      '--as-of',
      '2026-01-02T03:04:05Z',
      '--',
      'a',
    ]);
    expect(flag.sent[0]?.body['asOf']).toBe('2026-01-02T03:04:05.000Z');
    const env = await invoke(['--total', '2', '--index', '1', '--', 'a'], {
      env: { AUTOMATE_SHARD_AS_OF: '2026-02-02T00:00:00Z' },
    });
    expect(env.sent[0]?.body['asOf']).toBe('2026-02-02T00:00:00.000Z');
  });

  it('says the shards may disagree when there is no commit time to agree on', async () => {
    const result = await invoke(['--total', '2', '--index', '1', '--', 'a'], {
      commitTime: undefined,
    });
    expect(result.sent[0]?.body).not.toHaveProperty('asOf');
    expect(result.err[0]).toMatch(/No commit time/u);
  });

  it('reads the files from --files-from, one per line, ignoring blanks', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'automate-shard-'));
    temporary.push(dir);
    await writeFile(
      path.join(dir, 'files.txt'),
      'e2e/slow.spec.ts\r\n\ne2e/fast.spec.ts\n  \ne2e/new.spec.ts\n',
    );
    const result = await invoke(['--total', '2', '--index', '1', '--files-from', 'files.txt'], {
      cwd: dir,
    });
    expect(result.sent[0]?.body['files']).toEqual(FILES);
  });

  it('runs every file when the plan cannot be had, and says so', async () => {
    for (const answer of [
      () =>
        json(503, { error: { code: 'NOT_CONFIGURED', message: 'Run history is not configured' } }),
      () => {
        throw new TypeError('fetch failed');
      },
      () => {
        throw 'a thrown string';
      },
      () => json(200, { shards: 'not a plan' }),
      () => json(200, 'plain text'),
      () => json(200, { runs: 1, unknown: 0, shards: [{ index: 1, files: [7], estimatedMs: 1 }] }),
    ]) {
      const result = await invoke(['--total', '3', '--index', '2', '--', ...FILES], { answer });
      expect(result.code).toBe(EXIT.ok);
      expect(result.out).toEqual(FILES);
      expect(result.err.join('\n')).toMatch(/running all 3 file\(s\) on this shard/u);
    }
  });

  it('runs every file when the plan does not cover them all, rather than skip one', async () => {
    const result = await invoke(['--total', '2', '--index', '1', '--', ...FILES], {
      answer: () =>
        json(200, { ...PLAN, shards: [{ index: 1, files: ['e2e/slow.spec.ts'], estimatedMs: 1 }] }),
    });
    expect(result.out).toEqual(FILES);
  });

  it('keeps a credential refusal an error: that is a broken setup, not an outage', async () => {
    const result = await invoke(['--total', '2', '--index', '1', '--', ...FILES], {
      answer: () => json(401, { error: { code: 'UNAUTHENTICATED', message: 'no' } }),
    });
    expect(result.code).toBe(EXIT.unauthorised);
    expect(result.out).toEqual([]);
  });

  it('reads the commit time from git by default, and warns outside a repository', async () => {
    const inside = await invoke(['--total', '2', '--index', '1', '--', 'a'], { git: true });
    expect(String(inside.sent[0]?.body['asOf'])).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/u);
    const dir = await mkdtemp(path.join(os.tmpdir(), 'automate-shard-'));
    temporary.push(dir);
    const outside = await invoke(['--total', '2', '--index', '1', '--', 'a'], {
      git: true,
      cwd: dir,
    });
    expect(outside.sent[0]?.body).not.toHaveProperty('asOf');
    expect(outside.err[0]).toMatch(/No commit time/u);
  });

  it('refuses a --files-from it cannot read', async () => {
    const result = await invoke(['--total', '2', '--index', '1', '--files-from', 'missing.txt']);
    expect(result.code).toBe(EXIT.usage);
    expect(result.err.join('\n')).toMatch(/could not be read/u);
  });

  it('runs every file when the plan has no shard for this index', async () => {
    const result = await invoke(['--total', '2', '--index', '2', '--', ...FILES], {
      answer: () => json(200, { ...PLAN, shards: [{ index: 1, files: FILES, estimatedMs: 1 }] }),
    });
    expect(result.out).toEqual(FILES);
    expect(result.err.join('\n')).toMatch(/no shard 2/u);
  });

  it('prints seconds for a short estimate, and falls back to stdout without an err sink', async () => {
    const short = await invoke(['--total', '1', '--index', '1', '--', 'a'], {
      answer: () =>
        json(200, {
          ...PLAN,
          unknown: 0,
          shards: [{ index: 1, files: ['a'], estimatedMs: 4_400 }],
        }),
    });
    expect(short.err[0]).toMatch(/about 4s,/u);
    const out: string[] = [];
    const argv = ['--total', '1', '--index', '1', '--as-of', '2026-01-01T00:00:00Z', '--', 'a'];
    // `err` is optional on the command's own Io, so the warning goes to stdout without it.
    const { shard } = await import('./shard-command.js');
    await shard(argv, {
      env: {
        AUTOMATE_URL: 'https://automate.example.com',
        AUTOMATE_TOKEN: TOKEN,
        AUTOMATE_PROJECT: PROJECT,
      },
      cwd: process.cwd(),
      fetch: fakeFetch(
        () => json(200, { ...PLAN, shards: [{ index: 1, files: ['a'], estimatedMs: 1 }] }),
        [],
      ),
      now: () => new Date(),
      out: (line) => out.push(line),
    });
    expect(out.at(-1)).toBe('a');
    expect(out[0]).toMatch(/^Shard 1\/1/u);
  });

  it.each([
    [['--index', '1', '--', 'a'], /--total is required/u],
    [['--total', '2', '--', 'a'], /--index is required/u],
    [['--total', '0', '--index', '1', '--', 'a'], /--total is a whole number from 1 to 64/u],
    [['--total', '2', '--index', '3', '--', 'a'], /--index is a whole number from 1 to 2/u],
    [['--total', '2', '--index', '1'], /Name the files/u],
    [
      ['--total', '2', '--index', '1', '--as-of', 'yesterday', '--', 'a'],
      /--as-of is an ISO-8601 time/u,
    ],
  ])('refuses %j', async (argv, message) => {
    const result = await invoke(argv);
    expect(result.code).toBe(EXIT.usage);
    expect(result.err.join('\n')).toMatch(message);
    expect(result.sent).toEqual([]);
  });
});
