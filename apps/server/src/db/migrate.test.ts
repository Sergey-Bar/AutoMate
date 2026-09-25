import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./client.js', () => {
  const mockDb = {
    execute: vi.fn().mockResolvedValue([]),
  };
  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import { buildMigrationSql, migrateDb } from './migrate.js';

describe('buildMigrationSql', () => {
  it('includes all 7 tables', () => {
    const sql = buildMigrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS message_attachments');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS connector_configs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS flow_templates');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS execution_log');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS model_config');
  });
});

describe('migrateDb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates all 7 tables (calls db.execute)', async () => {
    const { db } = await import('./client.js');
    await migrateDb();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('is idempotent when run multiple times', async () => {
    await migrateDb();
    await migrateDb();
    const { db } = await import('./client.js');
    expect(db.execute).toHaveBeenCalledTimes(2);
  });
});
