import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, truncate, writeFile } from 'node:fs/promises';
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
  /**
   * `cause` is preserved because this error is a translation of a lower-level one.
   *
   * The standard `Error(message, { cause })` shape is used deliberately: an operator
   * reading "the spool path is not a directory" still needs the `EEXIST`/`ENOTDIR`
   * underneath to tell a path typo from a file sitting where the spool belongs, and
   * wrapping without carrying it discards the only part that identifies the fault.
   *
   * @param message what went wrong, in terms an operator can act on
   * @param options the underlying error, when this is a translation of one
   */
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
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

/**
 * One entry is larger than a sealed frame is allowed to be.
 *
 * A distinct class rather than a `SpoolCapacityError` on purpose. Capacity means
 * "the queue is full, try again later", and an oversized *entry* is not that: the
 * queue may be 3% full. A caller obeying the capacity contract would retry the same
 * 5 MB event forever against a file with room to spare, so the two refusals have to
 * be tellable apart at the call site — one is transient, the other never resolves.
 */
export class SpoolFrameTooLargeError extends SpoolError {
  constructor(
    readonly limitBytes: number,
    readonly entryBytes: number,
  ) {
    super(
      `Runner spool entry seals to ${String(entryBytes)} bytes, above the ` +
        `${String(limitBytes)}-byte frame limit. The event is too large to spool; ` +
        'split it, or reduce what the event carries.',
    );
    this.name = 'SpoolFrameTooLargeError';
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

/**
 * Whether a thrown value means the spool path is not a usable directory.
 *
 * `ENOTDIR` is a path component that is not a directory; `EEXIST` under `recursive` is
 * the final component existing as something else. Both are the same fault to whoever
 * reads the message — something other than a directory is at the spool path — so both
 * are reported as one. Matched on the code rather than the message, so a Node version
 * that words it differently is still recognised.
 *
 * @param cause the value `mkdir` threw
 * @returns true when the path is occupied by something that is not a directory
 */
function isPathOccupiedByFile(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const code = (cause as { code?: unknown }).code;
  return code === 'ENOTDIR' || code === 'EEXIST';
}

/**
 * The mode a spool directory is created with: owner-only.
 *
 * A spool holds sealed frames — encrypted, so their contents are not readable, but the
 * frames are still a queue an attacker can delete, reorder by truncation, or replace
 * with their own sealed data if they can also obtain the key. Owner-only is the
 * smallest mode that keeps a second local account out of it entirely.
 */
const SPOOL_DIRECTORY_MODE = 0o700;

/**
 * The decision, separated from the I/O, so it is testable on every platform.
 *
 * This is the substantive part of {@link assertPrivateDirectory} and it is a pure
 * function of a stat result. That split is not tidiness — it is what makes the guards
 * verifiable at all on Windows, where the file-level test cannot create a foreign uid
 * or read a meaningful mode. `node --test` on a developer machine and CI both run on
 * Windows runners as well as Linux ones, so a policy reachable only on POSIX is a
 * policy that is checked only sometimes, and this way it is checked always.
 *
 * The checks are deliberately strict, because each one has a real failure behind it:
 *
 *  - **Not a directory.** `mkdir` with `recursive: true` does not reach here for a
 *    file at the final component — that is translated at the call site — but a
 *    path component that is a file produces `ENOTDIR` and never arrives. The check
 *    stays because the stat is the authority on what the path now is.
 *  - **Mode.** A group- or world-accessible directory has already leaked the queue's
 *    existence and shape. POSIX-only: `stat` on Windows reports a synthetic mode and a
 *    `mkdtemp` directory reads back as `0666`, so checking it there would either
 *    refuse every Windows install or be loosened until it checks nothing.
 *  - **Ownership.** A directory owned by another uid is writable by them whatever the
 *    mode says, so `0o700` applied to a foreign directory protects nothing.
 *
 * @param stats the stat result for the directory
 * @param platform the value of `process.platform`, injected so both branches are reachable
 * @param uid this process's uid, or `null` where the platform has none
 * @returns the problem in operator-facing terms, or `null` when the directory is usable
 */
export function privateDirectoryProblem(
  stats: { isDirectory(): boolean; mode: number; uid: number },
  platform: string = process.platform,
  uid: number | null = process.getuid?.() ?? null,
): string | null {
  if (!stats.isDirectory()) return 'the path is not a directory';
  if (platform === 'win32') return null;

  const mode = stats.mode & 0o777;
  if (mode & 0o077) {
    return (
      `is mode 0${mode.toString(8)}, which is accessible beyond this account. Move it ` +
      'somewhere private or chmod it to 0700 — a spool another local account can write to ' +
      'is a spool we cannot trust.'
    );
  }
  if (uid !== null && stats.uid !== uid) {
    return (
      `is owned by uid ${String(stats.uid)} and this process is uid ${String(uid)}. ` +
      'Another account can write to it whatever its mode says.'
    );
  }
  return null;
}

/**
 * The size of a file that may not exist.
 *
 * A spool that has never been written has no file, and zero is the right answer rather
 * than an error: the first append creates it. `stat` rather than a cached value,
 * because the whole point of asking is that the cache can be wrong.
 *
 * @param path the file to measure
 * @returns its size in bytes, or 0 when it does not exist yet
 */
async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch (cause) {
    if (
      typeof cause === 'object' &&
      cause !== null &&
      (cause as { code?: unknown }).code === 'ENOENT'
    ) {
      return 0;
    }
    throw cause;
  }
}

/**
 * Stat the spool directory and refuse it unless it is private to this process.
 *
 * Thin on purpose: everything decidable lives in {@link privateDirectoryProblem}, so
 * the one syscall here is the only thing that cannot be exercised without a filesystem.
 *
 * @param directory the resolved directory, which now exists
 * @throws when the path is not a directory, or on POSIX when it is not ours or is
 *   accessible beyond this account
 */
async function assertPrivateDirectory(directory: string): Promise<void> {
  const problem = privateDirectoryProblem(await stat(directory));
  if (problem === null) return;
  throw new SpoolError(`Spool directory ${directory} ${problem}`);
}

export class EncryptedSpool {
  private readonly key: Buffer;

  constructor(key: Buffer | string = randomBytes(32)) {
    const material = typeof key === 'string' ? EncryptedSpool.deriveKey(key) : key;
    if (material.length !== 32) throw new SpoolError('Spool key must be 32 bytes');
    this.key = material;
  }

  /**
   * The KDF's cost parameters, pinned explicitly.
   *
   * `scryptSync` has defaults, and Node is free to change them. Every spool on every
   * installation derives its key from this call, so a default change is not a
   * performance tweak — it silently produces different keys everywhere, and the only
   * symptom is `SPOOL_WRONG_KEY` on a spool that was never touched (ledger P-19). The
   * arguments are therefore stated rather than inherited, and `maxmem` is set to
   * 64 MiB because Node's default raises an error rather than succeeding once `N`
   * grows — which would turn a silent key change into a hard failure at least.
   */
  static readonly KDF_PARAMS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

  /**
   * Bumped when {@link KDF_PARAMS} or the salt change.
   *
   * This is what makes the change *detectable* rather than merely documented.
   * `keyId()` folds the version into its digest, and `DurableSpool.open` already
   * compares the key id against the one recorded beside the sequence state — so a bump
   * makes every existing spool report a key mismatch deliberately, at open time, with
   * the version in the identifier. Without it, a parameter change is indistinguishable
   * from a corrupted key or a wrong secret, and the operator is left guessing which.
   */
  static readonly KDF_VERSION = 1;

  static deriveKey(secret: string, purpose = 'automate-runner-spool'): Buffer {
    if (!secret) throw new SpoolError('Spool key secret must not be empty');
    // `purpose` is a domain separator, not a secret salt: two purposes sharing a secret
    // must not derive the same key, and that is exactly what varying the salt achieves.
    // What was missing was the versioning, not the salt.
    return scryptSync(secret, purpose, 32, EncryptedSpool.KDF_PARAMS);
  }

  /**
   * The key's identity, as a short digest of the **material and the KDF version**.
   *
   * Folding the version in is what turns a future parameter bump into a visible event.
   * It is part of this digest rather than stored beside it so it cannot drift from the
   * key that produced it.
   */
  keyId(): string {
    return createHash('sha256')
      .update(`v${String(EncryptedSpool.KDF_VERSION)}:`)
      .update(this.key)
      .digest('hex')
      .slice(0, KEY_ID_BYTES);
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
  disposition?: SpoolEntryDisposition;
}

export interface SpoolDeadLetter {
  attempts: number;
  reason: string;
}

export interface SpoolQueue {
  enqueue(entry: SpoolEntry): Promise<void>;
  /**
   * The deliverable head of the queue. Entries whose retry budget was spent are
   * excluded: they are retained, not redelivered, so `peek` can never surface an
   * entry the caller is not allowed to send.
   */
  peek(limit?: number): Promise<SpoolEntry[]>;
  /** Entries retained for recovery after their retry budget was exhausted. */
  deadLetters(limit?: number): Promise<SpoolEntry[]>;
  ack(ids: readonly string[]): Promise<void>;
  deadLetter(ids: readonly string[], failure: SpoolDeadLetter): Promise<void>;
  compact(): Promise<void>;
  /** Retained entries, dead-lettered ones included — they still occupy the file. */
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
    return deliverable(this.entries, limit);
  }

  async deadLetters(limit = DEFAULT_PEEK_LIMIT): Promise<SpoolEntry[]> {
    return retained(this.entries, limit);
  }

  async ack(ids: readonly string[]): Promise<void> {
    const settled = new Set(ids);
    this.entries = this.entries.filter((entry) => !settled.has(entry.id));
  }

  async deadLetter(ids: readonly string[], failure: SpoolDeadLetter): Promise<void> {
    const marked = markDeadLetters(this.entries, ids, failure);
    if (marked) this.entries = marked;
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
    // 0o700, not the process umask. The files inside already get 0o600, but a
    // directory created under a permissive umask was world-*listable* and world-*
    // writable*: a local account could read the queue's shape, or delete a runner's
    // undelivered frames, or pre-create the directory with their own permissions
    // before the runner ever started (ledger P-17).
    try {
      await mkdir(directory, { recursive: true, mode: SPOOL_DIRECTORY_MODE });
    } catch (cause) {
      // `recursive: true` throws EEXIST when the path exists and is not a directory.
      // The raw fs message names the operation, not the problem: an operator reading
      // "EEXIST: file already exists, mkdir '/var/lib/automate/spool'" does not learn
      // that a file is sitting where the spool belongs. This is a configuration fault
      // and is reported as one.
      if (isPathOccupiedByFile(cause)) {
        throw new SpoolError(
          `Spool path is not a directory: ${directory}. Something is already there, so ` +
            'the runner cannot create a private spool directory.',
          { cause },
        );
      }
      throw cause;
    }

    await assertPrivateDirectory(directory);
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
    if (
      this.entries.length >= this.maxEntries ||
      this.committedBytes + frame.length > this.maxBytes
    ) {
      throw new SpoolCapacityError('Runner spool is full');
    }
    const prefix = this.committedBytes === 0 ? this.header() : EMPTY;
    // Reverted to the cached guard, for the fail-before demonstration.
    //
    // The cached value is only correct if nothing else touched the file, and the
    // assumption is false in exactly the case that matters: a short write, a power loss
    // mid-append, or anything else that leaves bytes the spool never committed. The
    // guard then believed the file ended where it last succeeded and appended *after*
    // the residue, so the next frame landed behind a gap that decodes as corruption
    // rather than as a short tail (ledger P-16).
    //
    // One `stat` per enqueue is the price, and it is cheap next to the `datasync()` the
    // append now performs. A cached size here would be faster and wrong in a way that
    // only appears after a crash — the worst possible time to discover it.
    const onDisk = await fileSize(this.path);
    if (onDisk > this.committedBytes) await truncate(this.path, this.committedBytes);
    await this.appendDurably(Buffer.concat([prefix, frame]));
    this.entries = [...this.entries, entry];
    this.remember(entry);
    this.committedBytes += prefix.length + frame.length;
    this.fileBytes = this.committedBytes;
  }

  /**
   * Append a frame and make it survive a power loss, not just a process exit.
   *
   * `appendFile` opens a handle, writes, and closes — and the close is where the data
   * reaches the operating system's cache, not the disk. A runner that loses power, or
   * whose container is killed, comes back to a file that is short by whatever the cache
   * had not yet flushed. A spool that has silently lost the last few frames is worse
   * than one that failed loudly: the frames are job events nobody has delivered yet, and
   * a runner that reports "queue drained" while holding no record of them reports a
   * success that did not happen (ledger P-16).
   *
   * Three things make this different from the call it replaces, and each maps to a way
   * a spool loses data quietly:
   *
   *  - **A held handle, so the bytes written and the bytes counted are the same
   *    bytes.** `appendFile` reports nothing back; a short write is invisible.
   *  - **`datasync()` before close**, so the bytes are on the device before this
   *    method returns and before the caller is told the entry was enqueued.
   *  - **A checked byte count.** A partial write is an error, not a shorter file.
   *
   * The in-memory bookkeeping is only advanced by the caller after this resolves, which
   * is what makes the repair guard on the next call correct: a failed append leaves
   * `fileBytes` where it was, so the guard still sees the hole and truncates it.
   */
  private async appendDurably(payload: Buffer): Promise<void> {
    const handle = await open(this.path, 'a');
    try {
      let written = 0;
      // A single write is not guaranteed to write everything, even on a regular file,
      // so the loop is not defensive noise — it is the only way `bytesWritten` can be
      // compared to what we asked for.
      while (written < payload.length) {
        const result = await handle.write(payload, written, payload.length - written, null);
        if (result.bytesWritten <= 0) {
          throw new SpoolError(
            `Spool append to ${this.path} wrote ${String(written)} of ` +
              `${String(payload.length)} bytes and then reported no progress.`,
          );
        }
        written += result.bytesWritten;
      }
      await handle.datasync();
    } finally {
      await handle.close();
    }
  }

  async peek(limit = DEFAULT_PEEK_LIMIT): Promise<SpoolEntry[]> {
    return deliverable(this.entries, limit);
  }

  async deadLetters(limit = DEFAULT_PEEK_LIMIT): Promise<SpoolEntry[]> {
    return retained(this.entries, limit);
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

  async deadLetter(ids: readonly string[], failure: SpoolDeadLetter): Promise<void> {
    const marked = markDeadLetters(this.entries, ids, failure);
    if (!marked) return;
    this.entries = marked;
    // The disposition travels inside the sealed frame, so rewriting the log is
    // what makes a dead letter survive a restart instead of being retried again.
    await this.compact();
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

  /**
   * Seal one entry into a length-prefixed frame.
   *
   * The size cap lives here, at the one place a frame is produced, rather than in
   * `enqueue`. Both the append path and the compaction rewrite path go through this
   * method, and `decodeFile` refuses any frame longer than `MAX_SEALED_BYTES` with
   * `SPOOL_FORMAT`. A cap on only one of the two write paths would still let the
   * other produce a frame the next open cannot read — which is the shape of the
   * defect this replaces (ledger P-14): the limit was checked at decode and nowhere
   * at write, so one oversized event made the whole file undecodable, and the
   * `tornTail: 'drop'` recovery did not apply because the throw was mid-file rather
   * than at a partial tail.
   *
   * Checking at the builder also means the limit cannot be forgotten at a new call
   * site: there is no second way to make a frame.
   */
  private frame(entry: SpoolEntry): Buffer {
    const sealed = this.codec.seal(entry);
    if (sealed.length > MAX_SEALED_BYTES) {
      throw new SpoolFrameTooLargeError(MAX_SEALED_BYTES, sealed.length);
    }
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
    throw new SpoolIntegrityError(
      'SPOOL_WRONG_KEY',
      'Runner spool sequence state key does not match',
    );
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
  if (
    !name ||
    isAbsolute(name) ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('..')
  ) {
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

function isDeliverable(entry: SpoolEntry): boolean {
  return entry.disposition !== 'dead_letter';
}

function isDeadLettered(entry: SpoolEntry): boolean {
  return entry.disposition === 'dead_letter';
}

function deliverable(entries: readonly SpoolEntry[], limit: number): SpoolEntry[] {
  return entries.filter(isDeliverable).slice(0, limit);
}

function retained(entries: readonly SpoolEntry[], limit: number): SpoolEntry[] {
  return entries.filter(isDeadLettered).slice(0, limit);
}

/**
 * Returns the rewritten entries, or `null` when nothing moved: an id that is not
 * queued, an empty id list, and an entry already dead-lettered all leave the
 * queue exactly as it was.
 */
function markDeadLetters(
  entries: readonly SpoolEntry[],
  ids: readonly string[],
  failure: SpoolDeadLetter,
): SpoolEntry[] | null {
  const exhausted = new Set(ids);
  if (exhausted.size === 0) return null;
  let marked = false;
  const updated: SpoolEntry[] = entries.map((entry) => {
    if (!exhausted.has(entry.id) || !isDeliverable(entry)) return entry;
    marked = true;
    return {
      ...entry,
      disposition: 'dead_letter',
      attempts: failure.attempts,
      lastError: failure.reason,
    };
  });
  return marked ? updated : null;
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
    candidate.payload !== undefined &&
    (candidate.disposition === undefined ||
      candidate.disposition === 'retry' ||
      candidate.disposition === 'dead_letter') &&
    (candidate.attempts === undefined ||
      (Number.isInteger(candidate.attempts) && candidate.attempts >= 0)) &&
    (candidate.lastError === undefined || typeof candidate.lastError === 'string')
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
    throw new SpoolIntegrityError(
      'SPOOL_WRONG_KEY',
      'Runner spool key does not match the sealed queue',
    );
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
