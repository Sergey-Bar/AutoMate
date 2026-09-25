import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversations } from './use-conversations.js';

const reactMocks = vi.hoisted(() => ({
  useState: vi.fn(),
  useEffect: vi.fn(),
}));

const hookMocks = vi.hoisted(() => ({
  setConversations: vi.fn(),
  setLoading: vi.fn(),
  setError: vi.fn(),
  effectCallback: null as null | (() => void),
}));

vi.mock('react', () => ({
  useState: reactMocks.useState,
  useEffect: reactMocks.useEffect,
}));

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn();

const flushPromises = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe('useConversations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    hookMocks.effectCallback = null;

    (globalThis as { fetch: typeof fetch }).fetch = mockFetch as unknown as typeof fetch;

    let stateCallIndex = 0;
    reactMocks.useState.mockImplementation((initialValue: unknown) => {
      stateCallIndex += 1;

      if (stateCallIndex === 1) {
        return [initialValue, hookMocks.setConversations] as const;
      }

      if (stateCallIndex === 2) {
        return [initialValue, hookMocks.setLoading] as const;
      }

      if (stateCallIndex === 3) {
        return [initialValue, hookMocks.setError] as const;
      }

      throw new Error(`Unexpected useState call #${stateCallIndex}`);
    });

    reactMocks.useEffect.mockImplementation((callback: () => void) => {
      hookMocks.effectCallback = callback;
    });
  });

  afterAll(() => {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it('returns initial conversations/loading state and create function', () => {
    const result = useConversations();

    expect(result.conversations).toEqual([]);
    expect(result.loading).toBe(true);
    expect(result.error).toBeNull();
    expect(result.create).toBeTypeOf('function');
    expect(result.clearError).toBeTypeOf('function');
    expect(reactMocks.useEffect).toHaveBeenCalledWith(expect.any(Function), []);
  });

  it('fetches conversations on mount and updates state when effect runs', async () => {
    const serverConversations = [
      { id: 'conv-1', title: 'First', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'conv-2', title: null, createdAt: '2026-01-02T00:00:00.000Z' },
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(serverConversations),
    });

    useConversations();

    expect(hookMocks.effectCallback).not.toBeNull();
    hookMocks.effectCallback?.();
    await flushPromises();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations', expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(hookMocks.setConversations).toHaveBeenCalledTimes(1);
    expect(hookMocks.setConversations).toHaveBeenCalledWith(serverConversations);
    expect(hookMocks.setLoading).toHaveBeenCalledTimes(1);
    expect(hookMocks.setLoading).toHaveBeenCalledWith(false);
  });

  it('create sends POST with title and prepends new conversation', async () => {
    const createdConversation = {
      id: 'conv-new',
      title: 'Project Alpha',
      createdAt: '2026-02-01T00:00:00.000Z',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(createdConversation),
    });

    const { create } = useConversations();
    const result = await create('Project Alpha');

    expect(result).toEqual(createdConversation);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Project Alpha' }),
    });

    expect(hookMocks.setConversations).toHaveBeenCalledTimes(1);
    const updater = hookMocks.setConversations.mock.calls[0][0] as (prev: Array<{ id: string; title: string | null; createdAt: string }>) => Array<{ id: string; title: string | null; createdAt: string }>;
    const existing = [{ id: 'conv-old', title: 'Old', createdAt: '2026-01-15T00:00:00.000Z' }];

    expect(updater(existing)).toEqual([createdConversation, ...existing]);
  });

  it('create sends POST without title as empty JSON object', async () => {
    const createdConversation = {
      id: 'conv-no-title',
      title: null,
      createdAt: '2026-03-01T00:00:00.000Z',
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(createdConversation),
    });

    const { create } = useConversations();
    await create();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: undefined }),
    });
  });
});
