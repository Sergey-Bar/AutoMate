export function createVaultSession() {
  let passwordBuf: Buffer | null = null;

  return {
    unlock(masterPassword: string) {
      passwordBuf = Buffer.from(masterPassword, 'utf8');
    },
    lock() {
      if (passwordBuf) {
        passwordBuf.fill(0);
        passwordBuf = null;
      }
    },
    isUnlocked() {
      return passwordBuf !== null;
    },
    getMasterPassword() {
      if (!passwordBuf) {
        throw new Error('Vault is locked');
      }
      return passwordBuf.toString('utf8');
    },
  };
}
