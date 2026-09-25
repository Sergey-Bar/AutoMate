import { LRUCache } from 'lru-cache';

export interface ConnectorCacheOptions {
  max: number;
  ttlMs: number;
}

export function createConnectorCache<T>(opts: ConnectorCacheOptions): LRUCache<string, T> {
  return new LRUCache<string, T>({ max: opts.max, ttl: opts.ttlMs });
}
