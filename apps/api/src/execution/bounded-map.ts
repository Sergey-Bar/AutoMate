/**
 * A bounded map that evicts the oldest entry past a capacity.
 *
 * Two maps in the execution stores grew without limit for the lifetime of the
 * process: `completionHashes` (one 64-char string per completed job, never
 * removed) and the in-process `memoryBytes` artifact fallback (whole artifact
 * contents, never removed). On a self-hosted install that runs for weeks — which
 * is the deployment this product is for — both are a slow out-of-memory kill,
 * and neither is visible in any metric until the process is already dying.
 *
 * Insertion-ordered eviction is deliberate: a capacity is a *freshness* bound, not
 * a fairness one. The entry most likely to be irrelevant is the one written
 * longest ago, and a job's completion hash is only consulted while a client
 * retries that same job.
 */
export class BoundedMap<K, V> {
  #entries = new Map<K, V>();
  readonly capacity: number;
  readonly name: string;
  /** Evictions, so a leak is observable rather than silent. */
  #evictions = 0;

  constructor(name: string, capacity: number) {
    if (capacity < 1) throw new RangeError(`capacity must be at least 1, got ${capacity}`);
    this.name = name;
    this.capacity = capacity;
  }

  get size(): number {
    return this.#entries.size;
  }

  get evictions(): number {
    return this.#evictions;
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  get(key: K): V | undefined {
    return this.#entries.get(key);
  }

  set(key: K, value: V): this {
    // Re-inserting moves the key to the end, so a key that keeps being written
    // is not the one evicted.
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
      this.#evictions += 1;
    }
    return this;
  }

  delete(key: K): boolean {
    return this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }

  keys(): IterableIterator<K> {
    return this.#entries.keys();
  }

  entries(): IterableIterator<[K, V]> {
    return this.#entries.entries();
  }

  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.#entries[Symbol.iterator]();
  }
}

/** A completion hash older than this is not worth retaining. */
export const COMPLETION_HASH_CAPACITY = 10_000;

/**
 * A byte total for the in-process artifact fallback, not a per-artifact count:
 * one large artifact should evict sooner than a thousand small ones.
 */
export const ARTIFACT_BYTE_CAPACITY = 256 * 1024 * 1024;

/**
 * A map of artifact bytes bounded by total bytes held.
 *
 * Keyed by storage key, so it has the same semantics as the plain map it
 * replaces, with one addition: a single oversized artifact evicts everything and
 * then declines itself, rather than pinning memory forever.
 */
export class BoundedByteMap<K> {
  #entries = new Map<K, Uint8Array>();
  readonly capacityBytes: number;
  #bytes = 0;
  #evictions = 0;

  constructor(capacityBytes: number) {
    if (capacityBytes < 1)
      throw new RangeError(`capacity must be at least 1, got ${capacityBytes}`);
    this.capacityBytes = capacityBytes;
  }

  get byteLength(): number {
    return this.#bytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  get evictions(): number {
    return this.#evictions;
  }

  get(key: K): Uint8Array | undefined {
    return this.#entries.get(key);
  }

  has(key: K): boolean {
    return this.#entries.has(key);
  }

  set(key: K, bytes: Uint8Array): void {
    const previous = this.#entries.get(key);
    if (previous !== undefined) {
      this.#bytes -= previous.byteLength;
      this.#entries.delete(key);
    }
    // One artifact larger than the whole budget is never cached; the caller
    // falls back to the configured store.
    if (bytes.byteLength > this.capacityBytes) {
      this.#evictions += 1;
      return;
    }
    this.#entries.set(key, bytes);
    this.#bytes += bytes.byteLength;
    while (this.#bytes > this.capacityBytes) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      const victim = this.#entries.get(oldest.value);
      this.#entries.delete(oldest.value);
      if (victim !== undefined) this.#bytes -= victim.byteLength;
      this.#evictions += 1;
    }
  }

  delete(key: K): boolean {
    const previous = this.#entries.get(key);
    if (previous === undefined) return false;
    this.#bytes -= previous.byteLength;
    return this.#entries.delete(key);
  }

  keys(): IterableIterator<K> {
    return this.#entries.keys();
  }
}
