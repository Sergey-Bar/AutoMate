import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `dogfood.ts` is a script: importing it runs it over `process.argv`. It is the W7 exit
 * instrument, so what it prints is asserted here - in particular the column it exists
 * for, the frameworks the detector found that its own table has no rule for.
 */

let root: string;
let stdout: string[];
const originalArgv = process.argv;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'dogfood-'));
  stdout = [];
  vi.resetModules();
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  process.argv = originalArgv;
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function repo(name: string, files: Record<string, string>): Promise<string> {
  const dir = path.join(root, name);
  for (const [file, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), body);
  }
  return dir;
}

async function dogfood(...repos: string[]): Promise<Array<Record<string, unknown>>> {
  process.argv = ['node', 'dogfood.js', ...repos];
  await import('./dogfood.js');
  return stdout.map((chunk) => JSON.parse(chunk) as Record<string, unknown>);
}

describe('dogfood', () => {
  it('prints nothing when given no repositories', async () => {
    expect(await dogfood()).toEqual([]);
  });

  it('reports what was detected, one JSON document per repository, in argument order', async () => {
    const node = await repo('web', {
      'package.json': JSON.stringify({
        scripts: { test: 'vitest run' },
        devDependencies: { vitest: '^4' },
      }),
    });
    const go = await repo('svc', { 'go.mod': 'module x\n' });
    const [first, second] = await dogfood(node, go);
    expect(first).toMatchObject({
      repo: 'web',
      recognised: true,
      ecosystem: 'node',
      language: 'JavaScript/TypeScript',
      packageManager: 'npm',
      frameworks: ['vitest'],
      unknownFrameworks: [],
      commands: [{ id: 'node.test', argv: ['npm', 'test'] }],
    });
    expect(second).toMatchObject({ repo: 'svc', ecosystem: 'go', frameworks: ['testing'] });
  });

  it('lists a framework its own table has no rule for as a tuning candidate', async () => {
    // The detector's real tables are all known to the script, so the unknown column can only be
    // exercised by a detector that reports a name the script has never heard of.
    vi.doMock('./detect/index.js', () => ({
      detectProject: async () => ({
        recognised: true,
        ecosystem: 'node',
        language: 'JavaScript/TypeScript',
        packageManager: 'npm',
        frameworks: [
          { name: 'vitest', category: 'unit', evidence: 'package.json' },
          { name: 'mystery-runner', category: 'unit', evidence: 'package.json' },
        ],
        candidateCommands: [],
      }),
    }));
    try {
      const [report] = await dogfood(await repo('odd', { 'README.md': '' }));
      expect(report?.frameworks).toEqual(['vitest', 'mystery-runner']);
      expect(report?.unknownFrameworks).toEqual(['mystery-runner']);
    } finally {
      vi.doUnmock('./detect/index.js');
    }
  });
  it('reports an unrecognised repository as nulls and empty lists, not an error', async () => {
    const empty = await repo('plain', { 'README.md': '# hi\n' });
    const [report] = await dogfood(empty);
    expect(report).toEqual({
      repo: 'plain',
      recognised: false,
      ecosystem: null,
      language: null,
      packageManager: null,
      frameworks: [],
      unknownFrameworks: [],
      commands: [],
    });
  });
});
