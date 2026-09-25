import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createConnectorCache } from './cache.js';

describe('createConnectorCache', () => {
  it('creates an LRUCache instance', () => {
    const cache = createConnectorCache<string>({ max: 100, ttlMs: 5_000 });
    expect(cache).toBeDefined();
    expect(typeof cache.get).toBe('function');
    expect(typeof cache.set).toBe('function');
    expect(typeof cache.has).toBe('function');
  });

  it('returns a value within TTL (cache hit)', () => {
    const cache = createConnectorCache<string>({ max: 100, ttlMs: 60_000 });
    cache.set('key', 'value');
    expect(cache.get('key')).toBe('value');
    expect(cache.has('key')).toBe(true);
  });

  it('returns undefined for missing keys (cache miss)', () => {
    const cache = createConnectorCache<string>({ max: 100, ttlMs: 60_000 });
    expect(cache.get('nonexistent')).toBeUndefined();
    expect(cache.has('nonexistent')).toBe(false);
  });

  it('cache miss after TTL expires', () => {
    vi.useFakeTimers();
    try {
      const cache = createConnectorCache<string>({ max: 100, ttlMs: 100 });
      cache.set('key', 'value');
      expect(cache.get('key')).toBe('value');
      // Advance past TTL
      vi.advanceTimersByTime(200);
      expect(cache.get('key')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects max size with LRU eviction', () => {
    const cache = createConnectorCache<number>({ max: 2, ttlMs: 60_000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // should evict 'a' (least recently used)
    expect(cache.has('a')).toBe(false);
    expect(cache.has('b')).toBe(true);
    expect(cache.has('c')).toBe(true);
  });

  it('overwrites existing keys', () => {
    const cache = createConnectorCache<string>({ max: 100, ttlMs: 60_000 });
    cache.set('key', 'first');
    cache.set('key', 'second');
    expect(cache.get('key')).toBe('second');
  });

  it('stores different types of values', () => {
    const cache = createConnectorCache<{ id: number; name: string }>({ max: 10, ttlMs: 60_000 });
    cache.set('user', { id: 1, name: 'Alice' });
    expect(cache.get('user')).toEqual({ id: 1, name: 'Alice' });
  });
});
