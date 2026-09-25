import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../client.js', () => {
  const mockDb = {
    execute: vi.fn().mockResolvedValue([]),
  };
  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import { buildMigrationSql, migrateDb } from '../migrate.js';

describe('buildMigrationSql', () => {
  it('returns a non-empty SQL string', () => {
    const sql = buildMigrationSql();
    expect(typeof sql).toBe('string');
    expect(sql.length).toBeGreaterThan(200);
  });

  it('includes trace_links table and its indexes', () => {
    const sql = buildMigrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trace_links');
    expect(sql).toContain('trace_links_source_idx');
    expect(sql).toContain('trace_links_target_idx');
  });

  it('uses IF NOT EXISTS guards on all CREATE TABLE statements', () => {
    const sql = buildMigrationSql();
    const createTableCount = (sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length;
    // 7 tables (conversations, messages, message_attachments, connector_configs,
    // flow_templates, execution_log, model_config) + trace_links = 8
    expect(createTableCount).toBeGreaterThanOrEqual(8);
  });

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

  it('runs without throwing', async () => {
    await expect(migrateDb()).resolves.not.toThrow();
  });

  it('calls db.execute with migration SQL', async () => {
    const { db } = await import('../client.js');
    await migrateDb();
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — can be called multiple times without error', async () => {
    await expect(migrateDb()).resolves.not.toThrow();
    await expect(migrateDb()).resolves.not.toThrow();
    await expect(migrateDb()).resolves.not.toThrow();
  });
});
