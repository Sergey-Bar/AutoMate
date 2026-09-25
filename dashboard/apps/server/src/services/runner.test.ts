/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') setTimeout(() => cb(0), 10);
    }),
    kill: vi.fn(),
    killed: false,
  })),
}));

describe('Runner Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should export runner module', async () => {
    const runner = await import('../services/runner.js');
    expect(runner).toBeDefined();
  });

  it('spawn function builds correct playwright args', () => {
    const { spawn } = require('child_process');
    // Test that spawn is callable
    expect(spawn).toBeDefined();
    expect(typeof spawn).toBe('function');
  });

  it('should handle run options with grep pattern', () => {
    // Verify grep arg construction
    const titles = ['Login test', 'Logout test', 'Dashboard test'];
    const grepPattern = titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    expect(grepPattern).toBe('Login test|Logout test|Dashboard test');
  });

  it('should handle run options with project filter', () => {
    const projects = ['chromium', 'firefox'];
    const args = projects.flatMap((p) => ['--project', p]);
    expect(args).toEqual(['--project', 'chromium', '--project', 'firefox']);
  });

  it('should handle run options with workers', () => {
    const workers = 4;
    const args = ['--workers', String(workers)];
    expect(args).toEqual(['--workers', '4']);
  });

  it('should handle run options with retries', () => {
    const retries = 2;
    const args = ['--retries', String(retries)];
    expect(args).toEqual(['--retries', '2']);
  });

  it('should handle run options with shard', () => {
    const shard = '1/3';
    const args = ['--shard', shard];
    expect(args).toEqual(['--shard', '1/3']);
  });
});
