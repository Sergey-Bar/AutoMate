import { afterEach, describe, expect, it, vi } from 'vitest';
import { whatsappAdapter } from './index.js';

type Reply = { status: number; body: unknown } | Error;

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

const send = {
  operation: 'sendTemplate',
  input: {
    phoneNumberId: '1234567890',
    to: '15551234567',
    template: 'automate_report',
    language: 'en',
    text: '🟢 Weekly quality report',
  },
};

describe('whatsapp adapter', () => {
  it('sends the report as the body parameter of an approved template', async () => {
    const calls = stubFetch([{ status: 200, body: { messages: [{ id: 'wamid.1' }] } }]);
    const result = await whatsappAdapter.execute(send, 'EAAG-token');
    expect(result).toMatchObject({ status: 'ok', attempts: 1 });
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v23.0/1234567890/messages');
    expect((calls[0]?.init?.headers as Record<string, string>)['authorization']).toBe(
      'Bearer EAAG-token',
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      messaging_product: 'whatsapp',
      to: '15551234567',
      type: 'template',
      template: {
        name: 'automate_report',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '🟢 Weekly quality report' }] },
        ],
      },
    });
  });

  it('checks the number with a GET, on a chosen API version', async () => {
    const calls = stubFetch([{ status: 200, body: { id: '1234567890' } }]);
    const result = await whatsappAdapter.execute(
      { operation: 'phoneNumber', input: { phoneNumberId: '1234567890', apiVersion: 'v24.0' } },
      't',
    );
    expect(result.status).toBe('ok');
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v24.0/1234567890');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.init?.body).toBeUndefined();
  });

  it('retries a rate-limit error, which sent nothing', async () => {
    const calls = stubFetch([
      { status: 400, body: { error: { code: 131056, message: 'pair rate limit' } } },
      { status: 200, body: { messages: [] } },
    ]);
    expect(await whatsappAdapter.execute(send, 't')).toMatchObject({ status: 'ok', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('treats an unapproved template or a bad token as final', async () => {
    stubFetch([
      { status: 400, body: { error: { code: 132001, message: 'template does not exist' } } },
    ]);
    expect((await whatsappAdapter.execute(send, 't')).error).toMatchObject({
      code: 'whatsapp_rejected_400',
      retryable: false,
    });
  });

  it('does not retry a 5xx on a send', async () => {
    const calls = stubFetch([{ status: 500, body: { error: { code: 1 } } }]);
    expect((await whatsappAdapter.execute(send, 't')).error?.code).toBe('whatsapp_500');
    expect(calls).toHaveLength(1);
  });

  it('reports an error body that arrives with a 200, and a malformed 200, as errors', async () => {
    stubFetch([{ status: 200, body: { error: { code: 100 } } }]);
    expect((await whatsappAdapter.execute(send, 't')).status).toBe('error');
    stubFetch([{ status: 200, body: undefined }]);
    expect((await whatsappAdapter.execute(send, 't')).error?.code).toBe('whatsapp_200');
    stubFetch([{ status: 400, body: { error: 'flat' } }]);
    expect((await whatsappAdapter.execute(send, 't')).error?.code).toBe('whatsapp_rejected_400');
  });

  it('refuses bad input before any request', async () => {
    const calls = stubFetch([{ status: 200, body: {} }]);
    const cases = [
      { ...send.input, phoneNumberId: '12/../34' },
      { ...send.input, apiVersion: 'latest' },
      { ...send.input, text: '' },
    ];
    for (const input of cases) {
      expect(
        (await whatsappAdapter.execute({ operation: 'sendTemplate', input }, 't')).error?.code,
      ).toBe('whatsapp_invalid_input');
    }
    expect(
      (await whatsappAdapter.execute({ operation: 'sendTemplate', input: null }, 't')).error?.code,
    ).toBe('whatsapp_invalid_input');
    expect(calls).toHaveLength(0);
  });

  it('reports a transport failure without the token', async () => {
    stubFetch([new TypeError('fetch failed')]);
    const result = await whatsappAdapter.execute(send, 'EAAG-secret');
    expect(result.error?.code).toBe('whatsapp_transport_failed');
    expect(JSON.stringify(result)).not.toContain('EAAG-secret');
  });
});
