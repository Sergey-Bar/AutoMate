import type { Stats } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * Reads a file the caller has already checked, through one open handle, so what is read is the
 * file that was checked (CodeQL `js/file-system-race`).
 *
 * A check by path and a read by path are two lookups, and between them the name can come to
 * mean something else: a symbolic link to a file outside the checkout, or a file grown past
 * the limit. Here the check is repeated on the handle that does the reading:
 *
 * - it must still be a regular file, the same one (`dev` and `ino`) the caller's `lstat` saw;
 * - it is read up to `maxBytes`, and one byte more means it is refused, whatever its size was
 *   when it was checked.
 *
 * @returns the bytes, or `null` when the file is no longer the one that was checked, or is over
 *   the limit
 */
export async function readCheckedFile(
  file: string,
  checked: Pick<Stats, 'dev' | 'ino'>,
  maxBytes: number,
): Promise<Buffer | null> {
  const handle = await open(file, 'r');
  try {
    const now = await handle.stat();
    if (!now.isFile() || now.dev !== checked.dev || now.ino !== checked.ino) return null;
    const buffer = Buffer.alloc(maxBytes + 1);
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return read > maxBytes ? null : buffer.subarray(0, read);
  } finally {
    await handle.close();
  }
}
