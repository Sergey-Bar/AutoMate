/**
 * A small, defensive ZIP reader for CI artifact archives (Phase 5).
 *
 * It reads and decompresses entries into memory. It never writes an entry to disk, so an entry
 * name such as `../../x` is a label and nothing else; a test checks that nothing is created.
 *
 * Supported: the central directory, stored and deflate entries, UTF-8 or legacy names.
 * Refused, each with a reason and without stopping the rest of the archive: encrypted entries,
 * ZIP64, other compression methods, entries whose data lies outside the file, entries that
 * inflate to more than their declared size or the limit, and entries whose CRC-32 or size
 * does not match. Multi-disk archives are refused as a whole.
 */
import { crc32, inflateRawSync } from 'node:zlib';

export const ZIP_LIMITS = {
  maxEntries: 20_000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 256 * 1024 * 1024,
};

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * @typedef {{ name: string, method: number, flags: number, crc: number, compressedSize: number,
 *   size: number, localOffset: number, directory: boolean, problem: string | null }} ZipEntry
 */

/**
 * @param {Uint8Array} bytes
 * @param {Partial<typeof ZIP_LIMITS>} [overrides]
 * @returns {{ ok: true, entries: ZipEntry[] } | { ok: false, reason: string }}
 */
export function listZip(bytes, overrides = {}) {
  const limits = { ...ZIP_LIMITS, ...overrides };
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 22) return { ok: false, reason: 'not-a-zip' };
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65_535); i -= 1) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return { ok: false, reason: 'not-a-zip' };
  const disk = buffer.readUInt16LE(eocd + 4);
  const cdDisk = buffer.readUInt16LE(eocd + 6);
  const count = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0) return { ok: false, reason: 'multi-disk' };
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff)
    return { ok: false, reason: 'zip64-not-supported' };
  if (count > limits.maxEntries) return { ok: false, reason: 'too-many-entries' };
  if (cdOffset + cdSize > eocd) return { ok: false, reason: 'bad-central-directory' };

  /** @type {ZipEntry[]} */
  const entries = [];
  let at = cdOffset;
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== CENTRAL)
      return { ok: false, reason: 'bad-central-directory' };
    const flags = buffer.readUInt16LE(at + 8);
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const size = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localOffset = buffer.readUInt32LE(at + 42);
    if (at + 46 + nameLength > buffer.length) return { ok: false, reason: 'bad-central-directory' };
    const rawName = buffer.subarray(at + 46, at + 46 + nameLength);
    const name = (flags & 0x800) !== 0 ? rawName.toString('utf8') : rawName.toString('latin1');
    const directory = name.endsWith('/');
    /** @type {string | null} */
    let problem = null;
    if ((flags & 0x1) !== 0) problem = 'encrypted';
    else if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff)
      problem = 'zip64-not-supported';
    else if (method !== 0 && method !== 8) problem = 'unsupported-method';
    else if (size > limits.maxEntryBytes) problem = 'entry-too-large';
    entries.push({
      name,
      method,
      flags,
      crc,
      compressedSize,
      size,
      localOffset,
      directory,
      problem,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { ok: true, entries };
}

/**
 * The bytes of one entry, checked.
 *
 * @param {Uint8Array} bytes the whole archive
 * @param {ZipEntry} entry
 * @param {Partial<typeof ZIP_LIMITS>} [overrides]
 * @returns {{ ok: true, bytes: Uint8Array } | { ok: false, reason: string }}
 */
export function readEntry(bytes, entry, overrides = {}) {
  const limits = { ...ZIP_LIMITS, ...overrides };
  if (entry.problem !== null) return { ok: false, reason: entry.problem };
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL)
    return { ok: false, reason: 'bad-local-header' };
  const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) return { ok: false, reason: 'data-outside-archive' };
  const raw = buffer.subarray(start, end);
  /** @type {Buffer} */
  let data;
  if (entry.method === 0) {
    if (entry.compressedSize !== entry.size) return { ok: false, reason: 'size-mismatch' };
    data = raw;
  } else {
    try {
      data = inflateRawSync(raw, {
        maxOutputLength: Math.min(entry.size, limits.maxEntryBytes) + 1,
      });
    } catch (error) {
      const code = /** @type {{ code?: string }} */ (error).code;
      return {
        ok: false,
        reason: code === 'ERR_BUFFER_TOO_LARGE' ? 'inflates-past-declared-size' : 'corrupt-data',
      };
    }
  }
  if (data.length !== entry.size)
    return {
      ok: false,
      reason: data.length > entry.size ? 'inflates-past-declared-size' : 'size-mismatch',
    };
  if (crc32(data) !== entry.crc) return { ok: false, reason: 'crc-mismatch' };
  return { ok: true, bytes: new Uint8Array(data) };
}
