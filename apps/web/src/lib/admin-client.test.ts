import { describe, expect, it, vi } from 'vitest';
import { createAdminClient } from './admin-client.js';

/**
 * The admin client's requests and the shapes it accepts, against the responses the API's
 * members, audit and workspaces routes write (`apps/api/src/routes/{members,audit,workspaces}.ts`).
 */
const MEMBER = {
  userId: 'u 1',
  email: 'ana@example.com',
  displayName: 'Ana',
  role: 'admin',
  disabled: false,
  lastLoginAt: null,
  joinedAt: '2026-10-27T00:00:00.000Z',
};
const EVENT = {
  seq: 7,
  timestamp: '2026-10-27T00:00:00.000Z',
  actorId: 'session',
  action: 'member.add',
  resourceType: 'user',
  resourceId: 'u1',
  ip: null,
};

function server(routes: Record<string, unknown>) {
  const calls: Array<{ method: string; path: string; body: unknown; credentials?: string }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    const method = init?.method ?? 'GET';
    calls.push({
      method,
      path,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      ...(init?.credentials === undefined ? {} : { credentials: init.credentials }),
    });
    const key = `${method} ${path}`;
    return new Response(
      JSON.stringify(routes[key] ?? { error: { code: 'NOT_FOUND', message: 'no route' } }),
      { status: key in routes ? 200 : 404, headers: { 'content-type': 'application/json' } },
    );
  });
  return { client: createAdminClient('', fetchImpl as unknown as typeof fetch), calls };
}

describe('createAdminClient', () => {
  it('lists, adds, changes and removes members, encoding the id in the path', async () => {
    const { client, calls } = server({
      'GET /api/v1/members': { members: [MEMBER] },
      'POST /api/v1/members': { userId: 'u2', role: 'viewer' },
      'PATCH /api/v1/members/u%201': { ok: true },
      'DELETE /api/v1/members/u%201': { ok: true },
    });
    expect(await client.listMembers()).toEqual([MEMBER]);
    await client.addMember('bo@example.com', 'viewer');
    await client.updateMember('u 1', { role: 'operator' });
    await client.removeMember('u 1');
    expect(calls.map(({ method, path, body }) => [method, path, body])).toEqual([
      ['GET', '/api/v1/members', undefined],
      ['POST', '/api/v1/members', { email: 'bo@example.com', role: 'viewer' }],
      ['PATCH', '/api/v1/members/u%201', { role: 'operator' }],
      ['DELETE', '/api/v1/members/u%201', undefined],
    ]);
    // The session cookie is the credential: every call sends it.
    expect(calls.every((call) => call.credentials === 'include')).toBe(true);
  });

  it('pages the audit trail, verifies it, and links its exports', async () => {
    const { client, calls } = server({
      'GET /api/v1/audit?limit=50': { events: [EVENT], next: 7 },
      'GET /api/v1/audit?limit=50&before=7': { events: [], next: null },
      'GET /api/v1/audit/verify': { intact: true, breaks: [], head: { seq: 7, hash: 'ab' } },
    });
    expect(await client.listAudit()).toEqual({ events: [EVENT], next: 7 });
    expect(await client.listAudit(7)).toEqual({ events: [], next: null });
    expect((await client.verifyAudit()).head).toEqual({ seq: 7, hash: 'ab' });
    expect(calls.map((call) => call.path)).toEqual([
      '/api/v1/audit?limit=50',
      '/api/v1/audit?limit=50&before=7',
      '/api/v1/audit/verify',
    ]);
    expect(client.exportUrl('ndjson')).toBe('/api/v1/audit/export');
    expect(client.exportUrl('csv')).toBe('/api/v1/audit/export?format=csv');
  });

  it('lists, chooses and creates workspaces', async () => {
    const listed = {
      current: 'default',
      workspaces: [{ id: 'default', name: 'Default', role: 'admin' }],
      canCreate: true,
    };
    const { client, calls } = server({
      'GET /api/v1/workspaces': listed,
      'POST /api/v1/workspaces/select': { current: 'web' },
      'POST /api/v1/workspaces': { id: 'web', name: 'Web' },
    });
    expect(await client.listWorkspaces()).toEqual(listed);
    await client.selectWorkspace('web');
    await client.createWorkspace('web', 'Web');
    expect(calls.slice(1).map(({ path, body }) => [path, body])).toEqual([
      ['/api/v1/workspaces/select', { workspaceId: 'web' }],
      ['/api/v1/workspaces', { id: 'web', name: 'Web' }],
    ]);
  });

  it('refuses a response that is not the shape the page reads', async () => {
    const { client } = server({ 'GET /api/v1/members': { members: [{ userId: 1 }] } });
    await expect(client.listMembers()).rejects.toThrow();
    await expect(client.verifyAudit()).rejects.toThrow();
  });
});
