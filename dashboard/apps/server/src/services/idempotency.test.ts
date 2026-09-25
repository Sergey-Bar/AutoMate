import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { IdempotencyStore } from './idempotency.js';

describe('IdempotencyStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('get() returns null for unknown operationId', () => {
    const store = new IdempotencyStore();

    expect(store.get('missing')).toBeNull();
  });

  it('create() returns true for new operationId', () => {
    const store = new IdempotencyStore();

    expect(store.create('op-1')).toBe(true);
  });

  it('create() returns false for duplicate operationId', () => {
    const store = new IdempotencyStore();

    expect(store.create('op-1')).toBe(true);
    expect(store.create('op-1')).toBe(false);
  });

  it('complete() stores result and changes status', () => {
    const store = new IdempotencyStore();
    store.create('op-2');

    expect(store.complete('op-2', { ok: true })).toBe(true);

    const entry = store.get('op-2');
    expect(entry).not.toBeNull();
    expect(entry).toMatchObject({
      operationId: 'op-2',
      result: { ok: true },
      status: 'completed',
    });
    expect(entry?.completedAt).toEqual(expect.any(String));
  });

  it('get() after complete() returns stored result for replay path', () => {
    const store = new IdempotencyStore();
    store.create('op-3');
    store.complete('op-3', { value: 42 });

    const replay = store.get('op-3');
    expect(replay?.result).toEqual({ value: 42 });
    expect(replay?.status).toBe('completed');
  });

  it('error() marks entry as errored', () => {
    const store = new IdempotencyStore();
    store.create('op-4');

    expect(store.error('op-4', 'timeout')).toBe(true);

    const entry = store.get('op-4');
    expect(entry).toMatchObject({
      operationId: 'op-4',
      status: 'error',
      result: 'timeout',
    });
  });

  it('cleanup() removes expired entries', () => {
    const store = new IdempotencyStore(10);
    store.create('op-5');

    vi.advanceTimersByTime(11);
    expect(store.cleanup()).toBe(1);
    expect(store.get('op-5')).toBeNull();
  });

  it('second submit with same operationId returns cached result', () => {
    const store = new IdempotencyStore();

    const firstCreate = store.create('op-6');
    if (firstCreate) {
      store.complete('op-6', { status: 'accepted' });
    }

    const secondCreate = store.create('op-6');
    const replayed = store.get('op-6');

    expect(firstCreate).toBe(true);
    expect(secondCreate).toBe(false);
    expect(replayed?.status).toBe('completed');
    expect(replayed?.result).toEqual({ status: 'accepted' });
  });
});
