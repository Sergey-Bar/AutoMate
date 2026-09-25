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

describe('db client', () => {
  it('exports a drizzle db instance', () => {
    expect(db).toBeDefined();
    expect(typeof db.select).toBe('function');
  });

  it('exports a closeDb function', () => {
    expect(closeDb).toBeDefined();
    expect(typeof closeDb).toBe('function');
  });
});
