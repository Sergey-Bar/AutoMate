import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

describe('authStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('exports useAuthStore', async () => {
    const mod = await import('./authStore.js');
    expect(mod.useAuthStore).toBeDefined();
  });

  it('checkAuthStatus sets enabled/authenticated from API', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, authenticated: true }), { status: 200 }),
    );

    const { useAuthStore } = await import('./authStore.js');
    await useAuthStore.getState().checkAuthStatus();

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/status', { credentials: 'include' });
    expect(useAuthStore.getState()).toMatchObject({
      enabled: true,
      authenticated: true,
      loading: false,
      error: null,
    });
  });

  it('checkAuthStatus stores HTTP error when status endpoint fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));

    const { useAuthStore } = await import('./authStore.js');
    await useAuthStore.getState().checkAuthStatus();

    expect(useAuthStore.getState()).toMatchObject({
      loading: false,
      error: 'HTTP 500',
    });
  });

  it('login posts apiKey and returns true on success', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }));

    const { useAuthStore } = await import('./authStore.js');
    const result = await useAuthStore.getState().login('key-123');

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'key-123' }),
    });
    expect(useAuthStore.getState()).toMatchObject({
      authenticated: true,
      loading: false,
      error: null,
    });
  });

  it('login returns false and stores HTTP error on invalid key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 401 }));

    const { useAuthStore } = await import('./authStore.js');
    const result = await useAuthStore.getState().login('bad-key');

    expect(result).toBe(false);
    expect(useAuthStore.getState()).toMatchObject({
      authenticated: false,
      loading: false,
      error: 'HTTP 401',
    });
  });

  it('logout posts to API and resets authenticated state', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ authenticated: false }), { status: 200 }));

    const { useAuthStore } = await import('./authStore.js');
    await useAuthStore.getState().login('key-123');
    await useAuthStore.getState().logout();

    expect(fetchMock).toHaveBeenLastCalledWith('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    expect(useAuthStore.getState()).toMatchObject({
      authenticated: false,
      loading: false,
      error: null,
    });
  });

  it('logout sets error message when fetch throws (line 68)', async () => {
    // Line 68: catch (err) { set({ authenticated: false, loading: false, error: (err as Error).message }) }
    fetchMock.mockRejectedValueOnce(new Error('network failure'));

    const { useAuthStore } = await import('./authStore.js');
    await useAuthStore.getState().logout();

    expect(useAuthStore.getState()).toMatchObject({
      authenticated: false,
      loading: false,
      error: 'network failure',
    });
  });
});
