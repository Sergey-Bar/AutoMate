import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_BYTE_CAPACITY,
  BoundedByteMap,
  BoundedMap,
  COMPLETION_HASH_CAPACITY,
} from './bounded-map.js';

describe('BoundedMap', () => {
  it('keeps the most recent entries and evicts the oldest', () => {
    const map = new BoundedMap<string, number>('test', 3);
    map.set('a', 1).set('b', 2).set('c', 3);
    expect(map.size).toBe(3);
    expect(map.evictions).toBe(0);
    map.set('d', 4);
    expect(map.size).toBe(3);
    // 'a' was written longest ago.
    expect(map.has('a')).toBe(false);
    expect([...map.keys()]).toEqual(['b', 'c', 'd']);
    expect(map.evictions).toBe(1);
  });

  it('does not evict a key that keeps being written', () => {
    const map = new BoundedMap<string, number>('test', 3);
    map.set('hot', 1);
    for (let index = 0; index < 100; index += 1) {
      map.set(`cold-${index}`, index);
      map.set('hot', index);
    }
    // Re-inserting moves the key to the end, so the frequently-written entry
    // survives while the cold ones are evicted.
    expect(map.has('hot')).toBe(true);
    expect(map.size).toBe(3);
  });

  it('stays at capacity under sustained writes, which is the leak being fixed', () => {
    const map = new BoundedMap<string, string>('test', 50);
    for (let index = 0; index < 10_000; index += 1) map.set(`job-${index}`, `${index}`);
    expect(map.size).toBe(50);
    expect(map.evictions).toBe(9_950);
  });

  it('reads, deletes and iterates like a Map', () => {
    const map = new BoundedMap<string, number>('test', 4);
    map.set('a', 1).set('b', 2);
    expect(map.get('a')).toBe(1);
    expect(map.get('missing')).toBeUndefined();
    expect([...map]).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    expect([...map.entries()]).toHaveLength(2);
    expect(map.delete('a')).toBe(true);
    expect(map.delete('a')).toBe(false);
    map.clear();
    expect(map.size).toBe(0);
  });

  it('rejects a nonsensical capacity rather than silently evicting everything', () => {
    expect(() => new BoundedMap<string, number>('test', 0)).toThrow(RangeError);
  });

  it('carries a capacity a long-running process can rely on', () => {
    expect(COMPLETION_HASH_CAPACITY).toBeGreaterThan(1000);
  });
});

describe('BoundedByteMap', () => {
  it('evicts by total bytes, not by entry count', () => {
    const map = new BoundedByteMap<string>(1_000);
    const block = (value: number): Uint8Array => new Uint8Array(value).fill(value % 251);
    map.set('a', block(400));
    map.set('b', block(400));
    expect(map.byteLength).toBe(800);
    map.set('c', block(400));
    // The oldest goes first once the budget is exceeded.
    expect(map.byteLength).toBe(800);
    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(true);
    expect(map.has('c')).toBe(true);
  });

  it('declines a single artifact larger than the whole budget rather than pinning it', () => {
    const map = new BoundedByteMap<string>(1_000);
    map.set('huge', new Uint8Array(5_000));
    expect(map.size).toBe(0);
    expect(map.byteLength).toBe(0);
    // The caller falls back to the configured store instead of caching forever.
    expect(map.get('huge')).toBeUndefined();
  });

  it('accounts for a replacement exactly, with no double count', () => {
    const map = new BoundedByteMap<string>(10_000);
    map.set('k', new Uint8Array(500));
    map.set('k', new Uint8Array(100));
    expect(map.byteLength).toBe(100);
    expect(map.size).toBe(1);
  });

  it('releases bytes on delete', () => {
    const map = new BoundedByteMap<string>(10_000);
    map.set('k', new Uint8Array(500));
    expect(map.delete('k')).toBe(true);
    expect(map.byteLength).toBe(0);
    expect(map.delete('k')).toBe(false);
  });

  it('carries a byte budget a long-running process can rely on', () => {
    expect(ARTIFACT_BYTE_CAPACITY).toBeGreaterThan(0);
    // 256 MiB is the point at which holding artifacts in process memory stops
    // being reasonable for a self-hosted install.
    expect(ARTIFACT_BYTE_CAPACITY).toBeLessThanOrEqual(512 * 1024 * 1024);
  });
});
