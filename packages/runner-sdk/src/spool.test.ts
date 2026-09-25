import { mkdtemp, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DurableSpool,
  EncryptedSpool,
  MemorySpool,
  SpoolCapacityError,
  SpoolError,
  SpoolIntegrityError,
  SpoolPathError,
  readOrCreateSpoolKey,
  type SpoolEntry,
} from './spool.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function directory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'runner-spool-'));
  roots.push(root);
  return root;
}

function entry(id: string, sequence: number, jobId = 'job-1'): SpoolEntry {
  return {
    id,
    jobId,
    kind: 'event',
    sequence,
    leaseId: 'lease-secret',
    fencingToken: 3,
    payload: { id, sequence, note: 'plaintext-marker' },
  };
}

describe('DurableSpool', () => {
  it('replays sealed entries in order after a restart and compacts acknowledged entries', async () => {
    const root = await directory();
    const first = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    await first.enqueue(entry('a', 1));
    await first.enqueue(entry('b', 2));
    expect(first.pending()).toBe(2);
    expect(first.lastSequence('job-1')).toBe(2);
    expect(first.lastSequence('job-2')).toBe(0);

    const raw = await readFile(join(root, 'events.spool'));
    expect(raw.includes(Buffer.from('lease-secret'))).toBe(false);
    expect(raw.includes(Buffer.from('plaintext-marker'))).toBe(false);

    const second = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    expect((await second.peek()).map((item) => item.id)).toEqual(['a', 'b']);
    expect((await second.peek(1)).map((item) => item.id)).toEqual(['a']);

    await second.ack(['a']);
    await second.ack(['missing']);
    const third = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    expect((await third.peek()).map((item) => item.id)).toEqual(['b']);
    expect(third.pending()).toBe(1);
    expect(third.lastSequence('job-1')).toBe(2);
  });

  it('persists acknowledgements as tombstones until compaction', async () => {
    const root = await directory();
    const spool = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    await spool.enqueue(entry('a', 1));
    await spool.enqueue(entry('b', 2));
    await spool.ack(['a']);
    const restarted = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    expect(restarted.pending()).toBe(1);
    expect((await restarted.peek())[0]?.id).toBe('b');
  });

  it('keeps the sequence high-water mark after every entry is acknowledged', async () => {
    const root = await directory();
    const spool = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    await spool.enqueue(entry('a', 7));
    await spool.ack(['a']);
    const restarted = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    expect(restarted.pending()).toBe(0);
    expect(restarted.lastSequence('job-1')).toBe(7);
  });

  it('fails closed when the key does not match the sealed queue', async () => {
    const root = await directory();
    const spool = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    await spool.enqueue(entry('a', 1));
    const drained = await directory();
    const empty = await DurableSpool.open({ directory: drained, key: 'stable-runner-key' });
    await empty.enqueue(entry('b', 1));
    await empty.ack(['b']);

    const failure = await DurableSpool.open({ directory: root, key: 'other-runner-key' }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SpoolIntegrityError);
    expect((failure as SpoolIntegrityError).code).toBe('SPOOL_WRONG_KEY');

    const emptyFailure = await DurableSpool.open({
      directory: drained,
      key: 'other-runner-key',
    }).catch((error: unknown) => error);
    expect(emptyFailure).toBeInstanceOf(SpoolIntegrityError);
    expect((emptyFailure as SpoolIntegrityError).code).toBe('SPOOL_WRONG_KEY');
  });

  it('fails closed on tampered frames and unknown spool files', async () => {
    const root = await directory();
    const path = join(root, 'events.spool');
    const spool = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    await spool.enqueue(entry('a', 1));
    const raw = await readFile(path);
    const tampered = Buffer.from(raw);
    tampered[tampered.length - 1] = tampered[tampered.length - 1] ^ 0xff;
    await writeFile(path, tampered);

    const failure = await DurableSpool.open({ directory: root, key: 'stable-runner-key' }).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(SpoolIntegrityError);
    expect((failure as SpoolIntegrityError).code).toBe('SPOOL_TAMPERED');

    await writeFile(path, Buffer.from('not a runner spool file at all'));
    const format = await DurableSpool.open({ directory: root, key: 'stable-runner-key' }).catch(
      (error: unknown) => error,
    );
    expect((format as SpoolIntegrityError).code).toBe('SPOOL_FORMAT');
  });

  it('fails closed on truncated frames unless a torn tail is explicitly dropped', async () => {
    const root = await directory();
    const path = join(root, 'events.spool');
    const spool = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    await spool.enqueue(entry('a', 1));
    await spool.enqueue(entry('b', 2));
    const raw = await readFile(path);
    await truncate(path, raw.length - 4);

    const failure = await DurableSpool.open({ directory: root, key: 'stable-runner-key' }).catch(
      (error: unknown) => error,
    );
    expect((failure as SpoolIntegrityError).code).toBe('SPOOL_TRUNCATED');

    const repaired = await DurableSpool.open({
      directory: root,
      key: 'stable-runner-key',
      tornTail: 'drop',
    });
    expect((await repaired.peek()).map((item) => item.id)).toEqual(['a']);
    await repaired.enqueue(entry('c', 3));

    const reopened = await DurableSpool.open({ directory: root, key: 'stable-runner-key' });
    expect((await reopened.peek()).map((item) => item.id)).toEqual(['a', 'c']);
  });

  it('fails closed on a short tail and an out-of-range frame length', async () => {
    const root = await directory();
    const path = join(root, 'events.spool');
    const header = Buffer.concat([
      Buffer.from('automate-runner-spool/v1\n', 'utf8'),
      Buffer.from(new EncryptedSpool('stable-runner-key').keyId(), 'utf8'),
    ]);
    await writeFile(path, Buffer.concat([header, Buffer.alloc(10, 7)]));
    const short = await DurableSpool.open({ directory: root, key: 'stable-runner-key' }).catch(
      (error: unknown) => error,
    );
    expect((short as SpoolIntegrityError).code).toBe('SPOOL_TRUNCATED');
    const dropped = await DurableSpool.open({
      directory: root,
      key: 'stable-runner-key',
      tornTail: 'drop',
    });
    expect(dropped.pending()).toBe(0);

    const oversized = Buffer.alloc(4);
    oversized.writeUInt32BE(0xffffffff);
    await writeFile(path, Buffer.concat([header, oversized, Buffer.alloc(40, 3)]));
    const range = await DurableSpool.open({ directory: root, key: 'stable-runner-key' }).catch(
      (error: unknown) => error,
    );
    expect((range as SpoolIntegrityError).code).toBe('SPOOL_FORMAT');
  });

  it('rejects frames that are not queue entries', async () => {
    const root = await directory();
    const path = join(root, 'events.spool');
    const codec = new EncryptedSpool('stable-runner-key');
    const sealed = codec.seal({ sequence: 'one' });
    const length = Buffer.alloc(4);
    length.writeUInt32BE(sealed.length);
    const header = Buffer.concat([
      Buffer.from('automate-runner-spool/v1\n', 'utf8'),
      Buffer.from(codec.keyId(), 'utf8'),
    ]);
    await writeFile(path, Buffer.concat([header, length, sealed]));

    const failure = await DurableSpool.open({ directory: root, key: 'stable-runner-key' }).catch(
      (error: unknown) => error,
    );
    expect((failure as SpoolIntegrityError).code).toBe('SPOOL_FORMAT');
  });

  it('enforces entry, byte, and path bounds', async () => {
    const root = await directory();
    const spool = await DurableSpool.open({
      directory: root,
      key: 'stable-runner-key',
      maxEntries: 1,
      maxBytes: 512,
    });
    await spool.enqueue(entry('a', 1));
    await expect(spool.enqueue(entry('b', 2))).rejects.toBeInstanceOf(SpoolCapacityError);
    const compact = await DurableSpool.open({
      directory: root,
      key: 'stable-runner-key',
      maxBytes: 512,
    });
    await expect(compact.enqueue({ ...entry('c', 2), payload: 'x'.repeat(2_000) })).rejects
      .toBeInstanceOf(SpoolCapacityError);
    await expect(
      DurableSpool.open({ directory: root, key: 'stable-runner-key', name: '../escape.spool' }),
    ).rejects.toBeInstanceOf(SpoolPathError);
    await expect(
      DurableSpool.open({ directory: root, key: 'stable-runner-key', name: 'nested/queue.spool' }),
    ).rejects.toBeInstanceOf(SpoolPathError);
    await expect(
      DurableSpool.open({ directory: root, key: 'stable-runner-key', name: 'C:\\escape.spool' }),
    ).rejects.toBeInstanceOf(SpoolPathError);
    await expect(
      DurableSpool.open({ directory: root, key: 'stable-runner-key', maxEntries: 0 }),
    ).rejects.toThrow();
  });
});

describe('MemorySpool', () => {
  it('keeps FIFO order, drops acknowledged entries, and honours the bound', async () => {
    const spool = new MemorySpool(2);
    await spool.enqueue(entry('a', 1));
    await spool.enqueue(entry('b', 2, 'job-2'));
    expect(spool.lastSequence('job-2')).toBe(2);
    expect((await spool.peek()).map((item) => item.id)).toEqual(['a', 'b']);
    await spool.ack(['a', 'b']);
    expect(spool.lastSequence('job-2')).toBe(2);
    expect(spool.pending()).toBe(0);
    await spool.compact();
    await spool.enqueue(entry('c', 1));
    await spool.enqueue(entry('d', 2));
    await expect(spool.enqueue(entry('e', 3))).rejects.toBeInstanceOf(SpoolCapacityError);
  });
});

describe('readOrCreateSpoolKey', () => {
  it('creates a private key once and reuses it on later calls', async () => {
    const root = await directory();
    const path = join(root, 'spool.key');
    const created = await readOrCreateSpoolKey(path);
    expect(created).toMatch(/^[a-f0-9]{64}$/u);
    await expect(readOrCreateSpoolKey(path)).resolves.toBe(created);
    await writeFile(path, '   \n', 'utf8');
    await expect(readOrCreateSpoolKey(path)).rejects.toBeInstanceOf(SpoolError);
  });
});
