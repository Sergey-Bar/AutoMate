// Reads a file through one handle: the size check, the type check and the read all see the
// same file, so a path swapped or grown between a stat and a read cannot slip past the limit
// (CodeQL js/file-system-race). Opening is the caller's failure to classify; it throws.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { open } from 'node:fs/promises';

/**
 * @typedef {import('node:fs').Stats} Stats
 * @typedef {{ status: 'ok', bytes: Uint8Array, info: Stats }
 *   | { status: 'too-large', info: Stats }
 *   | { status: 'not-a-file' }} BoundedRead
 */

/**
 * @param {Stats} info
 * @param {number} maxBytes
 * @returns {BoundedRead | null} a verdict, or null when the read should go ahead
 */
function verdictBeforeRead(info, maxBytes) {
  if (!info.isFile()) return { status: 'not-a-file' };
  if (info.size > maxBytes) return { status: 'too-large', info };
  return null;
}

/**
 * @param {Stats} info
 * @param {Buffer} buffer one byte longer than the observed size
 * @param {number} read
 * @returns {BoundedRead}
 */
function verdictAfterRead(info, buffer, read) {
  // A byte past the observed size means the file grew while it was read.
  if (read > info.size) return { status: 'too-large', info };
  return { status: 'ok', bytes: new Uint8Array(buffer.subarray(0, read)), info };
}

/**
 * @param {string} file
 * @param {number} maxBytes
 * @returns {Promise<BoundedRead>}
 */
export async function readFileBounded(file, maxBytes) {
  const handle = await open(file, 'r');
  try {
    const info = await handle.stat();
    const early = verdictBeforeRead(info, maxBytes);
    if (early !== null) return early;
    const buffer = Buffer.alloc(info.size + 1);
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await handle.read(buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return verdictAfterRead(info, buffer, read);
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} file
 * @param {number} maxBytes
 * @returns {BoundedRead}
 */
export function readFileBoundedSync(file, maxBytes) {
  const fd = openSync(file, 'r');
  try {
    const info = fstatSync(fd);
    const early = verdictBeforeRead(info, maxBytes);
    if (early !== null) return early;
    const buffer = Buffer.alloc(info.size + 1);
    let read = 0;
    while (read < buffer.length) {
      const bytesRead = readSync(fd, buffer, read, buffer.length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return verdictAfterRead(info, buffer, read);
  } finally {
    closeSync(fd);
  }
}
