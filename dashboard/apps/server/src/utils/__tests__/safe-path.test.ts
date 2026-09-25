import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

import { safePath } from '../safe-path.js';

describe('safePath', () => {
  const base = path.resolve(path.sep, 'tmp', 'automate-base');

  it('resolves a direct subdirectory path within base', () => {
    const resolved = safePath(base, 'subdir');
    expect(resolved).toBe(path.resolve(base, 'subdir'));
  });

  it('resolves nested file paths within base', () => {
    const resolved = safePath(base, path.join('nested', 'deep', 'file.txt'));
    expect(resolved).toBe(path.resolve(base, 'nested', 'deep', 'file.txt'));
  });

  it('blocks ../ directory traversal attempts', () => {
    expect(() => safePath(base, '../secrets.txt')).toThrowError('Path traversal blocked');
  });

  it('blocks ../../ directory traversal attempts', () => {
    expect(() => safePath(base, '../../secrets.txt')).toThrowError('Path traversal blocked');
  });

  it('blocks Windows-style traversal attempts with backslashes', () => {
    expect(() => safePath(base, '..\\secrets.txt')).toThrowError('Path traversal blocked');
  });

  it('preserves null bytes in path segments (current behavior)', () => {
    const resolved = safePath(base, 'valid\0path');
    expect(resolved).toBe(path.resolve(base, 'valid\0path'));
  });

  it('blocks absolute paths outside the base directory', () => {
    const absoluteOutside = path.resolve(base, '..', '..', 'outside-target', 'file.txt');
    expect(() => safePath(base, absoluteOutside)).toThrowError('Path traversal blocked');
  });

  it('allows a path that resolves exactly to base', () => {
    const resolved = safePath(base, '.');
    expect(resolved).toBe(path.resolve(base));
  });

  it('resolves dotted paths that stay inside base', () => {
    const resolved = safePath(base, `.${path.sep}subdir${path.sep}..${path.sep}valid`);
    expect(resolved).toBe(path.resolve(base, 'valid'));
  });

  it('normalizes trailing separators while staying in base', () => {
    const resolved = safePath(base, `subdir${path.sep}`);
    expect(resolved).toBe(path.resolve(base, 'subdir'));
  });

  it('accepts Windows-style separators in valid paths on Windows', () => {
    const resolved = safePath(base, `subdir\\nested\\file.txt`);
    if (process.platform === 'win32') {
      expect(resolved).toBe(path.resolve(base, 'subdir', 'nested', 'file.txt'));
      return;
    }

    expect(resolved).toBe(path.resolve(base, 'subdir\\nested\\file.txt'));
  });

  it('supports unicode characters in paths', () => {
    const resolved = safePath(base, path.join('子目录', 'файл.txt'));
    expect(resolved).toBe(path.resolve(base, '子目录', 'файл.txt'));
  });

  it('supports very long paths that remain under base', () => {
    const longRelative = Array.from({ length: 64 }, (_, index) => `segment-${index}`).join(path.sep);
    const resolved = safePath(base, longRelative);
    expect(resolved).toBe(path.resolve(base, longRelative));
  });

  it('resolves empty userPath to base', () => {
    const resolved = safePath(base, '');
    expect(resolved).toBe(path.resolve(base));
  });
});
