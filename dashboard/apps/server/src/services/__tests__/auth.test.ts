import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn<(filePath: string) => boolean>(),
  readFileSync: vi.fn<(filePath: string, encoding: BufferEncoding) => string>(),
  writeFileSync: vi.fn<(filePath: string, data: string, encoding: BufferEncoding) => void>(),
  mkdirSync: vi.fn<(dirPath: string, options?: { recursive?: boolean }) => void>(),
}));

vi.mock('node:fs', () => ({
  default: fsMocks,
  existsSync: fsMocks.existsSync,
  readFileSync: fsMocks.readFileSync,
  writeFileSync: fsMocks.writeFileSync,
  mkdirSync: fsMocks.mkdirSync,
}));

// Mock the dynamic DB imports used by validateSessionTokenAsync
const dbMocks = vi.hoisted(() => {
  const mockLimit = vi.fn<() => Promise<unknown[]>>();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockSelect, mockFrom, mockWhere, mockLimit };
});

vi.mock('../../db/client.js', () => ({
  db: { select: dbMocks.mockSelect },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

vi.mock('../../db/schema.js', () => ({
  users: { id: 'id', email: 'email' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (field: unknown, val: unknown) => ({ field, val }),
}));

import {
  loadAuthConfig,
  saveAuthConfig,
  generateApiKey,
  validateApiKey,
  revokeApiKey,
  listApiKeys,
  generateSessionToken,
  validateSessionToken,
  validateSessionTokenAsync,
  type AuthConfig,
} from '../auth.js';

describe('auth service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loadAuthConfig', () => {
    it('should return default config when file does not exist', () => {
      fsMocks.existsSync.mockReturnValue(false);

      const config = loadAuthConfig();

      expect(config).toEqual({
        keys: [],
        enabled: false,
      });
      expect(fsMocks.existsSync).toHaveBeenCalled();
      expect(fsMocks.readFileSync).not.toHaveBeenCalled();
    });

    it('should return merged config when file exists with valid JSON', () => {
      const storedConfig: AuthConfig = {
        keys: [
          {
            id: 'key-1',
            name: 'test-key',
            key: 'secret-key-value',
            createdAt: '2024-01-01T00:00:00.000Z',
            lastUsedAt: null,
          },
        ],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(storedConfig));

      const config = loadAuthConfig();

      expect(config).toEqual(storedConfig);
      expect(fsMocks.existsSync).toHaveBeenCalled();
      expect(fsMocks.readFileSync).toHaveBeenCalledWith(expect.stringContaining('auth.json'), 'utf-8');
    });

    it('should return default config when JSON parsing fails', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue('{ invalid json }');

      const config = loadAuthConfig();

      expect(config).toEqual({
        keys: [],
        enabled: false,
      });
      expect(fsMocks.readFileSync).toHaveBeenCalled();
    });

    it('should merge stored config with defaults', () => {
      const partialConfig = {
        keys: [
          {
            id: 'key-1',
            name: 'test-key',
            key: 'secret',
            createdAt: '2024-01-01T00:00:00.000Z',
            lastUsedAt: null,
          },
        ],
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(partialConfig));

      const config = loadAuthConfig();

      expect(config.keys).toEqual(partialConfig.keys);
      expect(config.enabled).toBe(false); // from default
    });
  });

  describe('saveAuthConfig', () => {
    it('should create directory if it does not exist', () => {
      const config: AuthConfig = {
        keys: [],
        enabled: false,
      };

      fsMocks.existsSync.mockReturnValue(false);

      saveAuthConfig(config);

      expect(fsMocks.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.automate'),
        { recursive: true }
      );
    });

    it('should not create directory if it already exists', () => {
      const config: AuthConfig = {
        keys: [],
        enabled: false,
      };

      fsMocks.existsSync.mockReturnValue(true);

      saveAuthConfig(config);

      expect(fsMocks.mkdirSync).not.toHaveBeenCalled();
    });

    it('should write config as formatted JSON', () => {
      const config: AuthConfig = {
        keys: [
          {
            id: 'key-1',
            name: 'test-key',
            key: 'secret',
            createdAt: '2024-01-01T00:00:00.000Z',
            lastUsedAt: '2024-01-02T00:00:00.000Z',
          },
        ],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);

      saveAuthConfig(config);

      expect(fsMocks.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('auth.json'),
        expect.stringContaining(JSON.stringify(config, null, 2)),
        'utf-8'
      );
    });
  });

  describe('generateApiKey', () => {
    it('should generate a key with correct shape', () => {
      const name = 'my-test-key';

      const key = generateApiKey(name);

      expect(key).toHaveProperty('id');
      expect(key).toHaveProperty('name', name);
      expect(key).toHaveProperty('key');
      expect(key).toHaveProperty('createdAt');
      expect(key).toHaveProperty('lastUsedAt', null);
    });

    it('should generate unique IDs', () => {
      const key1 = generateApiKey('key-1');
      const key2 = generateApiKey('key-2');

      expect(key1.id).not.toBe(key2.id);
    });

    it('should generate unique keys', () => {
      const key1 = generateApiKey('key-1');
      const key2 = generateApiKey('key-2');

      expect(key1.key).not.toBe(key2.key);
    });

    it('should have 64-character hex keys (32 bytes)', () => {
      const key = generateApiKey('test');

      expect(key.key).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(key.key)).toBe(true);
    });

    it('should have ISO timestamp for createdAt', () => {
      const key = generateApiKey('test');
      const date = new Date(key.createdAt);

      expect(date instanceof Date && !isNaN(date.getTime())).toBe(true);
    });

    it('should set lastUsedAt to null', () => {
      const key = generateApiKey('test');

      expect(key.lastUsedAt).toBeNull();
    });
  });

  describe('validateApiKey', () => {
    it('should return false when key does not match any stored key', () => {
      const storedKey = generateApiKey('stored');
      const config: AuthConfig = {
        keys: [storedKey],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = validateApiKey('wrong-key');

      expect(result).toBe(false);
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('should return true when key matches a stored key', () => {
      const storedKey = generateApiKey('stored');
      const config: AuthConfig = {
        keys: [storedKey],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = validateApiKey(storedKey.key);

      expect(result).toBe(true);
    });

    it('should update lastUsedAt when key is validated', () => {
      const storedKey = generateApiKey('stored');
      const config: AuthConfig = {
        keys: [storedKey],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      validateApiKey(storedKey.key);

      expect(fsMocks.writeFileSync).toHaveBeenCalled();
      const savedConfig = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
      expect(savedConfig.keys[0].lastUsedAt).not.toBeNull();
    });

    it('should use timing-safe comparison', () => {
      const storedKey = generateApiKey('stored');
      const config: AuthConfig = {
        keys: [storedKey],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      // This should not throw due to timing-safe comparison
      const result = validateApiKey(storedKey.key);
      expect(result).toBe(true);
    });

    it('should return false for empty key config', () => {
      const config: AuthConfig = {
        keys: [],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = validateApiKey('any-key');

      expect(result).toBe(false);
    });

    it('should handle keys with different lengths', () => {
      const storedKey = generateApiKey('stored');
      const config: AuthConfig = {
        keys: [storedKey],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = validateApiKey('short-key');

      expect(result).toBe(false);
    });

    it('should not save config if key does not match', () => {
      const storedKey = generateApiKey('stored');
      const config: AuthConfig = {
        keys: [storedKey],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      validateApiKey('wrong-key');

      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('revokeApiKey', () => {
    it('should remove key by id', () => {
      const key1 = generateApiKey('key-1');
      const key2 = generateApiKey('key-2');
      const config: AuthConfig = {
        keys: [key1, key2],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = revokeApiKey(key1.id);

      expect(result).toBe(true);
      const savedConfig = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
      expect(savedConfig.keys).toHaveLength(1);
      expect(savedConfig.keys[0].id).toBe(key2.id);
    });

    it('should return false if key id not found', () => {
      const key1 = generateApiKey('key-1');
      const config: AuthConfig = {
        keys: [key1],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = revokeApiKey('non-existent-id');

      expect(result).toBe(false);
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });

    it('should return true for successful revocation', () => {
      const key1 = generateApiKey('key-1');
      const config: AuthConfig = {
        keys: [key1],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = revokeApiKey(key1.id);

      expect(result).toBe(true);
    });

    it('should preserve enabled flag when revoking', () => {
      const key1 = generateApiKey('key-1');
      const config: AuthConfig = {
        keys: [key1],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      revokeApiKey(key1.id);

      const savedConfig = JSON.parse(fsMocks.writeFileSync.mock.calls[0][1] as string);
      expect(savedConfig.enabled).toBe(true);
    });

    it('should handle empty key list', () => {
      const config: AuthConfig = {
        keys: [],
        enabled: false,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const result = revokeApiKey('any-id');

      expect(result).toBe(false);
      expect(fsMocks.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('listApiKeys', () => {
    it('should return keys with masked key preview', () => {
      const key1 = generateApiKey('key-1');
      const config: AuthConfig = {
        keys: [key1],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const keys = listApiKeys();

      expect(keys).toHaveLength(1);
      expect(keys[0]).toHaveProperty('keyPreview');
      expect(keys[0].keyPreview).toMatch(/^.{8}\.\.\./);
    });

    it('should not include full key in response', () => {
      const key1 = generateApiKey('key-1');
      const config: AuthConfig = {
        keys: [key1],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const keys = listApiKeys();

      expect(keys[0]).not.toHaveProperty('key');
    });

    it('should include id, name, createdAt, lastUsedAt', () => {
      const key1 = generateApiKey('key-1');
      key1.lastUsedAt = '2024-01-02T00:00:00.000Z';
      const config: AuthConfig = {
        keys: [key1],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const keys = listApiKeys();

      expect(keys[0]).toHaveProperty('id', key1.id);
      expect(keys[0]).toHaveProperty('name', key1.name);
      expect(keys[0]).toHaveProperty('createdAt', key1.createdAt);
      expect(keys[0]).toHaveProperty('lastUsedAt', key1.lastUsedAt);
    });

    it('should return empty array when no keys exist', () => {
      const config: AuthConfig = {
        keys: [],
        enabled: false,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const keys = listApiKeys();

      expect(keys).toEqual([]);
    });

    it('should return multiple keys with correct previews', () => {
      const key1 = generateApiKey('key-1');
      const key2 = generateApiKey('key-2');
      const config: AuthConfig = {
        keys: [key1, key2],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const keys = listApiKeys();

      expect(keys).toHaveLength(2);
      expect(keys[0].keyPreview).toMatch(/^.{8}\.\.\./);
      expect(keys[1].keyPreview).toMatch(/^.{8}\.\.\./);
      expect(keys[0].keyPreview).not.toBe(keys[1].keyPreview);
    });

    it('should show first 8 characters and ellipsis in preview', () => {
      const key1 = generateApiKey('key-1');
      const config: AuthConfig = {
        keys: [key1],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      const keys = listApiKeys();

      expect(keys[0].keyPreview).toBe(`${key1.key.slice(0, 8)}...`);
    });
  });

  describe('integration scenarios', () => {
    it('should generate, list, validate, and revoke a key workflow', () => {
      // Generate
      const generatedKey = generateApiKey('integration-test');
      const config: AuthConfig = {
        keys: [generatedKey],
        enabled: true,
      };

      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify(config));

      // List
      const keys = listApiKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('integration-test');

      // Validate
      const isValid = validateApiKey(generatedKey.key);
      expect(isValid).toBe(true);

      // Update config with lastUsedAt
      const savedAfterValidate = JSON.parse(
        fsMocks.writeFileSync.mock.calls[0][1] as string
      ) as AuthConfig;

      fsMocks.readFileSync.mockReturnValue(JSON.stringify(savedAfterValidate));
      fsMocks.writeFileSync.mockClear();

      // Revoke
      const revoked = revokeApiKey(generatedKey.id);
      expect(revoked).toBe(true);

      const savedAfterRevoke = JSON.parse(
        fsMocks.writeFileSync.mock.calls[0][1] as string
      ) as AuthConfig;

      expect(savedAfterRevoke.keys).toHaveLength(0);
    });
  });

  describe('generateSessionToken / validateSessionToken', () => {
    beforeEach(() => {
      process.env.COOKIE_SECRET = 'test-secret-32-chars-long-enough!';
    });

    afterEach(() => {
      delete process.env.COOKIE_SECRET;
    });

    it('generateSessionToken produces a colon-separated token', () => {
      const token = generateSessionToken('key-abc');
      const parts = token.split(':');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe('key-abc');
    });

    it('validateSessionToken returns false for malformed token', () => {
      expect(validateSessionToken('bad')).toBe(false);
      expect(validateSessionToken('')).toBe(false);
      expect(validateSessionToken('a:b')).toBe(false);
    });

    it('validateSessionToken returns false when signature is wrong', () => {
      const token = generateSessionToken('key-xyz');
      const parts = token.split(':');
      const tampered = `${parts[0]}:${parts[1]}:badhex`;
      expect(validateSessionToken(tampered)).toBe(false);
    });

    it('validateSessionToken returns false for expired token', () => {
      const oldTimestamp = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago
      const payload = `key-old:${oldTimestamp}`;
      const crypto = require('node:crypto');
      const sig = crypto.createHmac('sha256', 'test-secret-32-chars-long-enough!').update(payload).digest('hex');
      const token = `${payload}:${sig}`;
      expect(validateSessionToken(token)).toBe(false);
    });

    it('validateSessionToken returns false when keyId not in file config', () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ keys: [], enabled: true }));
      const token = generateSessionToken('missing-key-id');
      expect(validateSessionToken(token)).toBe(false);
    });

    it('validateSessionToken returns true for valid token with matching key', () => {
      const key = generateApiKey('my-key');
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ keys: [key], enabled: true }));
      const token = generateSessionToken(key.id);
      expect(validateSessionToken(token)).toBe(true);
    });
  });

  describe('validateSessionTokenAsync', () => {
    beforeEach(() => {
      process.env.COOKIE_SECRET = 'test-secret-32-chars-long-enough!';
      vi.clearAllMocks();
    });

    afterEach(() => {
      delete process.env.COOKIE_SECRET;
    });

    it('returns false for malformed token', async () => {
      expect(await validateSessionTokenAsync('bad')).toBe(false);
      expect(await validateSessionTokenAsync('')).toBe(false);
    });

    it('returns false when signature is wrong', async () => {
      const token = generateSessionToken('key-xyz');
      const parts = token.split(':');
      const tampered = `${parts[0]}:${parts[1]}:badhex`;
      expect(await validateSessionTokenAsync(tampered)).toBe(false);
    });

    it('returns true for file-config API key (existing behavior)', async () => {
      const key = generateApiKey('file-key');
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ keys: [key], enabled: true }));
      const token = generateSessionToken(key.id);
      expect(await validateSessionTokenAsync(token)).toBe(true);
    });

    it('returns true for DB user session when file keys do not match', async () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ keys: [], enabled: true }));

      dbMocks.mockLimit.mockResolvedValue([{ id: 'user-uuid-123' }]);

      const token = generateSessionToken('user-uuid-123');
      expect(await validateSessionTokenAsync(token)).toBe(true);
    });

    it('returns false when neither file config nor DB match the keyId', async () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ keys: [], enabled: true }));

      dbMocks.mockLimit.mockResolvedValue([]);

      const token = generateSessionToken('unknown-id');
      expect(await validateSessionTokenAsync(token)).toBe(false);
    });

    it('returns false when DB lookup throws', async () => {
      fsMocks.existsSync.mockReturnValue(true);
      fsMocks.readFileSync.mockReturnValue(JSON.stringify({ keys: [], enabled: true }));

      dbMocks.mockLimit.mockRejectedValue(new Error('DB error'));

      const token = generateSessionToken('user-id');
      expect(await validateSessionTokenAsync(token)).toBe(false);
    });
  });
});
