import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalArtifactBytesStore, LocalArtifactStore } from './artifact-store.js';

describe('LocalArtifactStore', () => {
  it('writes, verifies, and reads a relative artifact', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const store = new LocalArtifactStore(root);
      const artifact = await store.put({
        key: 'runs/run-1/report.json',
        bytes: new TextEncoder().encode('{}'),
        contentType: 'application/json',
      });
      expect(artifact.digest).toHaveLength(64);
      expect((await store.read(artifact)).length).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('supports deterministic execution storage keys and missing reads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const store = new LocalArtifactStore(root);
      const bytes = new TextEncoder().encode('evidence');
      await store.putAt('runs/run-1/report.json', bytes);
      expect(await store.readAt('runs/run-1/report.json')).toEqual(bytes);
      const adapter = new LocalArtifactBytesStore(store);
      await adapter.put('runs/run-1/screenshot.png', bytes);
      expect(await adapter.get('runs/run-1/screenshot.png')).toEqual(bytes);
      expect(await adapter.get('missing')).toBeNull();
      await expect(store.putAt('../escape', bytes)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects traversal keys', async () => {
    const store = new LocalArtifactStore(await mkdtemp(path.join(tmpdir(), 'automate-artifacts-')));
    await expect(
      store.put({ key: '../secret', bytes: new Uint8Array(), contentType: 'text/plain' }),
    ).rejects.toThrow();
  });
});
