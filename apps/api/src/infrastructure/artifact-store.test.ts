import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FallbackArtifactBytesStore,
  LocalArtifactBytesStore,
  LocalArtifactStore,
  MAX_ARTIFACT_BYTES,
} from './artifact-store.js';
import { DEFAULT_MAX_ARTIFACT_BYTES } from './s3-artifact-bytes.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

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

describe('the live reader is bounded and verified, not the one nothing calls', () => {
  /**
   * `readAt` is what every production read goes through — `LocalArtifactBytesStore.get`
   * calls it, and `getArtifact` calls that. `read` verified a digest and had no caller
   * outside this file, so the check and the shipped method were the wrong way round.
   * Each case below names the method a real read reaches.
   */
  it('refuses a body above the cap and returns one within it', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      // A four-byte cap, so the assertion is about the check rather than about
      // allocating 64 MB. The default is pinned separately.
      const store = new LocalArtifactStore(root, 4);
      const within = new TextEncoder().encode('abcd');
      const over = new TextEncoder().encode('abcde');
      await store.putAt('runs/run-1/within.bin', within);
      await store.putAt('runs/run-1/over.bin', over);

      // The negative first: a reader that refused everything would satisfy the
      // refusal below without ever having read a file.
      expect(await store.readAt('runs/run-1/within.bin')).toEqual(within);
      await expect(store.readAt('runs/run-1/over.bin')).rejects.toThrow(/above the 4-byte/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses bytes whose digest is not the one the artifact row recorded', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const store = new LocalArtifactStore(root);
      const key = 'runs/run-1/report.json';
      const recorded = new TextEncoder().encode('{"passed":true}');
      await store.putAt(key, recorded);

      // The digest the row carries is the one `put` computed, so the mismatch below
      // is the one a real truncated or rewritten object produces.
      await expect(
        store.readAt(key, sha256(new TextEncoder().encode('{"passed":false}'))),
      ).rejects.toThrow(/digest/i);
      // And the match, so a reader that refused every digest cannot pass.
      expect(await store.readAt(key, sha256(recorded))).toEqual(recorded);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('defaults to the same cap the object store defaults to', () => {
    // Two stores, one number. If the local and object tiers disagree, the same
    // artifact is a stored object in one and a 503 in the other, and which tier a
    // read lands in depends on deployment rather than on the artifact.
    expect(MAX_ARTIFACT_BYTES).toBe(DEFAULT_MAX_ARTIFACT_BYTES);
    // And the number itself, so a shared constant cannot be quietly halved: an
    // artifact the upload body limiter accepts has to still be readable back.
    expect(MAX_ARTIFACT_BYTES).toBe(64 * 1024 * 1024);
    expect(new LocalArtifactStore('unused').maxBytes).toBe(MAX_ARTIFACT_BYTES);
  });

  it('carries the recorded digest through the byte-store port, not only through the store', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-'));
    try {
      const inner = new LocalArtifactStore(root);
      const store = new LocalArtifactBytesStore(inner);
      const key = 'runs/run-1/evidence.json';
      const recorded = new TextEncoder().encode('evidence');
      await store.put(key, recorded);

      // The port is what `getArtifact` holds, so a check that lives only on
      // `LocalArtifactStore` and is not carried through `get` is unreachable from
      // the read path — which is how the inverted arrangement survived.
      await expect(store.get(key, sha256(new TextEncoder().encode('tampered')))).rejects.toThrow(
        /digest/i,
      );
      expect(await store.get(key, sha256(recorded))).toEqual(recorded);
      // An absent key is still a miss, not a digest failure.
      expect(await store.get('runs/run-1/never-written', sha256(recorded))).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies the same digest policy in the fallback tier', async () => {
    const primaryRoot = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-primary-'));
    const fallbackRoot = await mkdtemp(path.join(tmpdir(), 'automate-artifacts-fallback-'));
    try {
      const primary = new LocalArtifactBytesStore(new LocalArtifactStore(primaryRoot));
      const fallback = new LocalArtifactBytesStore(new LocalArtifactStore(fallbackRoot));
      const store = new FallbackArtifactBytesStore(primary, fallback);
      const key = 'runs/run-1/legacy.json';
      const legacy = new TextEncoder().encode('legacy');
      await fallback.put(key, legacy);

      // The legacy tier is the one that is not written by this deployment, so it is
      // the tier a stale or truncated object is most likely to be in. A digest check
      // that only ran on the primary would be a check that only ran on the bytes this
      // process wrote.
      expect(await store.get(key, sha256(legacy))).toEqual(legacy);
      await expect(store.get(key, sha256(new TextEncoder().encode('other')))).rejects.toThrow(
        /digest/i,
      );
    } finally {
      await rm(primaryRoot, { recursive: true, force: true });
      await rm(fallbackRoot, { recursive: true, force: true });
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
