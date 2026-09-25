/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ─── DB mock ────────────────────────────────────────────────────────────────
const { mockWhere, mockFrom, mockSelect, mockValues, mockInsert } = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockValues = vi.fn().mockResolvedValue({});
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  return { mockWhere, mockFrom, mockSelect, mockValues, mockInsert };
});

vi.mock('../../db/client.js', () => ({
  db: { select: mockSelect, insert: mockInsert },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// ─── Auth service mock ──────────────────────────────────────────────────────
const { mockValidateApiKey, mockLoadAuthConfig } = vi.hoisted(() => {
  const mockValidateApiKey = vi.fn<(key: string) => boolean>();
  const mockLoadAuthConfig = vi.fn();
  return { mockValidateApiKey, mockLoadAuthConfig };
});

vi.mock('../auth.js', () => ({
  validateApiKey: mockValidateApiKey,
  loadAuthConfig: mockLoadAuthConfig,
}));

import {
  hashApiKey,
  validateApiKeyFromDb,
  validateApiKeyDualRead,
  migrateFileKeysToDb,
} from '../api-key-db.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockWhere.mockResolvedValue([]);
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
  mockValues.mockResolvedValue({});
  mockInsert.mockReturnValue({ values: mockValues });
  mockValidateApiKey.mockReturnValue(false);
  mockLoadAuthConfig.mockReturnValue({ keys: [], enabled: false });
});

describe('hashApiKey', () => {
  it('produces a 64-char hex string', () => {
    const hash = hashApiKey('my-secret-key');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it('is deterministic — same input produces same hash', () => {
    const h1 = hashApiKey('test-key');
    const h2 = hashApiKey('test-key');
    expect(h1).toBe(h2);
  });

  it('produces different hashes for different keys', () => {
    const h1 = hashApiKey('key-one');
    const h2 = hashApiKey('key-two');
    expect(h1).not.toBe(h2);
  });

  it('matches crypto.createHash output', () => {
    const key = 'verification-key';
    const expected = crypto.createHash('sha256').update(key).digest('hex');
    expect(hashApiKey(key)).toBe(expected);
  });
});

describe('validateApiKeyFromDb', () => {
  it('returns false when no active keys in DB', async () => {
    mockWhere.mockResolvedValue([]);
    const result = await validateApiKeyFromDb('any-key');
    expect(result).toBe(false);
  });

  it('returns true when key hash matches a stored hash', async () => {
    const key = 'valid-api-key-abc123';
    const hash = hashApiKey(key);
    mockWhere.mockResolvedValue([{ keyHash: hash }]);

    const result = await validateApiKeyFromDb(key);
    expect(result).toBe(true);
  });

  it('returns false when key hash does not match stored hashes', async () => {
    const key = 'valid-api-key-abc123';
    const hash = hashApiKey('different-key');
    mockWhere.mockResolvedValue([{ keyHash: hash }]);

    const result = await validateApiKeyFromDb(key);
    expect(result).toBe(false);
  });

  it('returns true when one of multiple stored hashes matches', async () => {
    const key = 'correct-key';
    const correctHash = hashApiKey(key);
    const wrongHash = hashApiKey('wrong-key');
    mockWhere.mockResolvedValue([
      { keyHash: wrongHash },
      { keyHash: correctHash },
    ]);

    const result = await validateApiKeyFromDb(key);
    expect(result).toBe(true);
  });

  it('skips rows with different-length hashes (malformed data)', async () => {
    const key = 'my-key';
    // Malformed stored hash that is shorter → should be skipped, not throw
    mockWhere.mockResolvedValue([{ keyHash: 'short' }]);

    const result = await validateApiKeyFromDb(key);
    expect(result).toBe(false);
  });
});

describe('validateApiKeyDualRead', () => {
  it('returns true when key is found in DB (no file fallback needed)', async () => {
    const key = 'db-backed-key';
    const hash = hashApiKey(key);
    mockWhere.mockResolvedValue([{ keyHash: hash }]);

    const result = await validateApiKeyDualRead(key);
    expect(result).toBe(true);
    expect(mockValidateApiKey).not.toHaveBeenCalled(); // file not checked
  });

  it('falls back to file auth when key is not in DB', async () => {
    const key = 'file-only-key';
    mockWhere.mockResolvedValue([]); // not in DB
    mockValidateApiKey.mockReturnValue(true); // but valid in file

    const result = await validateApiKeyDualRead(key);
    expect(result).toBe(true);
    expect(mockValidateApiKey).toHaveBeenCalledWith(key);
  });

  it('returns false when key is in neither DB nor file', async () => {
    mockWhere.mockResolvedValue([]); // not in DB
    mockValidateApiKey.mockReturnValue(false); // not in file

    const result = await validateApiKeyDualRead('unknown-key');
    expect(result).toBe(false);
  });
});

describe('migrateFileKeysToDb', () => {
  it('returns 0 when auth.json has no keys', async () => {
    mockLoadAuthConfig.mockReturnValue({ keys: [], enabled: false });

    const count = await migrateFileKeysToDb();
    expect(count).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('migrates keys from auth.json to DB', async () => {
    const fileKey = {
      id: 'key-id-1',
      name: 'CI key',
      key: 'plaintext-api-key',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastUsedAt: null,
    };
    mockLoadAuthConfig.mockReturnValue({ keys: [fileKey], enabled: true });
    mockWhere.mockResolvedValue([]); // not in DB yet

    const count = await migrateFileKeysToDb();
    expect(count).toBe(1);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockValues).toHaveBeenCalledWith(expect.objectContaining({
      id: fileKey.id,
      name: fileKey.name,
      keyHash: hashApiKey(fileKey.key),
      role: 'admin',
    }));
  });

  it('skips keys already in DB (idempotent)', async () => {
    const fileKey = {
      id: 'already-migrated-id',
      name: 'existing',
      key: 'some-key',
      createdAt: '2024-01-01T00:00:00.000Z',
      lastUsedAt: null,
    };
    mockLoadAuthConfig.mockReturnValue({ keys: [fileKey], enabled: true });
    mockWhere.mockResolvedValue([{ id: fileKey.id }]); // already in DB

    const count = await migrateFileKeysToDb();
    expect(count).toBe(0);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('stores hashed key, never plaintext', async () => {
    const plainKey = 'super-secret-plaintext';
    const fileKey = {
      id: 'key-id-2',
      name: 'my key',
      key: plainKey,
      createdAt: '2024-01-01T00:00:00.000Z',
      lastUsedAt: null,
    };
    mockLoadAuthConfig.mockReturnValue({ keys: [fileKey], enabled: true });
    mockWhere.mockResolvedValue([]);

    await migrateFileKeysToDb();

    const insertedValues = mockValues.mock.calls[0]?.[0];
    expect(insertedValues).toBeDefined();
    expect(insertedValues.keyHash).toBe(hashApiKey(plainKey));
    expect(insertedValues.keyHash).not.toBe(plainKey);
    expect((insertedValues as Record<string, string>).key).toBeUndefined();
  });

  it('migrates multiple keys and returns correct count', async () => {
    const keys = [
      { id: 'id-1', name: 'k1', key: 'key1', createdAt: '2024-01-01T00:00:00Z', lastUsedAt: null },
      { id: 'id-2', name: 'k2', key: 'key2', createdAt: '2024-01-01T00:00:00Z', lastUsedAt: null },
    ];
    mockLoadAuthConfig.mockReturnValue({ keys, enabled: true });
    mockWhere.mockResolvedValue([]); // neither in DB

    const count = await migrateFileKeysToDb();
    expect(count).toBe(2);
    expect(mockInsert).toHaveBeenCalledTimes(2);
  });
});
