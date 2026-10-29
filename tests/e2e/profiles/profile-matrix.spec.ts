import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  expect,
  request as factory,
  test,
  type APIRequestContext,
  type APIResponse,
} from '@playwright/test';
import { COOKIE_SECRET, INSTALLATION_KEY, PROFILE_API_PORT } from '../support/config.js';
import { bootRefusal, startApi } from '../support/processes.js';

/**
 * The four deployment profiles (ADR-014), each booted from the API's own entry point against
 * this suite's PostgreSQL: what each one serves, and what each one refuses to start with.
 *
 * Every other spec runs the one `solo` API `playwright.config.ts` starts, so the profiles'
 * differences were proven only in-process — the refusals against a parsed config, several
 * workspaces against PGlite — and never through a boot, the HTTP edge and a real database
 * together. This is plan task 19.
 *
 * One profile at a time, on {@link PROFILE_API_PORT}, beside the suite's own server. Every
 * profile shares the suite's installation key and cookie secret, because they all read the one
 * installation row of one database.
 *
 * `pr-blocking` since four consecutive passing runs on main (`scripts/gate-tooling.json`).
 */

const DATABASE_URL = process.env['DATABASE_URL']?.trim() ?? '';

/** What every profile is booted with, plus `extra`. */
function environment(extra: Record<string, string>): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: String(PROFILE_API_PORT),
    DATABASE_URL,
    COOKIE_SECRET,
    AUTOMATE_API_KEY: INSTALLATION_KEY,
    ...extra,
  };
}

/**
 * An OIDC client for the enterprise profile to enforce. Discovery waits for the first sign-in,
 * so the issuer, a loopback port nothing listens on, is never contacted. The secret is made
 * here rather than written down.
 */
const OIDC = {
  OIDC_ISSUER: 'http://127.0.0.1:9',
  OIDC_CLIENT_ID: 'automate-profile-matrix',
  OIDC_CLIENT_SECRET: randomUUID(),
  OIDC_ALLOWED_DOMAINS: 'example.com',
};

/** Boots one profile, hands `use` a client for it, and stops it whatever happens. */
async function withProfile(
  label: string,
  extra: Record<string, string>,
  use: (api: APIRequestContext) => Promise<void>,
): Promise<void> {
  const server = await startApi(environment(extra));
  const api = await factory.newContext({ baseURL: server.url, extraHTTPHeaders: {} });
  try {
    await use(api);
  } finally {
    await api.dispose();
    await server.stop();
    // The API's own log, beside the result: what a failure on the runner is read from.
    const log = test.info().outputPath(`apps-api-${label.replaceAll(/[^a-z]+/gu, '-')}.log`);
    await writeFile(log, server.output());
    await test.info().attach(`apps-api (${label})`, { path: log, contentType: 'text/plain' });
  }
}

/** Boots `extra` expecting a refusal, and returns what the API said when it refused. */
async function refusalOf(extra: Record<string, string>): Promise<string> {
  const refused = await bootRefusal(environment(extra));
  expect(refused.code, `the API should exit non-zero:\n${refused.output}`).not.toBe(0);
  return refused.output;
}

async function json<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}

/** The stable `code` an error response carries. */
async function codeOf(response: APIResponse): Promise<string | undefined> {
  return (await json<{ error?: { code?: string } }>(response)).error?.code;
}

interface Whoami {
  role: string | null;
  mode: 'open' | 'enforced';
  profile: string;
  source: string;
  workspace: string;
}

const whoami = async (api: APIRequestContext): Promise<Whoami> =>
  json<Whoami>(await api.get('/api/v1/auth/whoami'));

const signIn = (api: APIRequestContext, apiKey: string = INSTALLATION_KEY) =>
  api.post('/api/v1/auth/login', { data: { apiKey } });

const workspaceId = (): string => `profile-matrix-${randomUUID().slice(0, 8)}`;

const createWorkspace = (api: APIRequestContext, id: string) =>
  api.post('/api/v1/workspaces', { data: { id, name: 'Profile matrix' } });

test.beforeAll(() => {
  expect(DATABASE_URL, 'the profile matrix boots against PostgreSQL: set DATABASE_URL').not.toBe(
    '',
  );
});

test('solo: open on this machine, one workspace, and no LAN mode', async () => {
  await withProfile('solo', { AUTOMATE_PROFILE: 'solo' }, async (api) => {
    expect(await whoami(api)).toMatchObject({ profile: 'solo', mode: 'open', role: 'admin' });
    const created = await createWorkspace(api, workspaceId());
    expect(created.status()).toBe(409);
    expect(await codeOf(created)).toBe('WORKSPACES_NEED_TEAM');
  });
  expect(await refusalOf({ AUTOMATE_PROFILE: 'solo', AUTOMATE_LAN_MODE: '1' })).toContain(
    'AUTOMATE_PROFILE=solo keeps Automate on this machine',
  );
});

test('startup: a sign-in in front of everything, and still one workspace', async () => {
  await withProfile('startup', { AUTOMATE_PROFILE: 'startup' }, async (api) => {
    expect(await whoami(api)).toMatchObject({ profile: 'startup', mode: 'enforced', role: null });
    expect((await api.get('/api/v1/workspaces')).status()).toBe(401);
    expect((await signIn(api)).status()).toBe(200);
    expect(await whoami(api)).toMatchObject({ role: 'admin', source: 'installation' });
    const created = await createWorkspace(api, workspaceId());
    expect(created.status()).toBe(409);
    expect(await codeOf(created)).toBe('WORKSPACES_NEED_TEAM');
  });
});

test('team: several workspaces, each served by its own composition, and never open', async () => {
  const id = workspaceId();
  await withProfile('team', { AUTOMATE_PROFILE: 'team' }, async (api) => {
    expect((await signIn(api)).status()).toBe(200);
    expect((await createWorkspace(api, id)).status()).toBe(201);
    const listed = await json<{ workspaces: Array<{ id: string }> }>(
      await api.get('/api/v1/workspaces'),
    );
    expect(listed.workspaces.map((workspace) => workspace.id)).toContain(id);
    // Choosing it sends every later request to that workspace's composition, which answers
    // for itself, and whose audit trail starts with its own creation.
    const chosen = await api.post('/api/v1/workspaces/select', { data: { workspaceId: id } });
    expect(chosen.status()).toBe(200);
    expect(await whoami(api)).toMatchObject({ workspace: id, role: 'admin' });
    expect(await json(await api.get('/api/v1/audit/verify'))).toMatchObject({
      intact: true,
      breaks: [],
    });
  });
  expect(await refusalOf({ AUTOMATE_PROFILE: 'team', ACCESS_CONTROL: 'open' })).toContain(
    'AUTOMATE_PROFILE=team serves several people and ACCESS_CONTROL=open',
  );
});

test('enterprise: single sign-on or nothing, and break-glass leaves a trace', async () => {
  expect(await refusalOf({ AUTOMATE_PROFILE: 'enterprise' })).toContain(
    'AUTH_SSO_ENFORCED is on (the enterprise profile turns it on)',
  );
  await withProfile('enterprise', { AUTOMATE_PROFILE: 'enterprise', ...OIDC }, async (api) => {
    expect(await json(await api.get('/api/v1/features'))).toMatchObject({
      profile: 'enterprise',
      signIn: { oidc: true },
    });
    const refused = await signIn(api);
    expect(refused.status()).toBe(403);
    expect(await codeOf(refused)).toBe('SSO_ENFORCED');
    expect(refused.headers()['set-cookie']).toBeUndefined();
    // Checked after the key, so the enforcement tells nothing to a caller without it.
    const wrong = await signIn(api, 'x'.repeat(32));
    expect(wrong.status()).toBe(401);
    expect(await codeOf(wrong)).toBe('INVALID_CREDENTIALS');
  });
  await withProfile(
    'enterprise, break-glass',
    { AUTOMATE_PROFILE: 'enterprise', ...OIDC, AUTOMATE_BREAK_GLASS: '1' },
    async (api) => {
      expect((await signIn(api)).status()).toBe(200);
      await expect
        .poll(
          async () =>
            (
              await json<{ events: unknown[] }>(
                await api.get('/api/v1/audit?action=auth.break-glass'),
              )
            ).events.length,
          { timeout: 15_000 },
        )
        .toBeGreaterThan(0);
      expect(await json(await api.get('/api/v1/audit/verify'))).toMatchObject({
        intact: true,
        breaks: [],
      });
    },
  );
});
