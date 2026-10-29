import { lstat, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCheckedFile } from './checked-file.js';

/**
 * A file read is the file that was checked (CodeQL `js/file-system-race`). The race itself
 * cannot be timed in a test, so its two outcomes are written down directly: the name now
 * naming a different file, and the file now past the limit.
 */
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'checked-file-'));
  dirs.push(dir);
  return dir;
}

describe('readCheckedFile', () => {
  it('reads the file that was checked', async () => {
    const file = path.join(await directory(), 'a.md');
    await writeFile(file, 'hello');
    expect((await readCheckedFile(file, await lstat(file), 10))?.toString('utf8')).toBe('hello');
  });

  it('refuses a name that now means another file', async () => {
    const dir = await directory();
    const checked = path.join(dir, 'checked.md');
    const swapped = path.join(dir, 'swapped.md');
    await writeFile(checked, 'the file that was checked');
    await writeFile(swapped, 'what the name now points at');
    // The identity the caller saw, against what the name holds when it is opened.
    expect(await readCheckedFile(swapped, await lstat(checked), 100)).toBeNull();
  });

  it('refuses a file over the limit at the moment it is read, whatever it was before', async () => {
    const file = path.join(await directory(), 'grown.md');
    await writeFile(file, 'small');
    const checked = await lstat(file);
    await writeFile(file, 'x'.repeat(64));
    expect(await readCheckedFile(file, checked, 10)).toBeNull();
    expect((await readCheckedFile(file, checked, 64))?.length).toBe(64);
  });
});
