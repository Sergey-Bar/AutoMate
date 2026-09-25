import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../client.js', () => {
  const mockDb = {
    execute: vi.fn().mockResolvedValue([]),
  };
  return { db: mockDb, closeDb: vi.fn().mockResolvedValue(undefined) };
});

import { buildMigrationSql } from '../migrate.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('seedDemoDb (inline helper)', () => {
  it('buildMigrationSql includes all required tables for demo data', () => {
    const sql = buildMigrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversations');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS messages');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS message_attachments');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS connector_configs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS execution_log');
  });

  it('migration SQL includes trace_links table', () => {
    const sql = buildMigrationSql();
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS trace_links');
    expect(sql).toContain('trace_links_source_idx');
    expect(sql).toContain('trace_links_target_idx');
  });

  it('migration SQL uses IF NOT EXISTS guards on all CREATE TABLE statements', () => {
    const sql = buildMigrationSql();
    const createTableCount = (sql.match(/CREATE TABLE IF NOT EXISTS/g) ?? []).length;
    expect(createTableCount).toBeGreaterThanOrEqual(8);
  });

  it('migration SQL is idempotent (IF NOT EXISTS on all statements)', () => {
    const sql = buildMigrationSql();
    // All CREATE TABLE statements use IF NOT EXISTS
    const createWithoutGuard = (sql.match(/CREATE TABLE (?!IF NOT EXISTS)/g) ?? []).length;
    expect(createWithoutGuard).toBe(0);
    // All CREATE INDEX statements use IF NOT EXISTS
    const indexWithoutGuard = (sql.match(/CREATE INDEX (?!IF NOT EXISTS)/g) ?? []).length;
    expect(indexWithoutGuard).toBe(0);
  });

  it('migration SQL includes foreign key constraints', () => {
    const sql = buildMigrationSql();
    expect(sql).toContain('FOREIGN KEY');
    expect(sql).toContain('ON DELETE CASCADE');
  });
});
