import { describe, expect, it } from 'vitest';
import { DrizzleAuthSessionBackend } from './session-backend.js';

describe('DrizzleAuthSessionBackend', () => {
  it('hashes issued tokens, adapts rows, revokes and sweeps sessions', async () => {
    const created: Array<Record<string, unknown>> = [];
    const cutoffs: Date[] = [];
    const store = {
      ensureInstallation: async () => undefined,
      create: async (input: Record<string, unknown>) => {
        created.push(input);
        return String(input.id);
      },
      findValid: async () => ({
        id: 'session-1',
        installationId: 'installation-1',
        tokenHash: 'hash',
        issuedAt: new Date('2026-01-01'),
        expiresAt: new Date('2026-01-02'),
      }),
      revoke: async () => true,
      deleteExpired: async (cutoff: Date) => {
        cutoffs.push(cutoff);
        return 3;
      },
    };
    const backend = new DrizzleAuthSessionBackend(
      store as never,
      's'.repeat(32),
      1000,
      // The retention window, which the constructor now takes: a row is kept past
      // its validity so that "was this ever valid" still has an answer, and the
      // sweep is what stops the table growing.
      30 * 24 * 60 * 60 * 1000,
      () => new Date('2026-01-01'),
    );
    const issued = await backend.issue('installation-1');
    expect(issued.token).toHaveLength(72);
    expect(created[0]?.['id']).toBe(issued.record.id);
    expect(await backend.validate(issued.token)).toMatchObject({ id: 'session-1' });
    expect(await backend.revoke('session-1')).toBe(true);
    // The sweep passes a cutoff derived from the retention window and the clock.
    expect(await backend.sweep()).toEqual({ removed: 3 });
    expect(cutoffs[0]?.toISOString()).toBe('2025-12-02T00:00:00.000Z');
  });

  it('falls back to the wall clock when no clock is injected', async () => {
    // Every other case in this file passes a clock, which left the default
    // `() => new Date()` unexecuted — a default nobody had ever called is a default
    // nobody has verified, and the constructor is what production uses.
    const store = {
      ensureInstallation: async () => undefined,
      create: async () => 'session-2',
      findValid: async () => undefined,
      revoke: async () => true,
      deleteExpired: async () => 0,
    };
    // The fifth argument is omitted on purpose; the fourth is the retention window.
    const backend = new DrizzleAuthSessionBackend(
      store as never,
      's'.repeat(32),
      1000,
      30 * 24 * 60 * 60 * 1000,
    );
    // A default clock cannot be asserted against a fixed instant, so the property is
    // that it produces a *plausible* one — which is all "did not throw on a date" is.
    const before = Date.now();
    const issued = await backend.issue('installation-1');
    const after = Date.now();
    expect(issued.record.issuedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(issued.record.issuedAt.getTime()).toBeLessThanOrEqual(after);
  });
});
