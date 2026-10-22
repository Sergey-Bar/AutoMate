/**
 * The release bundle: one zip a user downloads, unpacks and runs `start` from.
 *
 * Dependency-free on purpose (scripts stay dependency-free, AGENTS.md), so this carries
 * a small ZIP writer: deflate from `node:zlib`, CRC-32 from `zlib.crc32`, and the unix
 * mode in each entry's external attributes so `start.sh` unpacks executable. Every entry
 * gets the same fixed timestamp, so two bundles of one commit are byte-identical and
 * `SHA256SUMS` means something across rebuilds.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';
import { envExample, releaseComposeFile } from './release-compose.mjs';

/** What a bundle contains, inside its `automate-<version>/` folder. */
export const BUNDLE_FILES = [
  'compose.yml',
  '.env.example',
  'start.sh',
  'start.ps1',
  'start.cmd',
  'QUICKSTART.md',
  'LICENSE',
];

/** 1980-01-01 00:00, the earliest DOS date: a fixed stamp makes the zip reproducible. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const UTF8_NAMES = 0x0800;
const DEFLATE = 8;
const MADE_BY_UNIX = (3 << 8) | 20;

/**
 * @typedef {{ name: string, data: Buffer, mode: number }} ZipEntry
 */

/**
 * A ZIP archive of the given entries, in order.
 *
 * @param {ZipEntry[]} entries
 * @returns {Buffer}
 */
export function writeZip(entries) {
  /** @type {Buffer[]} */
  const locals = [];
  /** @type {Buffer[]} */
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = deflateRawSync(entry.data, { level: 9 });
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(MADE_BY_UNIX, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(DEFLATE, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    // A regular file (0o100000) with the entry's permission bits, in the high word.
    central.writeUInt32LE(((0o100000 | entry.mode) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/**
 * The entries of a ZIP this module wrote (no archive comment, no ZIP64).
 *
 * @param {Buffer} zip
 * @returns {ZipEntry[]}
 */
export function readZip(zip) {
  const end = zip.length - 22;
  if (zip.readUInt32LE(end) !== 0x06054b50) throw new Error('not a zip written by writeZip');
  const count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  /** @type {ZipEntry[]} */
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const size = zip.readUInt32LE(cursor + 20);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const mode = (zip.readUInt32LE(cursor + 38) >>> 16) & 0o777;
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = inflateRawSync(zip.subarray(dataStart, dataStart + size));
    entries.push({ name, data, mode });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * `sha256sum`-format lines for the given files.
 *
 * @param {Array<{ name: string, data: Buffer }>} files
 * @returns {string}
 */
export function sha256sums(files) {
  return files
    .map(({ name, data }) => `${createHash('sha256').update(data).digest('hex')}  ${name}\n`)
    .join('');
}

/** @param {string} text @returns {string} */
function crlf(text) {
  return text.replace(/\r?\n/g, '\r\n');
}

/** @param {string} text @returns {string} */
function lf(text) {
  return text.replace(/\r\n/g, '\n');
}

/**
 * Write `automate-<version>.zip` and `SHA256SUMS` into `out`.
 *
 * Line endings are set here rather than trusted from the checkout: `start.sh` must be LF
 * or `sh` reads `\r` as part of each command, and the Windows files are CRLF.
 *
 * @param {{ root: string, version: string, out: string }} options
 * @returns {{ zipPath: string, sumsPath: string, folder: string }}
 */
export function buildBundle({ root, version, out }) {
  /** @param {string} relative */
  const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
  const folder = `automate-${version}`;
  const compose = releaseComposeFile(read('infra/compose/docker-compose.unified.yml'), version);

  /** @type {Record<string, { text: string, mode: number }>} */
  const files = {
    'compose.yml': { text: lf(compose), mode: 0o644 },
    '.env.example': { text: lf(envExample(compose)), mode: 0o644 },
    'start.sh': { text: lf(read('infra/release/start.sh')), mode: 0o755 },
    'start.ps1': { text: crlf(read('infra/release/start.ps1')), mode: 0o644 },
    'start.cmd': { text: crlf(read('infra/release/start.cmd')), mode: 0o644 },
    'QUICKSTART.md': {
      text: lf(read('infra/release/QUICKSTART.md').replaceAll('{{VERSION}}', version)),
      mode: 0o644,
    },
    LICENSE: { text: lf(read('LICENSE')), mode: 0o644 },
  };
  const zip = writeZip(
    BUNDLE_FILES.map((name) => {
      const file = files[name];
      if (file === undefined) throw new Error(`no source for bundle file ${name}`);
      return { name: `${folder}/${name}`, data: Buffer.from(file.text, 'utf8'), mode: file.mode };
    }),
  );
  mkdirSync(out, { recursive: true });
  const zipPath = path.join(out, `${folder}.zip`);
  const sumsPath = path.join(out, 'SHA256SUMS');
  writeFileSync(zipPath, zip);
  writeFileSync(sumsPath, sha256sums([{ name: `${folder}.zip`, data: zip }]));
  return { zipPath, sumsPath, folder };
}
