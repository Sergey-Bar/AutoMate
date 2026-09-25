import { describe, expect, it } from 'vitest';
import { createVaultSession } from './session.js';

describe('vault session additional coverage', () => {
  it('getMasterPassword throws when vault is locked (line 16)', () => {
    const session = createVaultSession();
    // Vault starts locked — getMasterPassword should throw
    expect(() => session.getMasterPassword()).toThrow('Vault is locked');
  });

  it('getMasterPassword returns the password after unlock', () => {
    const session = createVaultSession();
    session.unlock('secret-master');
    expect(session.getMasterPassword()).toBe('secret-master');
  });

  it('getMasterPassword throws again after locking', () => {
    const session = createVaultSession();
    session.unlock('my-pass');
    expect(session.getMasterPassword()).toBe('my-pass');
    session.lock();
    expect(() => session.getMasterPassword()).toThrow('Vault is locked');
  });

  it('isUnlocked reflects lock/unlock state correctly', () => {
    const session = createVaultSession();
    expect(session.isUnlocked()).toBe(false);
    session.unlock('pass');
    expect(session.isUnlocked()).toBe(true);
    session.lock();
    expect(session.isUnlocked()).toBe(false);
  });

  it('multiple unlock calls update the master password', () => {
    const session = createVaultSession();
    session.unlock('first-pass');
    expect(session.getMasterPassword()).toBe('first-pass');
    session.unlock('second-pass');
    expect(session.getMasterPassword()).toBe('second-pass');
  });
});
