import { describe, expect, it } from 'vitest';
import {
  createOpaqueToken,
  hashCredential,
  InMemorySessionService,
  verifyCredential,
} from './credentials.js';

describe('credential helpers', () => {
  it('hashes and verifies credentials without storing plaintext', () => {
    const hash = hashCredential('secret', 'credential');
    expect(hash).not.toContain('credential');
    expect(verifyCredential('secret', 'credential', hash)).toBe(true);
    expect(verifyCredential('secret', 'wrong', hash)).toBe(false);
  });

  it('issues opaque expiring revocable sessions', () => {
    let now = new Date('2026-09-25T00:00:00.000Z');
    const service = new InMemorySessionService('secret', 1000, () => now);
    const issued = service.issue('installation-1');
    expect(issued.token).toHaveLength(43);
    expect(service.validate(issued.token)?.installationId).toBe('installation-1');
    now = new Date('2026-09-25T00:00:02.000Z');
    expect(service.validate(issued.token)).toBeUndefined();
    now = new Date('2026-09-25T00:00:00.000Z');
    expect(service.revoke(issued.record.id)).toBe(true);
    expect(service.validate(issued.token)).toBeUndefined();
  });

  it('creates high entropy tokens', () => {
    expect(createOpaqueToken()).not.toBe(createOpaqueToken());
  });
});
