import { afterEach, describe, expect, it } from 'vitest';
import type { CallerResolver } from '../http/roles.js';
import {
  authenticateToken,
  createAccessToken,
  listAccessTokens,
  revokeAccessToken,
} from '../services/access-service.js';
import { withErrorBoundary } from '../test-support/error-boundary-app.js';
import { migratedDatabase } from '../test-support/migrated-database.js';
import { createAccessRoutes } from './access.js';

/**
 * Signing a browser in with an access token, in a install with several workspaces. The token
 * arrives in the body, which the workspace dispatch does not read, so the request is served by
 * the default workspace's routes whichever workspace issued the token.
 */
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup(ssoEnforced = false) {
  const { db, close } = await migratedDatabase();
  closers.push(close);
  const here = { db: db as never, workspaceId: 'ws-1' };
  const access: CallerResolver = {
    mode: 'enforced',
    ssoEnforced,
    authenticateToken: (token) => authenticateToken(here, token),
    hasSession: async () => false,
  };
  const app = withErrorBoundary(createAccessRoutes({ ...here, access }));
  const elsewhere = { db: db as never, workspaceId: 'ws-2' };
  const signIn = (token: string) =>
    app.request('/api/v1/auth/token-login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  return { here, elsewhere, signIn };
}

describe('the token sign-in', () => {
  it('signs a browser in with a token of any workspace, as that workspace’s caller', async () => {
    const { here, elsewhere, signIn } = await setup();
    const { token, summary } = await createAccessToken(
      elsewhere,
      { name: 'Ana', role: 'operator' },
      'session',
    );
    const response = await signIn(token);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actor: `token:${summary.id}`, role: 'operator' });
    expect(response.headers.get('set-cookie')).toMatch(/automate_token=amt_.*HttpOnly/iu);
    // Authenticated where it lives: its last use is recorded there, and nothing is made here.
    expect((await listAccessTokens(elsewhere))[0]?.lastUsedAt).not.toBeNull();
    expect(await listAccessTokens(here)).toEqual([]);
  });

  it('refuses a revoked token of another workspace, as any unknown one', async () => {
    const { elsewhere, signIn } = await setup();
    const { token, summary } = await createAccessToken(
      elsewhere,
      { name: 'Bo', role: 'viewer' },
      'session',
    );
    await revokeAccessToken(elsewhere, summary.id);
    const response = await signIn(token);
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('still refuses every workspace’s token under enforced single sign-on', async () => {
    const { elsewhere, signIn } = await setup(true);
    const { token } = await createAccessToken(elsewhere, { name: 'Cy', role: 'viewer' }, 'session');
    const response = await signIn(token);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SSO_ENFORCED',
    );
  });
});
