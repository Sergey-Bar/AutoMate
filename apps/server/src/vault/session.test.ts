import { describe, expect, it } from 'vitest';
import { createVaultSession } from './session.js';

describe('vault session', () => {
  it('locks and unlocks in-memory master password', () => {
    const session = createVaultSession();
    session.unlock('master-pass');
    expect(session.isUnlocked()).toBe(true);
    session.lock();
    expect(session.isUnlocked()).toBe(false);
  });
});
