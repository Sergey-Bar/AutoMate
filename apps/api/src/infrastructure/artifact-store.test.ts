import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FallbackArtifactBytesStore,
  LocalArtifactBytesStore,
  LocalArtifactStore,
} from './artifact-store.js';

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

  it('reads legacy bytes through an explicit fallback without changing writes', async () => {
    const primaryRoot = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-primary-'));
    const fallbackRoot = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-fallback-'));
    try {
      const primary = new LocalArtifactBytesStore(new LocalArtifactStore(primaryRoot));
      const fallback = new LocalArtifactBytesStore(new LocalArtifactStore(fallbackRoot));
      const legacy = new TextEncoder().encode('legacy');
      await fallback.put('runs/run-1/report.json', legacy);
      const store = new FallbackArtifactBytesStore(primary, fallback);
      expect(await store.get('runs/run-1/report.json')).toEqual(legacy);
      const current = new TextEncoder().encode('current');
      await store.put('runs/run-1/new.json', current);
      expect(await primary.get('runs/run-1/new.json')).toEqual(current);
      expect(await fallback.get('runs/run-1/new.json')).toBeNull();
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
      await rm(fallbackRoot, { recursive: true, force: true });
    }
  });

  it('rejects traversal keys', async () => {
    const store = new LocalArtifactStore(await mkdtemp(path.join(tmpdir(), 'automate-artifacts-')));
    await expect(
      store.put({ key: '../secret', bytes: new Uint8Array(), contentType: 'text/plain' }),
    ).rejects.toThrow();
  });

  it('publishes a complete artifact under concurrent writes to the same key', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const store = new LocalArtifactStore(root);
      const key = 'runs/run-1/contended.bin';
      // A shared `${target}.tmp` let two writes to one key interleave, so the
      // published artifact could be the loser's truncated body. This guards the
      // invariant; it does not claim to reproduce the original race window.
      const small = new Uint8Array(16).fill(1);
      const large = new Uint8Array(4_096).fill(2);
      await Promise.all([
        store.putAt(key, small),
        store.putAt(key, large),
        store.putAt(key, small),
        store.putAt(key, large),
      ]);
      const published = await store.readAt(key);
      const isSmall =
        published.byteLength === small.byteLength && published.every((byte) => byte === 1);
      const isLarge =
        published.byteLength === large.byteLength && published.every((byte) => byte === 2);
      expect(isSmall || isLarge).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves no temporary file behind when the publish step fails', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const store = new LocalArtifactStore(root);
      // Rename onto an existing non-empty directory fails deterministically,
      // after the temporary has already been written.
      await mkdir(path.join(root, 'runs/occupied'), { recursive: true });
      await writeFile(path.join(root, 'runs/occupied/child'), 'occupied');

      await expect(store.putAt('runs/occupied', new Uint8Array(4))).rejects.toThrow();

      const remaining = await readdir(path.join(root, 'runs'));
      expect(remaining).toEqual(['occupied']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
