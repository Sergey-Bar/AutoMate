import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { secureCookiePolicy } from './secure-cookies.js';

async function decide(
  policy: ReturnType<typeof secureCookiePolicy>,
  headers: Record<string, string> = {},
): Promise<boolean> {
  let answer = false;
  const app = new Hono().get('/', (context) => {
    answer = typeof policy === 'boolean' ? policy : policy(context);
    return context.text('ok');
  });
  await app.request('/', { headers });
  return answer;
}

describe('secureCookiePolicy', () => {
  it('lets an explicit COOKIE_SECURE win in both directions', async () => {
    expect(await decide(secureCookiePolicy({ explicit: 'true', publicAppUrl: 'http://x' }))).toBe(
      true,
    );
    expect(
      await decide(
        secureCookiePolicy({ explicit: 'no', publicAppUrl: 'https://x', trustProxy: true }),
        { 'x-forwarded-proto': 'https' },
      ),
    ).toBe(false);
  });

  it('is Secure for an https public URL whatever the request says', async () => {
    expect(await decide(secureCookiePolicy({ publicAppUrl: 'https://automate.local' }))).toBe(true);
  });

  it('follows how the request arrived when the proxy is trusted', async () => {
    // The LAN install: PUBLIC_APP_URL may still say http://localhost, and the edge
    // terminates TLS. The cookie a browser gets over https must be Secure.
    const policy = secureCookiePolicy({ publicAppUrl: 'http://localhost:8080', trustProxy: true });
    expect(await decide(policy, { 'x-forwarded-proto': 'https' })).toBe(true);
    expect(await decide(policy, { 'x-forwarded-proto': 'http' })).toBe(false);
  });

  it('ignores a forwarded scheme nobody vouches for', async () => {
    const policy = secureCookiePolicy({ publicAppUrl: 'http://localhost:8080', trustProxy: false });
    expect(await decide(policy, { 'x-forwarded-proto': 'https' })).toBe(false);
  });
});
