import { describe, expect, it } from 'vitest';
import { DrizzleAuthSessionBackend } from './session-backend.js';

describe('DrizzleAuthSessionBackend', () => {
  it('hashes issued tokens, adapts rows, and revokes sessions', async () => {
    const created: Array<Record<string, unknown>> = [];
    const store = {
      ensureInstallation: async () => undefined,
      create: async (input: Record<string, unknown>) => { created.push(input); return String(input.id); },
      findValid: async () => ({ id: 'session-1', installationId: 'installation-1', tokenHash: 'hash', issuedAt: new Date('2026-01-01'), expiresAt: new Date('2026-01-02') }),
      revoke: async () => true,
    };
    const backend = new DrizzleAuthSessionBackend(store as never, 's'.repeat(32), 1000, () => new Date('2026-01-01'));
    const issued = await backend.issue('installation-1');
    expect(issued.token).toHaveLength(72);
    expect(created[0]?.['id']).toBe(issued.record.id);
    expect(await backend.validate(issued.token)).toMatchObject({ id: 'session-1' });
    expect(await backend.revoke('session-1')).toBe(true);
  });
});
