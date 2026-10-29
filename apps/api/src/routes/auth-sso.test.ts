import { describe, expect, it, vi } from 'vitest';
import { hashCredential } from '@automate/auth';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import {
  syntheticCookieSecret,
  syntheticInstallationKey,
} from '../test-support/synthetic-credentials.js';
import { createAuthRoutes, memoryBackend } from './auth.js';

/**
 * Enforced single sign-on (ADR-014, enterprise): a browser signs in through the identity
 * provider, and the installation key signs one in only under break-glass, which is reported
 * every time it is used.
 */
const COOKIE_SECRET = syntheticCookieSecret();
const KEY = syntheticInstallationKey();

function app(sso: { enforced: boolean; breakGlass: boolean }, onBreakGlass = vi.fn()) {
  return {
    onBreakGlass,
    app: withErrorBoundary(
      createAuthRoutes({
        cookieSecret: COOKIE_SECRET,
        installationId: '00000000-0000-4000-8000-000000000001',
        installationKeyHash: hashCredential(COOKIE_SECRET, KEY),
        sessionTtlMs: 60_000,
        secureCookies: false,
        sso: { ...sso, onBreakGlass },
      }),
    ),
  };
}

const login = (target: ReturnType<typeof app>['app'], apiKey = KEY) =>
  target.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });

describe('the installation key under enforced single sign-on', () => {
  it('is refused, with a code that names the reason, and no session is issued', async () => {
    const { app: target, onBreakGlass } = app({ enforced: true, breakGlass: false });
    const response = await login(target);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SSO_ENFORCED',
    );
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(onBreakGlass).not.toHaveBeenCalled();
  });

  it('works under break-glass, and every use is reported', async () => {
    const { app: target, onBreakGlass } = app({ enforced: true, breakGlass: true });
    const response = await login(target);
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(/automate_session=/u);
    expect(onBreakGlass).toHaveBeenCalledTimes(1);
    // A wrong key under break-glass is still a wrong key, and is not reported as a use.
    expect((await login(target, `${KEY}x`)).status).toBe(401);
    expect(onBreakGlass).toHaveBeenCalledTimes(1);
  });

  it('works as before when SSO is not enforced', async () => {
    const { app: target, onBreakGlass } = app({ enforced: false, breakGlass: false });
    expect((await login(target)).status).toBe(200);
    expect(onBreakGlass).not.toHaveBeenCalled();
  });

  it('does not report an installation session that no longer counts (PRO-19)', async () => {
    // A browser that signed in with the key before SSO was enforced, or under a break-glass
    // since switched off, still holds the cookie. `callerOf` ignores it, so the session route
    // must not tell the web app it is signed in.
    const backend = memoryBackend(COOKIE_SECRET, 60_000);
    const routes = (sso: { enforced: boolean; breakGlass: boolean }) =>
      withErrorBoundary(
        createAuthRoutes({
          cookieSecret: COOKIE_SECRET,
          installationId: '00000000-0000-4000-8000-000000000001',
          installationKeyHash: hashCredential(COOKIE_SECRET, KEY),
          sessionTtlMs: 60_000,
          secureCookies: false,
          sessionBackend: backend,
          sso: { ...sso, onBreakGlass: vi.fn() },
        }),
      );
    const signedIn = await login(routes({ enforced: true, breakGlass: true }));
    const cookie = (signedIn.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const session = (target: ReturnType<typeof routes>) =>
      target.request('/api/v1/auth/session', { headers: { cookie } });
    expect((await session(routes({ enforced: true, breakGlass: true }))).status).toBe(200);
    expect((await session(routes({ enforced: false, breakGlass: false }))).status).toBe(200);
    const refused = await session(routes({ enforced: true, breakGlass: false }));
    expect(refused.status).toBe(401);
  });
});
