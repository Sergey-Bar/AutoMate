import { decryptSecret, encryptSecret } from './crypto.js';
import { createVaultRepository } from './repository.js';
import { createVaultSession } from './session.js';

export function createVaultService() {
  const repo = createVaultRepository();
  const session = createVaultSession();

  return {
    async unlock(password: string) {
      session.unlock(password);
    },
    lock() {
      session.lock();
    },
    isUnlocked() {
      return session.isUnlocked();
    },
    close() {
      repo.close();
    },
    async setCredential(connectorName: string, secret: string) {
      if (!session.isUnlocked()) {
        throw new Error('Vault must be unlocked before setting credentials');
      }
      const encrypted = await encryptSecret(session.getMasterPassword(), secret);
      await repo.upsert(connectorName, encrypted);
    },
    async getCredential(connectorName: string) {
      if (!session.isUnlocked()) {
        throw new Error('Vault must be unlocked before getting credentials');
      }
      const encrypted = await repo.get(connectorName);
      if (!encrypted) {
        return null;
      }

      try {
        return await decryptSecret(session.getMasterPassword(), encrypted);
      } catch (err) {
        throw new Error(`Failed to decrypt credential for ${connectorName}: ${(err as Error).message}`);
      }
    },
  };
}
