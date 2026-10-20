// Not a test. Builds ZIP archives for the importer tests, including damaged and hostile ones.
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * @typedef {{ name: string, data?: Uint8Array | string, method?: 0 | 8 | number, flags?: number,
 *   crc?: number, size?: number, compressedSize?: number, raw?: Buffer, localOffset?: number }} Spec
 */

/**
 * @param {Spec[]} specs
 * @param {{ comment?: string, count?: number }} [options]
 * @returns {Buffer}
 */
export function buildZip(specs, options = {}) {
  /** @type {Buffer[]} */
  const parts = [];
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  for (const spec of specs) {
    const data = Buffer.from(spec.data ?? '');
    const method = spec.method ?? 8;
    const body = spec.raw ?? (method === 8 ? deflateRawSync(data) : data);
    const name = Buffer.from(spec.name, 'utf8');
    const flags = spec.flags ?? 0x800;
    const crc = spec.crc ?? crc32(data);
    const size = spec.size ?? data.length;
    const compressedSize = spec.compressedSize ?? body.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(compressedSize, 20);
    entry.writeUInt32LE(size, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(spec.localOffset ?? offset, 42);
    central.push(entry, name);
    offset += 30 + name.length + body.length;
  }
  const centralBytes = Buffer.concat(central);
  const comment = Buffer.from(options.comment ?? '');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(options.count ?? specs.length, 8);
  eocd.writeUInt16LE(options.count ?? specs.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  return Buffer.concat([...parts, centralBytes, eocd, comment]);
}
