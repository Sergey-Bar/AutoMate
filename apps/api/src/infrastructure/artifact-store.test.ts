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

describe('the byte-store delete is the compensating half of an artifact write', () => {
  it('removes the bytes, and an absent key is success rather than a failure', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const store = new LocalArtifactBytesStore(new LocalArtifactStore(root));
      const bytes = new TextEncoder().encode('evidence');
      await store.put('runs/run-1/trace.zip', bytes);
      expect(await store.get('runs/run-1/trace.zip')).toEqual(bytes);

      await expect(store.delete('runs/run-1/trace.zip')).resolves.toBeUndefined();
      expect(await store.get('runs/run-1/trace.zip')).toBeNull();

      // Idempotent: this runs on a failure path, where "already gone" is the
      // outcome wanted. An ENOENT surfacing as an error would turn a cleaned-up
      // write into a 500.
      await expect(store.delete('runs/run-1/trace.zip')).resolves.toBeUndefined();
      // A key that was never written is the same case.
      await expect(store.delete('runs/run-1/never-existed')).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a traversal key rather than deleting outside the root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const store = new LocalArtifactBytesStore(new LocalArtifactStore(root));
      await expect(store.delete('../secret')).rejects.toThrow(/relative|escapes/i);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('removes from both tiers, so a cleanup cannot miss the tier holding the bytes', async () => {
    const primaryRoot = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-primary-'));
    const fallbackRoot = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-fallback-'));
    try {
      const primary = new LocalArtifactBytesStore(new LocalArtifactStore(primaryRoot));
      const fallback = new LocalArtifactBytesStore(new LocalArtifactStore(fallbackRoot));
      const store = new FallbackArtifactBytesStore(primary, fallback);
      // Written directly into each tier, because `put` only writes the primary. A
      // delete that cleared only the primary would be correct *today* and would leave
      // the orphan in place the moment a write fell back to the secondary — so both
      // tiers are seeded here and the assertion is about the delete.
      await primary.put('runs/run-1/current.json', new TextEncoder().encode('current'));
      await fallback.put('runs/run-1/legacy.json', new TextEncoder().encode('legacy'));

      await store.delete('runs/run-1/current.json');
      await store.delete('runs/run-1/legacy.json');

      expect(await primary.get('runs/run-1/current.json')).toBeNull();
      expect(await fallback.get('runs/run-1/legacy.json')).toBeNull();
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
      await rm(fallbackRoot, { recursive: true, force: true });
    }
  });
});
