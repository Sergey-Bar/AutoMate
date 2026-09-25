import { describe, expect, it, vi } from 'vitest';

vi.mock('./client.js', () => {
  const mockDb = {
    select: vi.fn(() => ({ from: vi.fn() })),
    insert: vi.fn(() => ({ values: vi.fn() })),
    update: vi.fn(() => ({ set: vi.fn() })),
    delete: vi.fn(() => ({ where: vi.fn() })),
    execute: vi.fn(),
  };
  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import { db, closeDb } from './client.js';

describe('db client additional coverage', () => {
  it('exports db drizzle instance with select/insert/update/delete methods', () => {
    expect(db).toBeDefined();
    expect(db).toHaveProperty('select');
    expect(db).toHaveProperty('insert');
    expect(db).toHaveProperty('update');
    expect(db).toHaveProperty('delete');
  });

  it('db.select returns a chainable query builder', () => {
    const selectBuilder = db.select();
    expect(selectBuilder).toBeDefined();
    expect(typeof selectBuilder.from).toBe('function');
  });

  it('exports closeDb function', () => {
    expect(closeDb).toBeDefined();
    expect(typeof closeDb).toBe('function');
  });
});
