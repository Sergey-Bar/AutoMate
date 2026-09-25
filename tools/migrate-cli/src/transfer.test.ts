import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inventoryArtifacts } from './artifacts.js';
import { validateVaultTransfer } from './vault.js';

describe('migration artifact and vault references', () => {
  it('inventories files deterministically without exposing absolute paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifact-source-'));
    try {
      await mkdir(path.join(root, 'nested'));
      await writeFile(path.join(root, 'b.txt'), 'b');
      await writeFile(path.join(root, 'nested', 'a.txt'), 'a');
      expect(await inventoryArtifacts(root)).toEqual([
        { logicalPath: 'b.txt', byteSize: 1, digest: expect.any(String) },
        { logicalPath: 'nested/a.txt', byteSize: 1, digest: expect.any(String) },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('requires a versioned key reference for vault transfer', () => {
    expect(() => validateVaultTransfer({ sourceId: 'a', targetId: 'b', envelopeVersion: 1, keyReference: 'vault-key' })).not.toThrow();
    expect(() => validateVaultTransfer({ sourceId: 'a', targetId: 'b', envelopeVersion: 1, keyReference: '' })).toThrow();
  });
});
