import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DurableSpool, readOrCreateSpoolKey } from '@automate/runner-sdk';
import { readStoredToken, writeStoredToken } from './token-store.js';

describe('the runner credential kept between restarts', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'runner-token-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reads back what was written, for the runner that wrote it', async () => {
    const directory = join(root, 'not-yet-created');
    await writeStoredToken(directory, 'runner-1', 'secret-token-value');
    expect(await readStoredToken(directory, 'runner-1')).toBe('secret-token-value');
  });

  it('is empty when nothing was ever written, so a first start registers as a new runner', async () => {
    expect(await readStoredToken(join(root, 'absent'), 'runner-1')).toBe('');
  });

  it('is empty for a different runner id, so a token is never presented for an identity it was not issued to', async () => {
    await writeStoredToken(root, 'runner-1', 'secret-token-value');
    expect(await readStoredToken(root, 'runner-2')).toBe('');
  });

  it('treats a damaged file as no token rather than failing the start', async () => {
    await writeFile(join(root, 'runner-token.json'), '{ not json', 'utf8');
    expect(await readStoredToken(root, 'runner-1')).toBe('');
    await writeFile(join(root, 'runner-token.json'), JSON.stringify({ runnerId: 'runner-1' }));
    expect(await readStoredToken(root, 'runner-1')).toBe('');
  });

  it('replaces the previous token when the credential is rotated', async () => {
    await writeStoredToken(root, 'runner-1', 'first');
    await writeStoredToken(root, 'runner-1', 'second');
    expect(await readStoredToken(root, 'runner-1')).toBe('second');
  });

  it('creates the spool directory private, so the spool that shares it can open', async () => {
    // The runner writes its token into the spool directory before the spool opens. Created
    // with the umask (0755), the directory was refused by DurableSpool.open on POSIX, and the
    // runner died at startup with SpoolError. Windows has no mode bits.
    const directory = join(root, 'spool');
    await writeStoredToken(directory, 'runner-1', 'secret-token-value');
    if (process.platform !== 'win32') expect((await stat(directory)).mode & 0o777).toBe(0o700);
    const key = await readOrCreateSpoolKey(join(directory, 'spool.key'));
    await expect(DurableSpool.open({ directory, key })).resolves.toBeInstanceOf(DurableSpool);
  });

  it('is readable by its owner only where the platform has file modes', async () => {
    await writeStoredToken(root, 'runner-1', 'secret-token-value');
    const mode = (await stat(join(root, 'runner-token.json'))).mode & 0o777;
    if (process.platform !== 'win32') expect(mode).toBe(0o600);
    expect(await readFile(join(root, 'runner-token.json'), 'utf8')).toContain('runner-1');
  });
});
