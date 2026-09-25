import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, truncate, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';

const IV_BYTES = 12;
const TAG_BYTES = 16;
const LENGTH_BYTES = 4;
const MIN_SEALED_BYTES = IV_BYTES + TAG_BYTES;
const MAX_SEALED_BYTES = 4 * 1024 * 1024;
const KEY_ID_BYTES = 32;
const SPOOL_MAGIC = Buffer.from('automate-runner-spool/v1\n', 'utf8');
const HEADER_BYTES = SPOOL_MAGIC.length + KEY_ID_BYTES;
const DEFAULT_DIRECTORY = resolve(tmpdir(), 'automate-runner-spool');
const DEFAULT_NAME = 'events.spool';
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const DEFAULT_COMPACT_THRESHOLD_BYTES = 8 * 1024 * 1024;
const DEFAULT_PEEK_LIMIT = 100;
const EMPTY = Buffer.alloc(0);

export type SpoolIntegrityCode =
  | 'SPOOL_FORMAT'
  | 'SPOOL_WRONG_KEY'
  | 'SPOOL_TAMPERED'
  | 'SPOOL_TRUNCATED';

export class SpoolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpoolError';
  }
}

export class SpoolPathError extends SpoolError {
  constructor(message: string) {
    super(message);
    this.name = 'SpoolPathError';
  }
}

export class SpoolCapacityError extends SpoolError {
  constructor(message: string) {
    super(message);
    this.name = 'SpoolCapacityError';
  }
}

export class SpoolIntegrityError extends SpoolError {
  constructor(
    readonly code: SpoolIntegrityCode,
    message: string,
  ) {
    super(message);
    this.name = 'SpoolIntegrityError';
  }
}

export class EncryptedSpool {
  private readonly key: Buffer;

  constructor(key: Buffer | string = randomBytes(32)) {
    const material = typeof key === 'string' ? EncryptedSpool.deriveKey(key) : key;
    if (material.length !== 32) throw new SpoolError('Spool key must be 32 bytes');
    this.key = material;
  }

  static deriveKey(secret: string, purpose = 'automate-runner-spool'): Buffer {
    if (!secret) throw new SpoolError('Spool key secret must not be empty');
    return scryptSync(secret, purpose, 32);
  }

  keyId(): string {
    return createHash('sha256').update(this.key).digest('hex').slice(0, KEY_ID_BYTES);
  }

  seal<T>(record: T): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(record), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  open<T>(value: Buffer): T {
    if (value.length < MIN_SEALED_BYTES) {
      throw new SpoolIntegrityError('SPOOL_TRUNCATED', 'Spool frame is shorter than its envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, value.subarray(0, IV_BYTES));
    decipher.setAuthTag(value.subarray(IV_BYTES, MIN_SEALED_BYTES));
    let plaintext: string;
    try {
      plaintext = Buffer.concat([
        decipher.update(value.subarray(MIN_SEALED_BYTES)),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new SpoolIntegrityError('SPOOL_TAMPERED', 'Spool frame failed authentication');
    }
    try {
      return JSON.parse(plaintext) as T;
    } catch {
      throw new SpoolIntegrityError('SPOOL_FORMAT', 'Spool frame payload is not valid JSON');
    }
  }
}

export type SpoolConflictReason =
  | 'stale_lease'
  | 'terminal_event'
  | 'sequence_gap'
  | 'event_hash_mismatch'
  | 'run_not_found'
  | 'unknown';

export type SpoolEntryDisposition = 'retry' | 'dead_letter';

export interface SpoolDeliveryConflict {
  reason: SpoolConflictReason;
  eventId?: string;
}

export interface SpoolRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_SPOOL_RETRY_POLICY: SpoolRetryPolicy = {
  maxAttempts: 8,
  baseDelayMs: 250,
  maxDelayMs: 30_000,
};

export interface SpoolEntry {
  id: string;
  jobId: string;
  kind: 'event' | 'completion';
  sequence: number;
  leaseId: string;
  fencingToken: number;
  payload: unknown;
  attempts?: number;
  lastError?: string;
}

export interface SpoolQueue {
  enqueue(entry: SpoolEntry): Promise<void>;
  peek(limit?: number): Promise<SpoolEntry[]>;
  ack(ids: readonly string[]): Promise<void>;
  compact(): Promise<void>;
  pending(): number;
  lastSequence(jobId: string): number;
}

export interface DurableSpoolOptions {
  key: Buffer | string;
  directory?: string;
  name?: string;
  maxEntries?: number;
  maxBytes?: number;
  tornTail?: 'fail' | 'drop';
  compactThresholdBytes?: number;
}

export class MemorySpool implements SpoolQueue {
  private entries: SpoolEntry[] = [];
  private readonly sequences = new Map<string, number>();

  constructor(private readonly maxEntries = DEFAULT_MAX_ENTRIES) {}

  async enqueue(entry: SpoolEntry): Promise<void> {
    if (this.entries.length >= this.maxEntries) {
      throw new SpoolCapacityError('Runner spool is full');
    }
    this.entries = [...this.entries, entry];
    this.remember(entry);
  }

  async peek(limit = DEFAULT_PEEK_LIMIT): Promise<SpoolEntry[]> {
    return this.entries.slice(0, limit);
  }

  async ack(ids: readonly string[]): Promise<void> {
    const settled = new Set(ids);
    this.entries = this.entries.filter((entry) => !settled.has(entry.id));
  }

  async compact(): Promise<void> {}

  pending(): number {
    return this.entries.length;
  }

  lastSequence(jobId: string): number {
    return Math.max(this.sequences.get(jobId) ?? 0, highestSequence(this.entries, jobId));
  }

  private remember(entry: SpoolEntry): void {
    this.sequences.set(entry.jobId, Math.max(this.sequences.get(entry.jobId) ?? 0, entry.sequence));
  }
}

export class DurableSpool implements SpoolQueue {
  private readonly codec: EncryptedSpool;
  private readonly path: string;
  private readonly sequencePath: string;
  private readonly ackPath: string;
  private readonly sequences: Map<string, number>;
  private readonly acknowledged = new Set<string>();
  private entries: SpoolEntry[];

  private constructor(
    codec: EncryptedSpool,
    path: string,
    sequencePath: string,
    ackPath: string,
    acknowledged: Set<string>,
    sequences: Map<string, number>,
    entries: SpoolEntry[],
    private committedBytes: number,
    private fileBytes: number,
    private readonly maxEntries: number,
    private readonly maxBytes: number,
    private readonly compactThresholdBytes: number,
  ) {
    this.codec = codec;
    this.path = path;
    this.sequencePath = sequencePath;
    this.ackPath = ackPath;
    for (const id of acknowledged) this.acknowledged.add(id);
    this.sequences = sequences;
    this.entries = entries;
  }

  static async open(options: DurableSpoolOptions): Promise<DurableSpool> {
    const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    const compactThresholdBytes = options.compactThresholdBytes ?? DEFAULT_COMPACT_THRESHOLD_BYTES;
    if (maxEntries < 1 || maxBytes < 1 || compactThresholdBytes < 1) {
      throw new SpoolError('Runner spool limits must be positive');
    }
    const directory = resolve(options.directory ?? DEFAULT_DIRECTORY);
    const path = containedPath(directory, options.name ?? DEFAULT_NAME);
    const codec = new EncryptedSpool(options.key);
    await mkdir(directory, { recursive: true });
    const data = await readOptional(path);
    const { entries, committedBytes } = decodeFile(codec, data, options.tornTail ?? 'fail');
    const sequencePath = `${path}.sequences`;
    const ackPath = `${path}.acks`;
    const acknowledged = await readAckState(ackPath);
    const sequences = await readSequenceState(sequencePath, codec.keyId());
    for (const entry of entries) {
      sequences.set(entry.jobId, Math.max(sequences.get(entry.jobId) ?? 0, entry.sequence));
    }
    const spool = new DurableSpool(
      codec,
      path,
      sequencePath,
      ackPath,
      acknowledged,
      sequences,
      entries.filter((entry) => !acknowledged.has(entry.id)),
      committedBytes,
      data.length,
      maxEntries,
      maxBytes,
      compactThresholdBytes,
    );
    if (acknowledged.size > 0) await spool.compact();
    return spool;
  }

  async enqueue(entry: SpoolEntry): Promise<void> {
    const frame = this.frame(entry);
    if (this.entries.length >= this.maxEntries || this.committedBytes + frame.length > this.maxBytes) {
      throw new SpoolCapacityError('Runner spool is full');
    }
    const prefix = this.committedBytes === 0 ? this.header() : EMPTY;
    if (this.fileBytes > this.committedBytes) await truncate(this.path, this.committedBytes);
    await appendFile(this.path, Buffer.concat([prefix, frame]));
    this.entries = [...this.entries, entry];
    this.remember(entry);
    this.committedBytes += prefix.length + frame.length;
    this.fileBytes = this.committedBytes;
  }

  async peek(limit = DEFAULT_PEEK_LIMIT): Promise<SpoolEntry[]> {
    return this.entries.slice(0, limit);
  }

  async ack(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    const settled = new Set(ids);
    const remaining = this.entries.filter((entry) => !settled.has(entry.id));
    if (remaining.length === this.entries.length) return;
    this.entries = remaining;
    for (const id of settled) this.acknowledged.add(id);
    await this.persistAcknowledgements();
    await this.persistSequences();
    if (this.entries.length === 0 || this.committedBytes > this.compactThresholdBytes) {
      await this.compact();
    }
  }

  async compact(): Promise<void> {
    if (this.entries.length === 0 && this.committedBytes === 0) {
      await this.persistAcknowledgements();
      return;
    }
    const buffer = this.encode(this.entries);
    const temporary = `${this.path}.compact`;
    await writeFile(temporary, buffer, { mode: 0o600 });
    await rename(temporary, this.path);
    this.committedBytes = buffer.length;
    this.fileBytes = buffer.length;
    this.acknowledged.clear();
    await this.persistAcknowledgements();
  }

  pending(): number {
    return this.entries.length;
  }

  lastSequence(jobId: string): number {
    return Math.max(this.sequences.get(jobId) ?? 0, highestSequence(this.entries, jobId));
  }

  private remember(entry: SpoolEntry): void {
    this.sequences.set(entry.jobId, Math.max(this.sequences.get(entry.jobId) ?? 0, entry.sequence));
  }

  private async persistAcknowledgements(): Promise<void> {
    const temporary = `${this.ackPath}.tmp`;
    await writeFile(temporary, JSON.stringify([...this.acknowledged]), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.ackPath);
  }

  private async persistSequences(): Promise<void> {
    const temporary = `${this.sequencePath}.tmp`;
    const value = {
      keyId: this.codec.keyId(),
      sequences: Object.fromEntries(this.sequences),
    };
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.sequencePath);
  }

  private header(): Buffer {
    return Buffer.concat([SPOOL_MAGIC, Buffer.from(this.codec.keyId(), 'utf8')]);
  }

  private frame(entry: SpoolEntry): Buffer {
    const sealed = this.codec.seal(entry);
    const length = Buffer.alloc(LENGTH_BYTES);
    length.writeUInt32BE(sealed.length);
    return Buffer.concat([length, sealed]);
  }

  private encode(entries: readonly SpoolEntry[]): Buffer {
    const frames = entries.map((entry) => this.frame(entry));
    return Buffer.concat([this.header(), ...frames]);
  }
}

export async function readOrCreateSpoolKey(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true });
  const existing = (await readOptional(path)).toString('utf8').trim();
  if (existing) return existing;
  const generated = randomBytes(32).toString('hex');
  try {
    await writeFile(path, `${generated}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    return generated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const raced = (await readFile(path, 'utf8')).trim();
    if (!raced) throw new SpoolError('Runner spool key file is empty');
    return raced;
  }
}

async function readAckState(path: string): Promise<Set<string>> {
  const data = await readOptional(path);
  if (data.length === 0) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool acknowledgement state is invalid');
  }
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== 'string' || !id)) {
    throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool acknowledgement state is invalid');
  }
  return new Set(parsed as string[]);
}

async function readSequenceState(path: string, keyId: string): Promise<Map<string, number>> {
  const data = await readOptional(path);
  if (data.length === 0) return new Map();
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString('utf8'));
  } catch {
    throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool sequence state is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool sequence state is not an object');
  }
  const value = parsed as { keyId?: unknown; sequences?: unknown };
  if (value.keyId !== keyId) {
    throw new SpoolIntegrityError('SPOOL_WRONG_KEY', 'Runner spool sequence state key does not match');
  }
  if (!value.sequences || typeof value.sequences !== 'object' || Array.isArray(value.sequences)) {
    throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool sequence state is invalid');
  }
  const sequences = new Map<string, number>();
  for (const [jobId, sequence] of Object.entries(value.sequences as Record<string, unknown>)) {
    if (!jobId || !Number.isInteger(sequence) || (sequence as number) < 0) {
      throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool sequence state is invalid');
    }
    sequences.set(jobId, sequence as number);
  }
  return sequences;
}

function containedPath(directory: string, name: string): string {
  if (!name || isAbsolute(name) || name.includes('/') || name.includes('\\') || name.includes('..')) {
    throw new SpoolPathError('Spool file name must be a single relative path segment');
  }
  const target = resolve(directory, name);
  const inside = relative(resolve(directory), target);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) {
    throw new SpoolPathError('Spool file escapes the configured spool root');
  }
  return target;
}

function highestSequence(entries: readonly SpoolEntry[], jobId: string): number {
  let highest = 0;
  for (const entry of entries) {
    if (entry.jobId === jobId && entry.sequence > highest) highest = entry.sequence;
  }
  return highest;
}

function isSpoolEntry(value: unknown): value is SpoolEntry {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SpoolEntry>;
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    typeof candidate.jobId === 'string' &&
    candidate.jobId.length > 0 &&
    (candidate.kind === 'event' || candidate.kind === 'completion') &&
    Number.isInteger(candidate.sequence) &&
    typeof candidate.leaseId === 'string' &&
    Number.isInteger(candidate.fencingToken) &&
    candidate.payload !== undefined
  );
}

function decodeFile(
  codec: EncryptedSpool,
  data: Buffer,
  tornTail: 'fail' | 'drop',
): { entries: SpoolEntry[]; committedBytes: number } {
  if (data.length === 0) return { entries: [], committedBytes: 0 };
  if (data.length < HEADER_BYTES || !data.subarray(0, SPOOL_MAGIC.length).equals(SPOOL_MAGIC)) {
    throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool file header is not readable');
  }
  if (data.subarray(SPOOL_MAGIC.length, HEADER_BYTES).toString('utf8') !== codec.keyId()) {
    throw new SpoolIntegrityError('SPOOL_WRONG_KEY', 'Runner spool key does not match the sealed queue');
  }
  const entries: SpoolEntry[] = [];
  let offset = HEADER_BYTES;
  while (offset < data.length) {
    if (data.length - offset < LENGTH_BYTES + MIN_SEALED_BYTES) {
      if (tornTail === 'fail') throw torn();
      break;
    }
    const length = data.readUInt32BE(offset);
    if (length < MIN_SEALED_BYTES || length > MAX_SEALED_BYTES) {
      throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool frame length is out of range');
    }
    const end = offset + LENGTH_BYTES + length;
    if (end > data.length) {
      if (tornTail === 'fail') throw torn();
      break;
    }
    entries.push(readEntry(codec, data.subarray(offset + LENGTH_BYTES, end)));
    offset = end;
  }
  return { entries, committedBytes: offset };
}

function torn(): SpoolIntegrityError {
  return new SpoolIntegrityError('SPOOL_TRUNCATED', 'Runner spool ends with a partial frame');
}

function readEntry(codec: EncryptedSpool, sealed: Buffer): SpoolEntry {
  const record = codec.open<unknown>(sealed);
  if (!isSpoolEntry(record)) {
    throw new SpoolIntegrityError('SPOOL_FORMAT', 'Runner spool frame is not a queue entry');
  }
  return record;
}

async function readOptional(path: string): Promise<Buffer> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw error;
  }
}
