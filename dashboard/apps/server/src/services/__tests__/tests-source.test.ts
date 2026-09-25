import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readTestSource } from '../tests-source.js';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs');
vi.mock('../../utils/safe-path.js', () => ({
  safePath: (base: string, file: string) => {
    if (file.includes('..')) throw new Error('Path traversal detected');
    return path.join(base, file);
  },
}));

describe('readTestSource', () => {
  const mockExistsSync = vi.mocked(fs.existsSync);
  const mockReadFileSync = vi.mocked(fs.readFileSync);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns success with full content when file exists and has < 500 lines', () => {
    const content = 'line1\nline2\nline3';
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(content);

    const result = readTestSource({ file: 'test.ts', baseDir: '/base' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe(content);
      expect(result.data.language).toBe('typescript');
      expect(result.data.file).toBe('test.ts');
      expect(result.data.startLine).toBe(1);
      expect(result.data.line).toBeUndefined();
    }
  });

  it('returns typescript language for .ts extension', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = readTestSource({ file: 'test.ts' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe('typescript');
    }
  });

  it('returns typescript language for .tsx extension', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = readTestSource({ file: 'component.tsx' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe('typescript');
    }
  });

  it('returns javascript language for .js extension', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = readTestSource({ file: 'script.js' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe('javascript');
    }
  });

  it('returns python language for .py extension', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = readTestSource({ file: 'script.py' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe('python');
    }
  });

  it('returns plaintext for unknown extension', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = readTestSource({ file: 'README.md' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.language).toBe('plaintext');
    }
  });

  it('returns invalid-path error when safePath throws', () => {
    const result = readTestSource({ file: '../../../etc/passwd' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('invalid-path');
      expect(result.error.message).toBe('Invalid file path');
    }
  });

  it('returns not-found error when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = readTestSource({ file: 'nonexistent.ts' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('not-found');
      expect(result.error.message).toBe('File not found');
    }
  });

  it('returns read-error when readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = readTestSource({ file: 'test.ts' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('read-error');
      expect(result.error.message).toBe('Failed to read file');
    }
  });

  it('truncates file to 500 lines around target line when file > 500 lines', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(content);

    const result = readTestSource({ file: 'large.ts', line: 500 });

    expect(result.success).toBe(true);
    if (result.success) {
      const resultLines = result.data.content.split('\n');
      expect(resultLines.length).toBe(500); // WINDOW=250 each side
      expect(result.data.startLine).toBe(251); // line 500 - 250 + 1
      expect(result.data.line).toBe(500);
      expect(resultLines[0]).toBe('line251');
      expect(resultLines[resultLines.length - 1]).toBe('line750');
    }
  });

  it('does not truncate when file <= 500 lines even with target line', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(content);

    const result = readTestSource({ file: 'medium.ts', line: 200 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toBe(content); // No truncation
      expect(result.data.startLine).toBe(1);
      expect(result.data.line).toBe(200);
    }
  });

  it('handles target line near start of large file', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(content);

    const result = readTestSource({ file: 'large.ts', line: 10 });

    expect(result.success).toBe(true);
    if (result.success) {
      const resultLines = result.data.content.split('\n');
      expect(resultLines.length).toBe(260); // from 0 to 10+250
      expect(result.data.startLine).toBe(1); // Math.max(0, 10-250)+1 = 1
      expect(resultLines[0]).toBe('line1');
    }
  });

  it('handles target line near end of large file', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line${i + 1}`);
    const content = lines.join('\n');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(content);

    const result = readTestSource({ file: 'large.ts', line: 990 });

    expect(result.success).toBe(true);
    if (result.success) {
      const resultLines = result.data.content.split('\n');
      expect(resultLines.length).toBe(260); // from 990-250 to 1000
      expect(result.data.startLine).toBe(741); // 990-250+1
      expect(resultLines[resultLines.length - 1]).toBe('line1000');
    }
  });

  it('uses process.cwd() as default baseDir', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = readTestSource({ file: 'test.ts' });

    expect(result.success).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith(
      expect.stringContaining('test.ts'),
    );
  });

  it('uses provided baseDir when specified', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('content');

    const result = readTestSource({ file: 'test.ts', baseDir: '/custom' });

    expect(result.success).toBe(true);
    expect(mockExistsSync).toHaveBeenCalledWith(
      expect.stringMatching(/custom.*test\.ts/),
    );
  });
});
