import { describe, expect, it } from 'vitest';

import type { RepositoryView } from '../detect/repository-view.js';
import { scanRepository } from './index.js';
import { scanTools } from './tools.js';

/** A view that lists `unreadable` paths but refuses to read them. */
function view(files: Record<string, string>, unreadable: readonly string[] = []): RepositoryView {
  return {
    async paths() {
      return [...Object.keys(files), ...unreadable].sort();
    },
    async read(path) {
      return files[path] ?? null;
    },
  };
}

const read = (files: Record<string, string>) => async (path: string) => files[path] ?? null;

describe('scanTools', () => {
  it('skips a manifest it cannot read or parse, and keeps the ones it can', async () => {
    const files = {
      'package.json': '{"scripts":{"test":"vitest"}}',
      'apps/broken/package.json': '{ nope',
    };
    const tools = await scanTools(
      ['package.json', 'apps/broken/package.json', 'apps/gone/package.json'],
      read(files),
    );
    expect(tools.map((tool) => tool.id)).toEqual(['script:.:test']);
  });

  it('ignores a script whose body is not a string', async () => {
    const files = { 'package.json': '{"scripts":{"a":1,"b":null,"c":"echo","d":{}}}' };
    const tools = await scanTools(['package.json'], read(files));
    expect(tools.map((tool) => tool.name)).toEqual(['c']);
  });

  it('marks an empty script as not runnable, with the reason', async () => {
    const tools = await scanTools(
      ['package.json'],
      read({ 'package.json': '{"scripts":{"noop":""}}' }),
    );
    expect(tools[0]).toMatchObject({
      runnable: false,
      reason: 'The script is empty.',
      evidence: '(empty script)',
    });
  });

  it('runs each workspace under the nearest lockfile at or above it', async () => {
    const files = {
      'package.json': '{"scripts":{"t":"x"}}',
      'pnpm-lock.yaml': '',
      'apps/web/package.json': '{"scripts":{"t":"x"}}',
      'apps/web/yarn.lock': '',
      'apps/api/package.json': '{"scripts":{"t":"x"}}',
      'tools/cli/deep/package.json': '{"scripts":{"t":"x"}}',
      'tools/cli/package-lock.json': '',
    };
    const tools = await scanTools(Object.keys(files), read(files));
    const manager = (id: string) => tools.find((tool) => tool.id === id)?.argv[0];
    expect(manager('script:.:t')).toBe('pnpm');
    expect(manager('script:apps/web:t')).toBe('yarn');
    expect(manager('script:apps/api:t')).toBe('pnpm');
    expect(manager('script:tools/cli/deep:t')).toBe('npm');
  });

  it('falls back to npm when no lockfile exists anywhere', async () => {
    const tools = await scanTools(
      ['package.json'],
      read({ 'package.json': '{"scripts":{"t":"x"}}' }),
    );
    expect(tools[0]?.argv).toEqual(['npm', 'run', 't']);
  });

  it('puts the root first, then other directories alphabetically, then names', async () => {
    const files = {
      'package.json': '{"scripts":{"z":"x","a":"x"}}',
      'b/package.json': '{"scripts":{"a":"x"}}',
      'a/package.json': '{"scripts":{"b":"x","a":"x"}}',
    };
    const tools = await scanTools(Object.keys(files), read(files));
    expect(tools.map((tool) => tool.id)).toEqual([
      'script:.:a',
      'script:.:z',
      'script:a:a',
      'script:a:b',
      'script:b:a',
    ]);
  });

  it('reads explicit Makefile targets only: no variables, patterns, recipes or special targets', async () => {
    const makefile = [
      'CC := gcc',
      'FLAGS = -O2',
      '.PHONY: test lint',
      '%.o: %.c',
      'test: build',
      '\techo running',
      'lint:',
      'build-all: lint',
      '  indented: nope',
      'test: again',
    ].join('\r\n');
    const tools = await scanTools(['Makefile'], read({ Makefile: makefile }));
    expect(tools.map((tool) => tool.name)).toEqual(['build-all', 'lint', 'test']);
    expect(tools[0]).toMatchObject({
      argv: ['make', 'build-all'],
      evidence: 'Makefile target build-all',
    });
  });

  it('reads nothing from a Makefile that cannot be read', async () => {
    expect(await scanTools(['Makefile'], read({}))).toEqual([]);
  });

  it('returns at most 600 tools', async () => {
    const scripts = Object.fromEntries(
      Array.from({ length: 650 }, (_u, index) => [`s${String(index).padStart(3, '0')}`, 'x']),
    );
    const tools = await scanTools(
      ['package.json'],
      read({ 'package.json': JSON.stringify({ scripts }) }),
    );
    expect(tools).toHaveLength(600);
    expect(tools[0]?.name).toBe('s000');
  });
});

describe('scanRepository on manifests it cannot read', () => {
  it('still reports the ecosystem a listed manifest implies, but finds no dependency in it', async () => {
    const scan = await scanRepository(
      view({}, [
        'requirements.txt',
        'package.json',
        'pyproject.toml',
        'pom.xml',
        'app.csproj',
        'Gemfile',
      ]),
      new Date('2026-10-01T00:00:00.000Z'),
    );
    expect(scan.scannedAt).toBe('2026-10-01T00:00:00.000Z');
    expect(scan.ecosystems).toEqual(['node', 'python', 'java', 'dotnet', 'ruby']);
    expect(scan.detected).toEqual([]);
    expect(scan.tools).toEqual([]);
  });

  it('counts test and source files separately, so a test file is not also source', async () => {
    const scan = await scanRepository(
      view({
        'src/a.ts': '',
        'src/a.test.ts': '',
        'tests/test_b.py': '',
        'b_test.go': '',
        'README.md': '',
      }),
    );
    expect(scan.testFiles).toBe(3);
    expect(scan.sourceFiles).toBe(1);
  });

  it('reports a bare repository as zero maturity with every capability uncovered', async () => {
    const scan = await scanRepository(view({ 'README.md': '' }));
    expect(scan.maturity).toBe(0);
    expect(scan.capabilities.every((capability) => !capability.covered)).toBe(true);
    expect(scan.ecosystems).toEqual([]);
  });
});
