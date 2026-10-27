import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_COOKIE,
  createWorkspaceDispatch,
  resolveRequestWorkspace,
  type WorkspaceLookups,
} from './workspace-dispatch.js';

/**
 * Which workspace a request belongs to (ADR-014, team): read from a credential the server
 * trusts, never from the request alone. A token belongs to its own workspace; a runner's job
 * call to the job's; a person to a workspace they are a member of; the installation's own
 * admin to whichever workspace they choose. Anything else is the default.
 */
const DEFAULT = 'default-workspace';

function lookups(overrides: Partial<WorkspaceLookups> = {}): WorkspaceLookups {
  return {
    defaultWorkspace: DEFAULT,
    tokenWorkspace: vi.fn(async (token: string) => (token === 'amt_b' ? 'ws-b' : null)),
    jobWorkspace: vi.fn(async (jobId: string) => (jobId === 'job-b' ? 'ws-b' : null)),
    sessionUser: vi.fn(async () => null),
    memberships: vi.fn(async () => []),
    installationLevel: vi.fn(async () => false),
    workspaceExists: vi.fn(async (id: string) => ['ws-b', 'ws-c', DEFAULT].includes(id)),
    ...overrides,
  };
}

async function resolve(
  headers: Record<string, string>,
  overrides: Partial<WorkspaceLookups> = {},
  path = '/api/v1/runs',
): Promise<string> {
  const app = new Hono().get('*', async (context) =>
    context.text(await resolveRequestWorkspace(context, lookups(overrides))),
  );
  return (await app.request(path, { headers })).text();
}

describe('the request’s workspace', () => {
  it('is the default with no credential, whatever the request asks for', async () => {
    expect(await resolve({})).toBe(DEFAULT);
    expect(await resolve({ cookie: `${WORKSPACE_COOKIE}=ws-b` })).toBe(DEFAULT);
  });

  it('is a token’s own workspace, and a token cannot be pointed elsewhere', async () => {
    expect(await resolve({ authorization: 'Bearer amt_b' })).toBe('ws-b');
    expect(
      await resolve({ authorization: 'Bearer amt_b', cookie: `${WORKSPACE_COOKIE}=ws-c` }),
    ).toBe('ws-b');
    expect(await resolve({ cookie: 'automate_token=amt_b' })).toBe('ws-b');
    // An unknown token stays at the default, where it is refused as unknown.
    expect(await resolve({ authorization: 'Bearer amt_unknown' })).toBe(DEFAULT);
  });

  it('is a job’s workspace for a runner’s call about that job', async () => {
    expect(
      await resolve({ authorization: 'Bearer runner-token' }, {}, '/api/v1/jobs/job-b/complete'),
    ).toBe('ws-b');
    expect(
      await resolve({ authorization: 'Bearer runner-token' }, {}, '/api/v1/jobs/other/events'),
    ).toBe(DEFAULT);
  });

  it('is the workspace a person chose, only if they are a member of it', async () => {
    const person = {
      sessionUser: vi.fn(async () => 'u1'),
      memberships: vi.fn(async () => ['ws-b', DEFAULT]),
    };
    expect(await resolve({ cookie: `${WORKSPACE_COOKIE}=ws-b` }, person)).toBe('ws-b');
    // Not a member of ws-c: the choice is ignored, not honoured.
    expect(await resolve({ cookie: `${WORKSPACE_COOKIE}=ws-c` }, person)).toBe(DEFAULT);
  });

  it('is a person’s only workspace when they made no choice and are not in the default', async () => {
    expect(
      await resolve(
        {},
        { sessionUser: vi.fn(async () => 'u1'), memberships: vi.fn(async () => ['ws-c']) },
      ),
    ).toBe('ws-c');
  });

  it('is whichever existing workspace the installation’s admin chose', async () => {
    const admin = { installationLevel: vi.fn(async () => true) };
    expect(await resolve({ cookie: `${WORKSPACE_COOKIE}=ws-c` }, admin)).toBe('ws-c');
    expect(await resolve({ cookie: `${WORKSPACE_COOKIE}=nowhere` }, admin)).toBe(DEFAULT);
  });

  it('ignores a cookie that is not a workspace id', async () => {
    const admin = { installationLevel: vi.fn(async () => true) };
    expect(await resolve({ cookie: `${WORKSPACE_COOKIE}=..%2Fx` }, admin)).toBe(DEFAULT);
  });
});

describe('the dispatch', () => {
  it('serves the default workspace in place, and forwards any other to its own composition', async () => {
    const composed: string[] = [];
    const compose = (workspaceId: string) => {
      composed.push(workspaceId);
      return new Hono().get('/api/v1/runs', (context) => context.text(`runs of ${workspaceId}`));
    };
    const app = new Hono();
    app.use('*', createWorkspaceDispatch({ lookups: lookups(), compose }));
    app.get('/api/v1/runs', (context) => context.text('runs of the default'));
    const ask = async (headers: Record<string, string>) =>
      (await app.request('/api/v1/runs', { headers })).text();
    expect(await ask({})).toBe('runs of the default');
    expect(await ask({ authorization: 'Bearer amt_b' })).toBe('runs of ws-b');
    expect(await ask({ authorization: 'Bearer amt_b' })).toBe('runs of ws-b');
    // One composition per workspace, built once, and never one for the default.
    expect(composed).toEqual(['ws-b']);
  });

  it('forwards the request whole: method, path, query, headers and body', async () => {
    const seen: unknown[] = [];
    const compose = () =>
      new Hono().post('/api/v1/x', async (context) => {
        seen.push([
          context.req.method,
          context.req.query('q'),
          context.req.header('authorization'),
          await context.req.text(),
        ]);
        return context.text('ok', 201);
      });
    const app = new Hono();
    app.use('*', createWorkspaceDispatch({ lookups: lookups(), compose }));
    const response = await app.request('/api/v1/x?q=1', {
      method: 'POST',
      headers: { authorization: 'Bearer amt_b' },
      body: 'payload',
    });
    expect(response.status).toBe(201);
    expect(seen).toEqual([['POST', '1', 'Bearer amt_b', 'payload']]);
  });
});
