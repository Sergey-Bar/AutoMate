import { describe, expect, it, vi } from 'vitest';
import { RunnerClient } from './client.js';
import { EncryptedSpool } from './spool.js';

describe('RunnerClient', () => {
  it('uses the one-time enrollment and scoped sync endpoints', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ credential: 'credential', runnerId: 'runner-1' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ jobs: [] }), { status: 200 }));
    const client = new RunnerClient({
      baseUrl: 'http://localhost:3000',
      credential: 'credential',
      fetchImpl: fetcher,
    });
    await expect(client.enroll('enrollment')).resolves.toEqual({
      credential: 'credential',
      runnerId: 'runner-1',
    });
    await client.sync({ runnerId: 'runner-1' });
    expect(fetcher).toHaveBeenLastCalledWith(
      'http://localhost:3000/api/v1/runner/v1/sync',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer credential' }),
      }),
    );
  });

  it('surfaces enrollment and sync failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 401 }));
    const client = new RunnerClient({
      baseUrl: 'http://localhost:3000',
      credential: 'bad',
      fetchImpl: fetcher,
    });
    await expect(client.enroll('bad')).rejects.toThrow('401');
    await expect(client.sync({})).rejects.toThrow('401');
  });
});

describe('EncryptedSpool', () => {
  it('round trips records and rejects a different key', () => {
    const key = Buffer.alloc(32, 7);
    const spool = new EncryptedSpool(key);
    const sealed = spool.seal({ sequence: 1, payload: { status: 'succeeded' } });
    expect(spool.open(sealed)).toEqual({ sequence: 1, payload: { status: 'succeeded' } });
    expect(() => new EncryptedSpool(Buffer.alloc(32, 8)).open(sealed)).toThrow();
  });
});
