import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
}));

function normalizePath(input: string): string {
  return path.normalize(input);
}

function ensureDir(dirPath: string): void {
  const normalized = normalizePath(dirPath);
  if (fsState.dirs.has(normalized)) {
    return;
  }

  const parent = path.dirname(normalized);
  if (parent !== normalized) {
    ensureDir(parent);
  }
  fsState.dirs.add(normalized);
}

function addFile(filePath: string, content: string): void {
  const normalized = normalizePath(filePath);
  ensureDir(path.dirname(normalized));
  fsState.files.set(normalized, content);
}

function addDir(dirPath: string): void {
  ensureDir(dirPath);
}

vi.mock('fs', () => {
  const existsSync = vi.fn((targetPath: string) => {
    const normalized = normalizePath(targetPath);
    return fsState.files.has(normalized) || fsState.dirs.has(normalized);
  });

  const readFileSync = vi.fn((targetPath: string) => {
    const normalized = normalizePath(targetPath);
    const content = fsState.files.get(normalized);
    if (content == null) {
      throw new Error(`ENOENT: no such file, open '${normalized}'`);
    }
    return content;
  });

  const readdirSync = vi.fn((targetPath: string) => {
    const normalized = normalizePath(targetPath);
    if (!fsState.dirs.has(normalized)) {
      throw new Error(`ENOENT: no such directory, scandir '${normalized}'`);
    }

    const childNames = new Set<string>();

    for (const dir of fsState.dirs) {
      if (path.dirname(dir) === normalized && dir !== normalized) {
        childNames.add(path.basename(dir));
      }
    }

    for (const file of fsState.files.keys()) {
      if (path.dirname(file) === normalized) {
        childNames.add(path.basename(file));
      }
    }

    return Array.from(childNames).map((name) => {
      const fullPath = path.join(normalized, name);
      const isDir = fsState.dirs.has(fullPath);

      return {
        name,
        isDirectory: () => isDir,
        isFile: () => !isDir,
      };
    });
  });

  const statSync = vi.fn((targetPath: string) => {
    const normalized = normalizePath(targetPath);
    if (fsState.dirs.has(normalized)) {
      return { isDirectory: () => true };
    }
    if (fsState.files.has(normalized)) {
      return { isDirectory: () => false };
    }
    throw new Error(`ENOENT: no such file or directory, stat '${normalized}'`);
  });

  return {
    default: { existsSync, readFileSync, readdirSync, statSync },
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
  };
});

async function loadModule() {
  vi.resetModules();
  return import('../impact-analysis.js');
}

describe('analyzeImpact', () => {
  const workspaceRoot = path.resolve(process.cwd(), '..');

  beforeEach(() => {
    fsState.files.clear();
    fsState.dirs.clear();

    addDir(path.parse(workspaceRoot).root);
    addDir(workspaceRoot);
    addFile(path.join(workspaceRoot, 'package.json'), '{"name":"apps-root"}');
  });

  it('returns [] when no test files are found', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'util.ts'), 'export const x = 1;');

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/util.ts']);

    expect(impacted).toEqual([]);
  });

  it('marks direct test-file change with direct reason', async () => {
    const testPath = path.join(workspaceRoot, 'project', 'src', 'alpha.test.ts');
    addFile(testPath, `describe('Alpha suite', () => { test('works', () => {}) })`);

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact([testPath]);

    expect(impacted).toEqual([
      {
        testFile: path.join('project', 'src', 'alpha.test.ts'),
        title: 'Alpha suite',
        reason: 'Direct test file change',
      },
    ]);
  });

  it('finds tests importing changed source files and returns relative paths', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'utils.ts'), 'export const helper = 1;');
    addFile(
      path.join(workspaceRoot, 'project', 'src', 'feature.test.ts'),
      `import { helper } from './utils';\ndescribe('Feature suite', () => { test('ok', () => helper) });`,
    );

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/utils.ts']);

    expect(impacted).toEqual([
      {
        testFile: path.join('project', 'src', 'feature.test.ts'),
        title: 'Feature suite',
        reason: 'Imports utils.ts',
      },
    ]);
  });

  it('handles transitive dependencies (A imports B imports C)', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'c.ts'), 'export const c = 1;');
    addFile(path.join(workspaceRoot, 'project', 'src', 'b.ts'), `import { c } from './c'; export const b = c;`);
    addFile(
      path.join(workspaceRoot, 'project', 'src', 'a.test.ts'),
      `import { b } from './b'; describe('Transitive chain', () => { test('uses b', () => b) });`,
    );

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/c.ts']);

    expect(impacted).toEqual([
      {
        testFile: path.join('project', 'src', 'a.test.ts'),
        title: 'Transitive chain',
        reason: 'Imports c.ts',
      },
    ]);
  });

  it('extracts title from test/it block when describe is absent', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'dep.ts'), 'export const x = 1;');
    addFile(
      path.join(workspaceRoot, 'project', 'src', 'single.test.ts'),
      `import { x } from './dep';\nit('single test title', () => { expect(x).toBe(1); });`,
    );

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/dep.ts']);

    expect(impacted[0].title).toBe('single test title');
  });

  it('falls back to filename when no describe/test block exists', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'dep2.ts'), 'export const x = 2;');
    addFile(path.join(workspaceRoot, 'project', 'src', 'fallback.test.ts'), `import './dep2';\nconst noop = 1;`);

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/dep2.ts']);

    expect(impacted[0].title).toBe('fallback.test');
  });

  it('handles unresolvable imports gracefully and skips unresolved edges', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'real.ts'), 'export const ok = true;');
    addFile(
      path.join(workspaceRoot, 'project', 'src', 'mixed.test.ts'),
      `import './does-not-exist';\nimport { ok } from './real';\ndescribe('Mixed imports', () => { test('ok', () => ok); });`,
    );

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/real.ts']);

    expect(impacted).toHaveLength(1);
    expect(impacted[0]).toMatchObject({
      testFile: path.join('project', 'src', 'mixed.test.ts'),
      title: 'Mixed imports',
    });
  });

  it('skips node_modules, dist, and build directories while finding tests', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'core.ts'), 'export const core = 1;');

    addFile(
      path.join(workspaceRoot, 'project', 'src', 'kept.test.ts'),
      `import { core } from './core';\ndescribe('Kept test', () => { test('ok', () => core); });`,
    );

    addFile(
      path.join(workspaceRoot, 'project', 'node_modules', 'dep', 'ignored.test.ts'),
      `import '../src/core'; describe('Ignored', () => {});`,
    );
    addFile(
      path.join(workspaceRoot, 'project', 'dist', 'ignored.test.ts'),
      `import '../src/core'; describe('Ignored dist', () => {});`,
    );
    addFile(
      path.join(workspaceRoot, 'project', 'build', 'ignored.test.ts'),
      `import '../src/core'; describe('Ignored build', () => {});`,
    );

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/core.ts']);

    expect(impacted).toEqual([
      {
        testFile: path.join('project', 'src', 'kept.test.ts'),
        title: 'Kept test',
        reason: 'Imports core.ts',
      },
    ]);
  });

  it('resolves .ts/.tsx/.js/.jsx and index files in directories', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'dep-ts.ts'), 'export const a = 1;');
    addFile(path.join(workspaceRoot, 'project', 'src', 'dep-tsx.tsx'), 'export const b = 2;');
    addFile(path.join(workspaceRoot, 'project', 'src', 'dep-js.js'), 'export const c = 3;');
    addFile(path.join(workspaceRoot, 'project', 'src', 'dep-jsx.jsx'), 'export const d = 4;');
    addFile(path.join(workspaceRoot, 'project', 'src', 'lib', 'index.ts'), 'export const e = 5;');

    addFile(
      path.join(workspaceRoot, 'project', 'src', 'extensions.test.ts'),
      `
      import { a } from './dep-ts';
      import { b } from './dep-tsx';
      import { c } from './dep-js';
      import { d } from './dep-jsx';
      import { e } from './lib';
      describe('Extension resolver', () => { test('ok', () => a + b + c + d + e); });
      `,
    );

    const { analyzeImpact } = await loadModule();

    const tsImpact = await analyzeImpact(['project/src/dep-ts.ts']);
    const tsxImpact = await analyzeImpact(['project/src/dep-tsx.tsx']);
    const jsImpact = await analyzeImpact(['project/src/dep-js.js']);
    const jsxImpact = await analyzeImpact(['project/src/dep-jsx.jsx']);
    const indexImpact = await analyzeImpact(['project/src/lib/index.ts']);

    for (const impacted of [tsImpact, tsxImpact, jsImpact, jsxImpact, indexImpact]) {
      expect(impacted).toHaveLength(1);
      expect(impacted[0]).toMatchObject({
        testFile: path.join('project', 'src', 'extensions.test.ts'),
        title: 'Extension resolver',
      });
    }
  });

  it('prevents infinite loops with circular dependencies', async () => {
    addFile(path.join(workspaceRoot, 'project', 'src', 'cycle-a.ts'), `import { b } from './cycle-b'; export const a = b;`);
    addFile(path.join(workspaceRoot, 'project', 'src', 'cycle-b.ts'), `import { a } from './cycle-a'; export const b = a;`);
    addFile(
      path.join(workspaceRoot, 'project', 'src', 'cycle.test.ts'),
      `import { a } from './cycle-a'; describe('Circular graph', () => { test('ok', () => a); });`,
    );

    const { analyzeImpact } = await loadModule();
    const impacted = await analyzeImpact(['project/src/cycle-b.ts']);

    expect(impacted).toHaveLength(1);
    expect(impacted[0]).toMatchObject({
      testFile: path.join('project', 'src', 'cycle.test.ts'),
      title: 'Circular graph',
    });
  });
});
