import { describe, it, expect, vi } from 'vitest';

const mockDelete = vi.hoisted(() => vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }));
const mockSelect = vi.hoisted(() => vi.fn());

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: {
    delete: mockDelete,
    select: mockSelect,
  },
  sqlite: {
    pragma: vi.fn().mockReturnValue(0),
  },
  poolConnection: {
    pragma: vi.fn().mockReturnValue(0),
  },
  isPostgres: false,
}));

vi.mock('../../db/schema.js', () => ({
  runs: { startedAt: 'started_at' },
  results: { runId: 'run_id' },
  tests: { runId: 'run_id' },
  suites: { runId: 'run_id' },
  attachments: { resultId: 'result_id' },
  nlQueryHistory: { createdAt: 'created_at' },
  trends: {},
}));

import {
  DEFAULT_RETENTION_CONFIG,
  loadRetentionConfig,
  getRetentionCutoffDate,
  formatCleanupResult,
} from '../data-retention.js';

describe('Data retention service', () => {
  describe('DEFAULT_RETENTION_CONFIG', () => {
    it('should have positive day values for all policies', () => {
      expect(DEFAULT_RETENTION_CONFIG.testResultDays).toBeGreaterThan(0);
      expect(DEFAULT_RETENTION_CONFIG.nlQueryHistoryDays).toBeGreaterThan(0);
      expect(DEFAULT_RETENTION_CONFIG.attachmentDays).toBeGreaterThan(0);
    });

    it('should preserve trends indefinitely by default (-1)', () => {
      expect(DEFAULT_RETENTION_CONFIG.trendsDays).toBe(-1);
    });

    it('should default to disabled auto-cleanup', () => {
      expect(DEFAULT_RETENTION_CONFIG.enabled).toBe(false);
    });
  });

  describe('loadRetentionConfig', () => {
    it('should return default config when no file exists', () => {
      const config = loadRetentionConfig();
      expect(config).toEqual(DEFAULT_RETENTION_CONFIG);
    });
  });

  describe('getRetentionCutoffDate', () => {
    it('should return ISO date string for given number of days', () => {
      const cutoff = getRetentionCutoffDate(90);
      expect(cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const date = new Date(cutoff);
      // eslint-disable-next-line test-flakiness/no-random-data
      const now = new Date();
      const diffDays = (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(89.9);
      expect(diffDays).toBeLessThanOrEqual(90.1);
    });

    it('should return older date for larger day values', () => {
      const cutoff30 = new Date(getRetentionCutoffDate(30)).getTime();
      const cutoff90 = new Date(getRetentionCutoffDate(90)).getTime();
      expect(cutoff90).toBeLessThan(cutoff30);
    });
  });

  describe('formatCleanupResult', () => {
    it('should format zero deletions', () => {
      const result = formatCleanupResult({
        deletedRuns: 0,
        deletedResults: 0,
        deletedNlQueries: 0,
        deletedAttachments: 0,
        durationMs: 42,
      });
      expect(result).toContain('0 runs');
      expect(result).toContain('42ms');
    });

    it('should format non-zero deletions', () => {
      const result = formatCleanupResult({
        deletedRuns: 5,
        deletedResults: 100,
        deletedNlQueries: 10,
        deletedAttachments: 50,
        durationMs: 1234,
      });
      expect(result).toContain('5 runs');
      expect(result).toContain('100 results');
      expect(result).toContain('10 NL queries');
      expect(result).toContain('50 attachments');
      expect(result).toContain('1234ms');
    });
  });
});
