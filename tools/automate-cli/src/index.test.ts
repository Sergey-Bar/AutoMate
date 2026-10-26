import { afterEach, describe, expect, it, vi } from 'vitest';

const argv = process.argv;
afterEach(() => {
  process.argv = argv;
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

describe('the bin', () => {
  it('runs the command line it was started with and sets the exit code', async () => {
    process.argv = ['node', 'automate', '--help'];
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await import('./index.js');
    expect(written.join('')).toMatch(/^automate — send CI evidence/u);
    expect(process.exitCode).toBe(0);
  });
});
