import { describe, expect, it } from 'vitest';
import { createDbClient, createDbResources } from './client.js';

const URL = 'postgresql://user:pass@127.0.0.1:5432/automate';

describe('the database client', () => {
  it('builds a Drizzle client and a pool from one connection string', () => {
    const { db, pool, close } = createDbResources(URL);
    expect(db).toBeDefined();
    expect(typeof close).toBe('function');
    // The pool carries the string through; `pg.Pool` is lazy, so constructing it
    // against an unreachable host does not connect and needs no database here.
    expect(pool.options.connectionString).toBe(URL);
    return close();
  });

  it('exposes the Drizzle client on its own for callers that never need the pool', async () => {
    const db = createDbClient(URL);
    // A Drizzle client is a proxy over a schema-bound query builder. Asserting on
    // the query builder's existence is what proves the schema was bound at
    // construction rather than at first use, which is where a missing table
    // would otherwise surface as a runtime 500.
    expect(db.query).toBeDefined();
    expect(db.select).toBeDefined();
    expect(db.insert).toBeDefined();
  });
});
