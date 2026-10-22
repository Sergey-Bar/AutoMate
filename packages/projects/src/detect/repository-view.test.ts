import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_IGNORED, fileSystemView, literalView } from './repository-view.js';

let root: string;

async function put(file: string, body = ''): Promise<void> {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), body);
}

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'repo-view-'));
  await put('package.json', '{}');
  await put('src/b.ts');
  await put('src/a.ts');
  await put('node_modules/dep/index.js');
  await put('vendor/lib.rb');
  await put('.git/config');
  await put('.github/workflows/ci.yml', 'name: ci');
  await put('.husky/pre-commit');
  await put('deep/er/.hidden/file.txt');
  await put('.env', 'SECRET=1');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('fileSystemView', () => {
  it('lists files as sorted POSIX paths relative to the root', async () => {
    const paths = await fileSystemView(root).paths();
    expect(paths).toEqual(['.env', 'package.json', 'src/a.ts', 'src/b.ts']);
  });

  it('skips the default-ignored directories at any depth', async () => {
    await put('pkg/build/out.js');
    await put('pkg/node_modules/x/y.js');
    const paths = await fileSystemView(root).paths();
    expect(paths.some((file) => file.includes('node_modules') || file.includes('build/'))).toBe(
      false,
    );
    expect(DEFAULT_IGNORED).toContain('node_modules');
  });

  it('descends into a dot directory only when it is named', async () => {
    const paths = await fileSystemView(root, DEFAULT_IGNORED, ['.github', '.husky']).paths();
    expect(paths).toContain('.github/workflows/ci.yml');
    expect(paths).toContain('.husky/pre-commit');
    expect(paths.some((file) => file.startsWith('.git/'))).toBe(false);
    expect(paths.some((file) => file.includes('.hidden'))).toBe(false);
  });

  it('honours a caller-supplied ignore list in place of the default', async () => {
    const paths = await fileSystemView(root, ['src']).paths();
    expect(paths.some((file) => file.startsWith('src/'))).toBe(false);
    expect(paths).toContain('node_modules/dep/index.js');
  });

  it('reads a file as utf8, and answers null for one that is not there', async () => {
    const view = fileSystemView(root);
    expect(await view.read('.github/workflows/ci.yml')).toBe('name: ci');
    expect(await view.read('nope.txt')).toBeNull();
    // A directory is a read error too, and must be a null rather than an exception.
    expect(await view.read('src')).toBeNull();
  });

  it('reads relative to the root it was given, even when handed a relative root', async () => {
    const relative = path.relative(process.cwd(), root);
    expect(await fileSystemView(relative).read('package.json')).toBe('{}');
  });
});

describe('literalView', () => {
  const view = literalView({ 'b.txt': 'B', 'a.txt': 'A', empty: '' });

  it('lists the keys sorted', async () => {
    expect(await view.paths()).toEqual(['a.txt', 'b.txt', 'empty']);
  });

  it('returns the content, including the empty string, and null when absent', async () => {
    expect(await view.read('a.txt')).toBe('A');
    expect(await view.read('empty')).toBe('');
    expect(await view.read('missing')).toBeNull();
  });
});
