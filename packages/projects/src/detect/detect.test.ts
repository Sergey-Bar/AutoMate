import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DETECTOR_VERSION, detectProject } from './index.js';
import { fileSystemView, literalView } from './repository-view.js';

describe('detection is a proposal that carries its own evidence (R3)', () => {
  it('points every candidate at a file that exists in the repository', async () => {
    // The evidence string is the whole defence against "8-ecosystem detection is
    // read-and-guess". A candidate whose evidence is `package.json` when the
    // repository has no `package.json` is a fabricated claim, and an operator
    // who opens it learns nothing — so the path is asserted to be real, not just
    // non-empty.
    const files = {
      'package.json': JSON.stringify({
        name: 'svc',
        scripts: { test: 'jest' },
        devDependencies: { jest: '^29.0.0' },
      }),
      'package-lock.json': '{}',
    };
    const paths = new Set(Object.keys(files));
    const result = await detectProject(literalView(files));

    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    for (const candidate of result.candidateCommands) {
      expect(paths.has(candidate.evidence.split(':')[0] ?? ''), candidate.evidence).toBe(true);
    }
    for (const framework of result.frameworks) {
      expect(paths.has(framework.evidence.split(':')[0] ?? ''), framework.evidence).toBe(true);
    }
  });

  it('ranks candidates so the best-supported one is first', async () => {
    const result = await detectProject(
      literalView({
        'package.json': JSON.stringify({
          name: 'svc',
          scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
          devDependencies: { vitest: '^4.1.5' },
        }),
        'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
      }),
    );
    expect(result.recognised).toBe(true);
    if (!result.recognised) return;
    // `test` at 0.9 outranks `test:e2e` at 0.85, and a plain sort on a
    // repository's script names would put `test:e2e` first alphabetically.
    expect(result.candidateCommands[0]?.id).toBe('node.test');
  });

  it('stamps every result with the detector version', async () => {
    const result = await detectProject(literalView({ 'go.mod': 'module example.com/svc\n' }));
    // Even the unrecognised case carries it, because the column is NOT NULL and
    // a profile row with no version is the thing that makes version 2's shape
    // readable as version 1's.
    expect(result.detectorVersion).toBe(DETECTOR_VERSION);
  });
});

describe('an unrecognised repository is a result, not an exception', () => {
  it('reports nothing rather than guessing an ecosystem', async () => {
    const result = await detectProject(literalView({ 'README.md': '# a repository\n' }));
    expect(result.recognised).toBe(false);
    if (result.recognised) return;
    expect(result.ecosystem).toBeNull();
    expect(result.candidateCommands).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  it('reports nothing for a package.json that will not parse', async () => {
    // A truncated `package.json` is customer input. Throwing here would surface
    // as a 500 from `project.add`, which tells the operator nothing about which
    // of "your manifest is broken" and "no detector recognised this" happened.
    const result = await detectProject(literalView({ 'package.json': '{ "name": ' }));
    expect(result.recognised).toBe(false);
  });
});

describe('detection is deterministic when two ecosystems could both match', () => {
  it('returns the same answer on every run', async () => {
    // A Go project that vendors a `package.json` for its frontend tooling is
    // still primarily Go. If the tie-break were the filesystem's read order the
    // stored profile would change between runs and stop being comparable.
    const files = {
      'go.mod': 'module example.com/svc\n',
      'package.json': JSON.stringify({ name: 'ui', scripts: { test: 'vitest' } }),
    };
    const first = await detectProject(literalView(files));
    const second = await detectProject(literalView(files));
    expect(first).toEqual(second);
    if (!first.recognised) return;
    expect(first.ecosystem).toBe('go');
  });
});

describe('the filesystem view walks a real repository and installs nothing (D8)', () => {
  it('reads a manifest off disk without descending into dependencies', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-detect-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    await mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'svc', scripts: { test: 'node --test' } }),
      'utf8',
    );
    // A manifest-shaped file inside a dependency directory. Reading it would make
    // detection report on the dependency rather than on the repository, and a
    // walk of a real Node project would read tens of thousands of these.
    await writeFile(
      path.join(root, 'node_modules', 'left-pad', 'package.json'),
      JSON.stringify({ name: 'left-pad', scripts: { test: 'mocha' } }),
      'utf8',
    );
    await writeFile(path.join(root, 'src', 'index.js'), 'export const x = 1;\n', 'utf8');

    const view = fileSystemView(root);
    const paths = await view.paths();
    expect(paths).toContain('package.json');
    expect(paths).not.toContain('node_modules/left-pad/package.json');

    const detection = await detectProject(view);
    expect(detection.recognised).toBe(true);
    if (!detection.recognised) return;
    expect(detection.packageManager).toBe('npm');
  });
});
