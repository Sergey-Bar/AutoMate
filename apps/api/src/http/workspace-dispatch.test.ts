import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import {
  WORKSPACE_CHOICE,
  createWorkspaceDispatch,
  resolveRequestWorkspace,
  type WorkspaceLookups,
} from './workspace-dispatch.js';

/**
 * Which workspace a request belongs to (ADR-014, team): read from a credential the server
 * trusts, never from the request alone. A token belongs to its own workspace; a runner's job
 * call to the job's; an installation-wide credential to the default; a person to a workspace
 * they are a member of; the installation's own admin to whichever workspace they choose.
 * Anything else is the default.
 */
const DEFAULT = 'default-workspace';
/** Job ids are uuids, and a runner's call names one in its path. */
const JOB_B = '7f0e2c1a-0000-4000-8000-00000000000b';
const UNKNOWN_JOB = '00000000-0000-4000-8000-000000000000';

function lookups(overrides: Partial<WorkspaceLookups> = {}): WorkspaceLookups {
  return {
    defaultWorkspace: DEFAULT,
    tokenWorkspace: vi.fn(async (token: string) => (token === 'amt_b' ? 'ws-b' : null)),
    jobWorkspace: vi.fn(async (jobId: string) => (jobId === JOB_B ? 'ws-b' : null)),
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
    expect(await resolve({ cookie: `${WORKSPACE_CHOICE}=ws-b` })).toBe(DEFAULT);
  });

  it('is a token’s own workspace, and a token cannot be pointed elsewhere', async () => {
    expect(await resolve({ authorization: 'Bearer amt_b' })).toBe('ws-b');
    expect(
      await resolve({ authorization: 'Bearer amt_b', cookie: `${WORKSPACE_CHOICE}=ws-c` }),
    ).toBe('ws-b');
    expect(await resolve({ cookie: 'automate_token=amt_b' })).toBe('ws-b');
    // An unknown token is no credential: with nothing beside it the request is the default's,
    // where it is refused as unknown.
    expect(await resolve({ authorization: 'Bearer amt_unknown' })).toBe(DEFAULT);
  });

  it('reads the browser token cookie only where it signs anyone in (PRO-19)', async () => {
    // Under enforced single sign-on a token cookie authenticates nobody, so it must not steer
    // either: the person beside it is routed by their own memberships. A bearer still decides.
    const sso = {
      browserCredentials: false,
      sessionUser: vi.fn(async () => 'u-1'),
      memberships: vi.fn(async () => [DEFAULT]),
    };
    expect(await resolve({ cookie: 'automate_token=amt_b' }, sso)).toBe(DEFAULT);
    expect(await resolve({ authorization: 'Bearer amt_b' }, sso)).toBe('ws-b');
    expect(
      await resolve({ cookie: 'automate_token=amt_b' }, { ...sso, browserCredentials: true }),
    ).toBe('ws-b');
  });

  it('passes over a token nobody holds any more to the person who also signed in', async () => {
    // A browser still carrying the sign-in cookie of a revoked token, beside a person's session:
    // the caller resolver passes over the token to the person, and so does the workspace.
    const person = {
      sessionUser: vi.fn(async () => 'u1'),
      memberships: vi.fn(async () => ['ws-b', DEFAULT]),
    };
    expect(
      await resolve({ cookie: `automate_token=amt_revoked; ${WORKSPACE_CHOICE}=ws-b` }, person),
    ).toBe('ws-b');
    expect(
      await resolve(
        { authorization: 'Bearer amt_revoked', cookie: `${WORKSPACE_CHOICE}=ws-b` },
        person,
      ),
    ).toBe('ws-b');
  });

  it('is a job’s workspace for a runner’s call about that job', async () => {
    expect(
      await resolve({ authorization: 'Bearer runner-token' }, {}, `/api/v1/jobs/${JOB_B}/complete`),
    ).toBe('ws-b');
    expect(
      await resolve(
        { authorization: 'Bearer runner-token' },
        {},
        `/api/v1/jobs/${UNKNOWN_JOB}/events`,
      ),
    ).toBe(DEFAULT);
  });

  it('does not throw on a job path that is not a well-formed escape', async () => {
    // A path anyone can send before signing in: an answer, not a 500 and an error report.
    expect(
      await resolve({ authorization: 'Bearer runner-token' }, {}, '/api/v1/jobs/%ZZ/events'),
    ).toBe(DEFAULT);
  });

  it('reads a job only from a path that names a uuid', async () => {
    const jobWorkspace = vi.fn(async () => 'ws-b');
    // Thirty-six dashes are a uuid's length and not a uuid: no job, and no lookup.
    expect(
      await resolve(
        { authorization: 'Bearer runner-token' },
        { jobWorkspace },
        `/api/v1/jobs/${'-'.repeat(36)}/events`,
      ),
    ).toBe(DEFAULT);
    expect(jobWorkspace).not.toHaveBeenCalled();
    // The canonical shape is one, in either case.
    expect(
      await resolve(
        { authorization: 'Bearer runner-token' },
        { jobWorkspace },
        `/api/v1/jobs/${JOB_B.toUpperCase()}/events`,
      ),
    ).toBe('ws-b');
  });

  it('is the default for an installation-wide credential, which no cookie can steer', async () => {
    const person = {
      sessionUser: vi.fn(async () => 'u1'),
      memberships: vi.fn(async () => ['ws-b', DEFAULT]),
    };
    const steer = { cookie: `${WORKSPACE_CHOICE}=ws-b` };
    // The reporter secret, the registration secret as a bearer, a runner's or a SCIM token: a
    // bearer that is not an access token belongs to the installation, not to a workspace.
    for (const bearer of ['reporter-secret', 'runner-token', 'scim_x']) {
      expect(await resolve({ authorization: `Bearer ${bearer}`, ...steer }, person), bearer).toBe(
        DEFAULT,
      );
    }
    // The registration secret in its own header.
    expect(await resolve({ 'x-runner-registration-secret': 'shared', ...steer }, person)).toBe(
      DEFAULT,
    );
    // Nor does the installation admin's choice steer one.
    const admin = { installationLevel: vi.fn(async () => true) };
    expect(
      await resolve(
        { authorization: 'Bearer reporter-secret', cookie: `${WORKSPACE_CHOICE}=ws-c` },
        admin,
      ),
    ).toBe(DEFAULT);
    // A runner's call about a job is still the job's workspace's.
    expect(
      await resolve(
        { authorization: 'Bearer runner-token', cookie: `${WORKSPACE_CHOICE}=ws-c` },
        admin,
        `/api/v1/jobs/${JOB_B}/complete`,
      ),
    ).toBe('ws-b');
  });

  it('is the workspace a person chose, only if they are a member of it', async () => {
    const person = {
      sessionUser: vi.fn(async () => 'u1'),
      memberships: vi.fn(async () => ['ws-b', DEFAULT]),
    };
    expect(await resolve({ cookie: `${WORKSPACE_CHOICE}=ws-b` }, person)).toBe('ws-b');
    // Not a member of ws-c: the choice is ignored, not honoured.
    expect(await resolve({ cookie: `${WORKSPACE_CHOICE}=ws-c` }, person)).toBe(DEFAULT);
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
    expect(await resolve({ cookie: `${WORKSPACE_CHOICE}=ws-c` }, admin)).toBe('ws-c');
    expect(await resolve({ cookie: `${WORKSPACE_CHOICE}=nowhere` }, admin)).toBe(DEFAULT);
  });

  it('ignores a cookie that is not a workspace id', async () => {
    const admin = { installationLevel: vi.fn(async () => true) };
    expect(await resolve({ cookie: `${WORKSPACE_CHOICE}=..%2Fx` }, admin)).toBe(DEFAULT);
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
