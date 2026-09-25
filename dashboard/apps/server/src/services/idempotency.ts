export interface IdempotencyEntry {
  operationId: string;
  result: unknown;
  status: 'pending' | 'completed' | 'error';
  createdAt: string;
  completedAt?: string;
  ttlMs: number;
}

export class IdempotencyStore {
  private store = new Map<string, IdempotencyEntry>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs: number = 300_000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  private nowMs(): number {
    return Date.now();
  }

  private isExpired(entry: IdempotencyEntry): boolean {
    return this.nowMs() > new Date(entry.createdAt).getTime() + entry.ttlMs;
  }

  get(operationId: string): IdempotencyEntry | null {
    const entry = this.store.get(operationId);
    if (!entry) {
      return null;
    }

    if (this.isExpired(entry)) {
      this.store.delete(operationId);
      return null;
    }

    return entry;
  }

  create(operationId: string): boolean {
    if (this.get(operationId)) {
      return false;
    }

    const now = new Date().toISOString();
    this.store.set(operationId, {
      operationId,
      result: null,
      status: 'pending',
      createdAt: now,
      ttlMs: this.defaultTtlMs,
    });

    return true;
  }

  complete(operationId: string, result: unknown): boolean {
    const entry = this.get(operationId);
    if (!entry || entry.status === 'completed') {
      return false;
    }

    this.store.set(operationId, {
      ...entry,
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });

    return true;
  }

  error(operationId: string, errorMessage: string): boolean {
    const entry = this.get(operationId);
    if (!entry) {
      return false;
    }

    this.store.set(operationId, {
      ...entry,
      status: 'error',
      result: errorMessage,
      completedAt: new Date().toISOString(),
    });

    return true;
  }

  cleanup(): number {
    let removed = 0;
    for (const [operationId, entry] of this.store.entries()) {
      if (this.isExpired(entry)) {
        this.store.delete(operationId);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.store.size;
  }
}
