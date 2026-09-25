/**
 * Tests for services/idempotency.ts — IdempotencyStore
 *
 * Covers:
 *  - constructor: default and custom TTL
 *  - get: returns null for unknown key, returns entry, expires and deletes expired entry
 *  - create: creates new entry, returns false for duplicate, returns false for existing non-expired
 *  - complete: marks entry completed with result, returns false for unknown/expired, returns false if already completed
 *  - error: marks entry errored, returns false for unknown/expired
 *  - cleanup: removes expired entries, returns count, skips non-expired
 *  - size: reflects current store size
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { IdempotencyStore } from '../idempotency.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('IdempotencyStore', () => {
  describe('constructor', () => {
    it('creates a store with default TTL of 300000ms', () => {
      const store = new IdempotencyStore();
      store.create('op-1');
      const entry = store.get('op-1');
      expect(entry).not.toBeNull();
      expect(entry!.ttlMs).toBe(300_000);
    });

    it('accepts a custom TTL', () => {
      const store = new IdempotencyStore(60_000);
      store.create('op-custom');
      const entry = store.get('op-custom');
      expect(entry!.ttlMs).toBe(60_000);
    });
  });

  describe('get', () => {
    it('returns null for an unknown operation ID', () => {
      const store = new IdempotencyStore();
      expect(store.get('does-not-exist')).toBeNull();
    });

    it('returns the entry for a known operation', () => {
      const store = new IdempotencyStore();
      store.create('op-get-1');
      const entry = store.get('op-get-1');
      expect(entry).not.toBeNull();
      expect(entry!.operationId).toBe('op-get-1');
      expect(entry!.status).toBe('pending');
      expect(entry!.result).toBeNull();
    });

    it('returns null and deletes expired entries', () => {
      vi.useFakeTimers();
      const store = new IdempotencyStore(1000); // 1s TTL
      store.create('op-expire');
      expect(store.get('op-expire')).not.toBeNull();

      // Advance past TTL
      vi.advanceTimersByTime(2000);
      expect(store.get('op-expire')).toBeNull();
      expect(store.size).toBe(0);
    });
  });

  describe('create', () => {
    it('creates a new entry and returns true', () => {
      const store = new IdempotencyStore();
      const created = store.create('op-new');
      expect(created).toBe(true);
      expect(store.size).toBe(1);
    });

    it('sets status to "pending" on creation', () => {
      const store = new IdempotencyStore();
      store.create('op-pending');
      expect(store.get('op-pending')!.status).toBe('pending');
    });

    it('sets createdAt to a valid ISO timestamp', () => {
      const store = new IdempotencyStore();
      store.create('op-ts');
      const entry = store.get('op-ts')!;
      expect(entry.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns false for a duplicate (non-expired) operation ID', () => {
      const store = new IdempotencyStore();
      expect(store.create('op-dup')).toBe(true);
      expect(store.create('op-dup')).toBe(false);
      expect(store.size).toBe(1);
    });

    it('allows re-creation after expiry', () => {
      vi.useFakeTimers();
      const store = new IdempotencyStore(500);
      store.create('op-reuse');
      vi.advanceTimersByTime(1000);
      // Expired — create should succeed again
      const result = store.create('op-reuse');
      expect(result).toBe(true);
    });
  });

  describe('complete', () => {
    it('marks the entry as completed with the given result and returns true', () => {
      const store = new IdempotencyStore();
      store.create('op-complete');
      const ok = store.complete('op-complete', { status: 200, body: 'done' });
      expect(ok).toBe(true);
      const entry = store.get('op-complete')!;
      expect(entry.status).toBe('completed');
      expect(entry.result).toEqual({ status: 200, body: 'done' });
      expect(entry.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns false for an unknown operation ID', () => {
      const store = new IdempotencyStore();
      expect(store.complete('unknown-op', {})).toBe(false);
    });

    it('returns false if entry is already completed (idempotent guard)', () => {
      const store = new IdempotencyStore();
      store.create('op-already-done');
      store.complete('op-already-done', 'first');
      const second = store.complete('op-already-done', 'second');
      expect(second).toBe(false);
      // result remains the first value
      expect(store.get('op-already-done')!.result).toBe('first');
    });

    it('returns false for an expired entry', () => {
      vi.useFakeTimers();
      const store = new IdempotencyStore(500);
      store.create('op-expired-complete');
      vi.advanceTimersByTime(1000);
      expect(store.complete('op-expired-complete', {})).toBe(false);
    });
  });

  describe('error', () => {
    it('marks the entry as errored with the error message and returns true', () => {
      const store = new IdempotencyStore();
      store.create('op-err');
      const ok = store.error('op-err', 'Something went wrong');
      expect(ok).toBe(true);
      const entry = store.get('op-err')!;
      expect(entry.status).toBe('error');
      expect(entry.result).toBe('Something went wrong');
      expect(entry.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('returns false for an unknown operation ID', () => {
      const store = new IdempotencyStore();
      expect(store.error('no-such-op', 'fail')).toBe(false);
    });

    it('returns false for an expired entry', () => {
      vi.useFakeTimers();
      const store = new IdempotencyStore(500);
      store.create('op-expired-err');
      vi.advanceTimersByTime(1000);
      expect(store.error('op-expired-err', 'too late')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('returns 0 when store is empty', () => {
      const store = new IdempotencyStore();
      expect(store.cleanup()).toBe(0);
    });

    it('returns 0 when no entries are expired', () => {
      const store = new IdempotencyStore(60_000);
      store.create('op-fresh');
      expect(store.cleanup()).toBe(0);
      expect(store.size).toBe(1);
    });

    it('removes expired entries and returns the count removed', () => {
      vi.useFakeTimers();
      const store = new IdempotencyStore(500);
      store.create('op-a');
      store.create('op-b');
      store.create('op-c');
      vi.advanceTimersByTime(1000);
      const removed = store.cleanup();
      expect(removed).toBe(3);
      expect(store.size).toBe(0);
    });

    it('only removes expired entries, leaving fresh ones intact', () => {
      vi.useFakeTimers();
      const store = new IdempotencyStore(1000);
      store.create('op-old');
      vi.advanceTimersByTime(500);
      store.create('op-new'); // created at t=500, expires at t=1500
      vi.advanceTimersByTime(600); // now t=1100 — op-old expired, op-new still valid
      const removed = store.cleanup();
      expect(removed).toBe(1);
      expect(store.size).toBe(1);
      expect(store.get('op-new')).not.toBeNull();
    });
  });

  describe('size', () => {
    it('is 0 for a new store', () => {
      const store = new IdempotencyStore();
      expect(store.size).toBe(0);
    });

    it('increments as entries are added', () => {
      const store = new IdempotencyStore();
      store.create('s1');
      expect(store.size).toBe(1);
      store.create('s2');
      expect(store.size).toBe(2);
    });

    it('decrements after cleanup removes expired entries', () => {
      vi.useFakeTimers();
      const store = new IdempotencyStore(100);
      store.create('s1');
      store.create('s2');
      expect(store.size).toBe(2);
      vi.advanceTimersByTime(200);
      store.cleanup();
      expect(store.size).toBe(0);
    });
  });
});
