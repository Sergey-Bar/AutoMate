import { afterEach, describe, expect, it, vi } from 'vitest';
import { telegramAdapter } from './index.js';

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

const send = { operation: 'sendMessage', input: { chatId: '-1001', text: '<b>🟢 ok</b>' } };

describe('telegram adapter', () => {
  it('sends HTML to the chat through the bot token in the path', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true, result: { message_id: 7 } } }]);
    const result = await telegramAdapter.execute(send, '123:abc');
    expect(result).toEqual({ status: 'ok', data: { message_id: 7 }, attempts: 1 });
    expect(calls[0]?.url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      chat_id: '-1001',
      text: '<b>🟢 ok</b>',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
  });

  it('checks the token with getMe', async () => {
    stubFetch([{ status: 200, body: { ok: true, result: { username: 'automate_bot' } } }]);
    const result = await telegramAdapter.execute({ operation: 'getMe', input: {} }, 't');
    expect(result.data).toEqual({ username: 'automate_bot' });
  });

  it('retries a rate-limit refusal, which sent nothing, even though sending is not idempotent', async () => {
    const calls = stubFetch([
      { status: 429, body: { ok: false, error_code: 429, parameters: { retry_after: 1 } } },
      { status: 200, body: { ok: true, result: {} } },
    ]);
    const result = await telegramAdapter.execute(send, 't');
    expect(result).toMatchObject({ status: 'ok', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('does not retry a 502 with no answer on a send, which may already have been delivered', async () => {
    const calls = stubFetch([
      { status: 502, body: undefined },
      { status: 200, body: { ok: true } },
    ]);
    const result = await telegramAdapter.execute(send, 't');
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ status: 'error', attempts: 1, error: { code: 'telegram_502' } });
  });

  it('reports a malformed 200 as an error, not a delivery, and does not retry the send', async () => {
    const calls = stubFetch([{ status: 200, body: 'ok' }]);
    const result = await telegramAdapter.execute(send, 't');
    expect(result.status).toBe('error');
    expect(result.error).toMatchObject({ code: 'telegram_200', retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('treats a bad token or chat as final', async () => {
    stubFetch([{ status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } }]);
    const result = await telegramAdapter.execute(send, 't');
    expect(result.error).toEqual({
      code: 'telegram_rejected_401',
      retryable: false,
      message: 'Telegram operation failed',
    });
  });

  it('reads a refusal that arrives with HTTP 200 by its body', async () => {
    stubFetch([{ status: 200, body: { ok: false } }]);
    expect((await telegramAdapter.execute(send, 't')).error?.code).toBe('telegram_rejected_400');
    stubFetch([{ status: 409, body: { ok: false, error_code: 'conflict' } }]);
    expect((await telegramAdapter.execute(send, 't')).error?.code).toBe('telegram_rejected_409');
  });

  it('refuses missing input and an unknown operation before any request', async () => {
    const calls = stubFetch([{ status: 200, body: { ok: true } }]);
    const missing = await telegramAdapter.execute(
      { operation: 'sendMessage', input: { chatId: '1' } },
      't',
    );
    expect(missing.error?.code).toBe('telegram_invalid_input');
    const unknown = await telegramAdapter.execute({ operation: 'sendPhoto', input: {} }, 't');
    expect(unknown.error?.code).toBe('telegram_unknown_operation');
    expect(calls).toHaveLength(0);
  });

  it('never puts the token in an error, even when the transport fails', async () => {
    stubFetch([new TypeError('fetch failed for https://api.telegram.org/botSECRET/sendMessage')]);
    const result = await telegramAdapter.execute(send, 'SECRET');
    expect(result.error?.code).toBe('telegram_transport_failed');
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('reports an unreadable body on an error status by that status', async () => {
    stubFetch([{ status: 503, body: undefined }]);
    const result = await telegramAdapter.execute({ operation: 'getMe', input: {} }, 't');
    expect(result.error).toMatchObject({ code: 'telegram_503', retryable: true });
    expect(result.attempts).toBe(3);
  });
});
