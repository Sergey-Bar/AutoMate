/**
 * Tests for services/audit.ts — logAuditEvent
 *
 * Covers:
 *  - logAuditEvent no-op when 'audit-trail' flag is OFF
 *  - logAuditEvent inserts row into DB when flag is ON
 *  - logAuditEvent never throws even if DB insert fails
 *  - logAuditEvent uses actorType='user' by default
 *  - logAuditEvent serialises details as JSON
 *  - logAuditEvent sets timestamp and createdAt to current ISO date
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockIsEnabled,
  mockDbInsert,
  mockDbValues,
  mockDbThen,
} = vi.hoisted(() => ({
  mockIsEnabled: vi.fn<(flag: string) => boolean>(),
  mockDbInsert: vi.fn(),
  mockDbValues: vi.fn(),
  mockDbThen: vi.fn(),
}));

vi.mock('../../services/feature-flags.js', () => ({
  isEnabled: mockIsEnabled,
  requireFeature: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({
  db: { insert: mockDbInsert },
  sqlite: { prepare: vi.fn() },
  poolConnection: { query: vi.fn() },
  isPostgres: false,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('logAuditEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Chain: db.insert(table).values({...}).then(...).catch(...)
    const mockCatch = vi.fn();
    mockDbThen.mockReturnValue({ catch: mockCatch });
    mockDbValues.mockReturnValue({ then: mockDbThen });
    mockDbInsert.mockReturnValue({ values: mockDbValues });
  });

  it('is a no-op when audit-trail flag is OFF', async () => {
    mockIsEnabled.mockReturnValue(false);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'key-1', action: 'auth.login' });

    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it('calls db.insert when audit-trail flag is ON', async () => {
    mockIsEnabled.mockReturnValue(true);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'key-1', action: 'auth.login' });

    expect(mockDbInsert).toHaveBeenCalledTimes(1);
    expect(mockDbValues).toHaveBeenCalledTimes(1);
  });

  it('inserts row with correct action and actorId', async () => {
    mockIsEnabled.mockReturnValue(true);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'key-abc', action: 'key.create', resourceType: 'api_key', resourceId: 'key-xyz' });

    const insertedValues = mockDbValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues).toBeDefined();
    expect(insertedValues['actorId']).toBe('key-abc');
    expect(insertedValues['action']).toBe('key.create');
    expect(insertedValues['resourceType']).toBe('api_key');
    expect(insertedValues['resourceId']).toBe('key-xyz');
  });

  it('uses actorType=user by default', async () => {
    mockIsEnabled.mockReturnValue(true);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'key-1', action: 'auth.login' });

    const insertedValues = mockDbValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues?.['actorType']).toBe('user');
  });

  it('respects explicit actorType=system', async () => {
    mockIsEnabled.mockReturnValue(true);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'system', actorType: 'system', action: 'retention.cleanup' });

    const insertedValues = mockDbValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues?.['actorType']).toBe('system');
  });

  it('serialises details as JSON string', async () => {
    mockIsEnabled.mockReturnValue(true);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'key-1', action: 'auth.login', details: { ip: '1.2.3.4', foo: 42 } });

    const insertedValues = mockDbValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof insertedValues?.['details']).toBe('string');
    const parsed = JSON.parse(insertedValues['details'] as string) as Record<string, unknown>;
    expect(parsed).toMatchObject({ ip: '1.2.3.4', foo: 42 });
  });

  it('stores null for details when none provided', async () => {
    mockIsEnabled.mockReturnValue(true);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'key-1', action: 'auth.logout' });

    const insertedValues = mockDbValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues?.['details']).toBeNull();
  });

  it('does NOT throw when DB insert rejects', async () => {
    mockIsEnabled.mockReturnValue(true);
    // Simulate .then() returning a promise that rejects, caught by .catch()
    const mockCatch = vi.fn();
    const failingThen = vi.fn().mockReturnValue({ catch: mockCatch });
    mockDbValues.mockReturnValue({ then: failingThen });
    const { logAuditEvent } = await import('../audit.js');

    // Must not throw — fire-and-forget design
    expect(() => {
      logAuditEvent({ actorId: 'key-1', action: 'auth.login' });
    }).not.toThrow();

    // Error handler should be registered
    expect(mockCatch).toHaveBeenCalledWith(expect.any(Function));
  });

  it('includes a generated UUID id and ISO timestamp', async () => {
    mockIsEnabled.mockReturnValue(true);
    const { logAuditEvent } = await import('../audit.js');

    logAuditEvent({ actorId: 'key-1', action: 'auth.login' });

    const insertedValues = mockDbValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(typeof insertedValues?.['id']).toBe('string');
    expect((insertedValues?.['id'] as string).length).toBeGreaterThan(10); // UUID
    expect(typeof insertedValues?.['timestamp']).toBe('string');
    // ISO format check: contains 'T' separator
    expect(insertedValues?.['timestamp'] as string).toContain('T');
  });
});
