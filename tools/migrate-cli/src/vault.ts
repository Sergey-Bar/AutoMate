export interface VaultTransferReference {
  sourceId: string;
  targetId: string;
  envelopeVersion: number;
  keyReference: string;
}

export function validateVaultTransfer(reference: VaultTransferReference): void {
  if (!reference.sourceId || !reference.targetId)
    throw new Error('Vault transfer requires source and target IDs');
  if (!Number.isInteger(reference.envelopeVersion) || reference.envelopeVersion < 1)
    throw new Error('Invalid vault envelope version');
  if (!reference.keyReference || reference.keyReference === 'unconfigured')
    throw new Error('Vault transfer requires a key reference');
}
