import { describe, expect, it } from 'vitest';
import { literalView, type RepositoryView } from '@automate/projects';
import type { RunCommand } from '@automate/shared-contracts';
import { DomainError } from '../errors/domain-error.js';
import { createRepoScanner, resolveCommand } from './repo-scan-service.js';

const REPO = {
  'package.json': JSON.stringify({ scripts: { lint: 'eslint .', dev: 'vite' } }),
  'pnpm-lock.yaml': '',
};

function countingView(files: Record<string, string>): {
  view: RepositoryView;
  walks: () => number;
} {
  const inner = literalView(files);
  let walks = 0;
  return {
    view: {
      paths: async () => {
        walks += 1;
        return inner.paths();
      },
      read: (path) => inner.read(path),
    },
    walks: () => walks,
  };
}

describe('the repository scanner', () => {
  it('serves a cached scan inside its window and walks again after it, or when asked', async () => {
    let clock = 0;
    const { view, walks } = countingView(REPO);
    const scanner = createRepoScanner({ viewFor: () => view, ttlMs: 1_000, now: () => clock });
    await scanner.scan('p1', '/repo');
    await scanner.scan('p1', '/repo');
    expect(walks()).toBe(1);
    await scanner.scan('p1', '/repo', { fresh: true });
    expect(walks()).toBe(2);
    clock = 5_000;
    await scanner.scan('p1', '/repo');
    expect(walks()).toBe(3);
  });

  it('refuses a project with no repository path rather than scanning the server', async () => {
    const scanner = createRepoScanner({ viewFor: () => literalView({}) });
    await expect(scanner.scan('p1', null)).rejects.toBeInstanceOf(DomainError);
  });
});

describe('resolving a command id', () => {
  const profile: RunCommand[] = [
    {
      id: 'node.test',
      argv: ['pnpm', 'test'],
      category: 'unit',
      evidence: 'package.json:3',
      confidence: 0.9,
      artifactGlobs: ['reports/*.xml'],
      env: ['CI_TOKEN'],
      timeoutMs: 60_000,
    },
  ];

  it('prefers the profile, and holds a profile suite to the artifact rule', () => {
    expect(resolveCommand('node.test', profile, null)).toEqual({
      id: 'node.test',
      label: 'pnpm test',
      argv: ['pnpm', 'test'],
      workingDirectory: '.',
      artifactGlobs: ['reports/*.xml'],
      env: ['CI_TOKEN'],
      evidence: 'artifact',
      timeoutMs: 60_000,
    });
  });

  it('resolves a scanned script to its argv, judged by its exit code', async () => {
    const scan = await createRepoScanner({ viewFor: () => literalView(REPO) }).scan('p', '/r');
    expect(resolveCommand('script:.:lint', [], scan)).toMatchObject({
      argv: ['pnpm', 'run', 'lint'],
      evidence: 'exit-code',
      artifactGlobs: [],
    });
  });

  it('refuses an id in neither list, and a script that never exits', async () => {
    const scan = await createRepoScanner({ viewFor: () => literalView(REPO) }).scan('p', '/r');
    expect(() => resolveCommand('script:.:nope', [], scan)).toThrow(/No command script:.:nope/u);
    expect(() => resolveCommand('script:.:nope', [], null)).toThrow(DomainError);
    expect(() => resolveCommand('script:.:dev', [], scan)).toThrow(/cannot be run as a job/u);
  });
});
