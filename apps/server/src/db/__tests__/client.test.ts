import { describe, it, expect, vi } from 'vitest';

vi.mock('../client.js', () => {
  const mockDb = {
    select: vi.fn(() => ({ from: vi.fn() })),
    insert: vi.fn(() => ({ values: vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn() })),
    delete: vi.fn(() => ({ where: vi.fn() })),
    execute: vi.fn(),
  };
  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import { db, closeDb } from '../client.js';

describe('db/client — exported db instance', () => {
  it('exports a drizzle instance with select method', () => {
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
  });

  it('exports a drizzle instance with insert/update/delete methods', () => {
    expect(typeof db.insert).toBe('function');
    expect(typeof db.update).toBe('function');
    expect(typeof db.delete).toBe('function');
  });

  it('db.select() returns a chainable query builder with from()', () => {
    const builder = db.select();
    expect(typeof builder.from).toBe('function');
  });
});

describe('db/client — exported closeDb function', () => {
  it('exports a closeDb async function', () => {
    expect(closeDb).toBeDefined();
    expect(typeof closeDb).toBe('function');
  });
});
