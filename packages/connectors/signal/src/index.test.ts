import { afterEach, describe, expect, it, vi } from 'vitest';
import { signalAdapter } from './index.js';

type Reply = { status: number; body?: unknown } | Error;

function stubFetch(replies: Reply[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  let index = 0;
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = replies[Math.min(index, replies.length - 1)] as Reply;
    index += 1;
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: () =>
        next.body === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(next.body),
    });
  });
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const BRIDGE = 'http://192.168.1.10:8081';
const send = {
  operation: 'send',
  input: { number: '+15550001111', recipients: '+15550002222, group.abc==', message: '🟢 ok' },
};

describe('signal adapter', () => {
  it('sends through the bridge on the LAN, splitting the recipients', async () => {
    const calls = stubFetch([{ status: 201, body: { timestamp: '1729850000000' } }]);
    const result = await signalAdapter.execute(send, `${BRIDGE}/`);
    expect(result).toEqual({ status: 'ok', data: { timestamp: '1729850000000' }, attempts: 1 });
    expect(calls[0]?.url).toBe('http://192.168.1.10:8081/v2/send');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      number: '+15550001111',
      recipients: ['+15550002222', 'group.abc=='],
      message: '🟢 ok',
    });
  });

  it('checks the bridge with /v1/about, and accepts an empty body', async () => {
    const calls = stubFetch([{ status: 200 }]);
    const result = await signalAdapter.execute({ operation: 'about', input: {} }, BRIDGE);
    expect(result).toEqual({ status: 'ok', data: {}, attempts: 1 });
    expect(calls[0]?.init?.method).toBe('GET');
  });

  it('retries a 429 the bridge refused, and not a 500 after a send', async () => {
    const limited = stubFetch([
      { status: 429, body: {} },
      { status: 201, body: {} },
    ]);
    expect(await signalAdapter.execute(send, BRIDGE)).toMatchObject({ status: 'ok', attempts: 2 });
    expect(limited).toHaveLength(2);
    const failed = stubFetch([{ status: 500, body: {} }]);
    expect((await signalAdapter.execute(send, BRIDGE)).error?.code).toBe('signal_500');
    expect(failed).toHaveLength(1);
  });

  it('treats an unregistered account as final', async () => {
    stubFetch([{ status: 400, body: { error: 'User is not registered' } }]);
    expect((await signalAdapter.execute(send, BRIDGE)).error).toMatchObject({
      code: 'signal_rejected_400',
      retryable: false,
    });
  });

  it('refuses a bridge that is not http(s), carries credentials, or is not a URL', async () => {
    const calls = stubFetch([{ status: 201, body: {} }]);
    for (const secret of ['ftp://x', 'http://u:p@x', 'nowhere']) {
      expect((await signalAdapter.execute(send, secret)).error?.code).toBe('signal_invalid_bridge');
    }
    expect(
      (
        await signalAdapter.execute(
          { operation: 'send', input: { number: '+1', recipients: '+2' } },
          BRIDGE,
        )
      ).error?.code,
    ).toBe('signal_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('reports a bridge that is down as a transport failure', async () => {
    stubFetch([new TypeError('connect ECONNREFUSED')]);
    expect((await signalAdapter.execute(send, BRIDGE)).error?.code).toBe('signal_transport_failed');
  });
});
