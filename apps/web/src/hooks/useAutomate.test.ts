/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useConversations, useConversation, useConnectors, useVault } from './useAutomate.js';
import type { ApiClient, Conversation, Message, Connector, VaultSecret } from '../lib/api.js';

function createApi(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getRuns: vi.fn().mockResolvedValue([]),
    getRun: vi.fn(),
    getSuites: vi.fn().mockResolvedValue([]),
    getTests: vi.fn().mockResolvedValue([]),
    getAnalyticsSummary: vi.fn(),
    getQuarantine: vi.fn(),
    addQuarantine: vi.fn(),
    onRunUpdated: vi.fn(() => () => undefined),
    getConversations: vi.fn().mockResolvedValue([]),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    getModelConfig: vi.fn(),
    updateModelConfig: vi.fn(),
    getConnectors: vi.fn().mockResolvedValue([]),
    getVaultSecrets: vi.fn().mockResolvedValue([]),
    deleteVaultSecret: vi.fn().mockResolvedValue(undefined),
    getA11yAudit: vi.fn().mockResolvedValue({ violations: [], pagesScanned: 0, scannedAt: '' }),
    ...overrides,
  };
}

const sampleConversations: Conversation[] = [
  { id: 'conv-1', title: 'Debug session', createdAt: '2026-06-01T00:00:00.000Z' },
  { id: 'conv-2', title: 'Test coverage', createdAt: '2026-06-02T00:00:00.000Z' },
];

const sampleMessages: Message[] = [
  { id: 'msg-1', conversationId: 'conv-1', role: 'user', content: 'Hello', createdAt: '2026-06-01T00:00:00.000Z' },
  { id: 'msg-2', conversationId: 'conv-1', role: 'assistant', content: 'Hi there', createdAt: '2026-06-01T00:01:00.000Z' },
];

const sampleConnectors: Connector[] = [
  { name: 'github', displayName: 'GitHub', type: 'vcs', status: 'active' },
  { name: 'jira', displayName: 'Jira', type: 'issue-tracker', status: 'inactive' },
];

const sampleSecrets: VaultSecret[] = [
  { id: 'sec-1', name: 'GITHUB_TOKEN', updatedAt: '2026-06-01T00:00:00.000Z' },
  { id: 'sec-2', name: 'JIRA_API_KEY', connector: 'jira', updatedAt: '2026-06-02T00:00:00.000Z' },
];

describe('useConversations', () => {
  it('starts with isLoading=true and empty data', () => {
    const api = createApi({ getConversations: vi.fn(() => new Promise<Conversation[]>(() => {})) });
    const { result } = renderHook(() => useConversations(api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('loads conversations on success', async () => {
    const api = createApi({ getConversations: vi.fn().mockResolvedValue(sampleConversations) });
    const { result } = renderHook(() => useConversations(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(sampleConversations);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when API returns []', async () => {
    const api = createApi({ getConversations: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useConversations(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getConversations rejects', async () => {
    const api = createApi({ getConversations: vi.fn().mockRejectedValue(new Error('conv error')) });
    const { result } = renderHook(() => useConversations(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('conv error');
    expect(result.current.data).toEqual([]);
  });

  it('does not update state after unmount', async () => {
    let resolve: (v: Conversation[]) => void = () => {};
    const api = createApi({
      getConversations: vi.fn(() => new Promise<Conversation[]>((res) => { resolve = res; })),
    });
    const { result, unmount } = renderHook(() => useConversations(api));

    unmount();
    resolve(sampleConversations);
    await Promise.resolve();

    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });
});

describe('useConversation', () => {
  it('starts with isLoading=true and empty messages', () => {
    const api = createApi({ getMessages: vi.fn(() => new Promise<Message[]>(() => {})) });
    const { result } = renderHook(() => useConversation('conv-1', api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('loads messages for the given conversation id', async () => {
    const api = createApi({ getMessages: vi.fn().mockResolvedValue(sampleMessages) });
    const { result } = renderHook(() => useConversation('conv-1', api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(api.getMessages).toHaveBeenCalledWith('conv-1');
    expect(result.current.messages).toEqual(sampleMessages);
    expect(result.current.error).toBeNull();
  });

  it('returns empty messages when API returns []', async () => {
    const api = createApi({ getMessages: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useConversation('conv-1', api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getMessages rejects', async () => {
    const api = createApi({ getMessages: vi.fn().mockRejectedValue(new Error('messages error')) });
    const { result } = renderHook(() => useConversation('conv-1', api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('messages error');
    expect(result.current.messages).toEqual([]);
  });

  it('does not update state after unmount', async () => {
    let resolve: (v: Message[]) => void = () => {};
    const api = createApi({
      getMessages: vi.fn(() => new Promise<Message[]>((res) => { resolve = res; })),
    });
    const { result, unmount } = renderHook(() => useConversation('conv-1', api));

    unmount();
    resolve(sampleMessages);
    await Promise.resolve();

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it('re-fetches when conversation id changes', async () => {
    const api = createApi({
      getMessages: vi.fn()
        .mockResolvedValueOnce(sampleMessages)
        .mockResolvedValueOnce([sampleMessages[0]]),
    });
    const { result, rerender } = renderHook(
      ({ id }) => useConversation(id, api),
      { initialProps: { id: 'conv-1' } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.getMessages).toHaveBeenCalledWith('conv-1');

    rerender({ id: 'conv-2' });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(api.getMessages).toHaveBeenCalledWith('conv-2');
  });
});

describe('useConnectors', () => {
  it('starts with isLoading=true and empty data', () => {
    const api = createApi({ getConnectors: vi.fn(() => new Promise<Connector[]>(() => {})) });
    const { result } = renderHook(() => useConnectors(api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it('loads connectors on success', async () => {
    const api = createApi({ getConnectors: vi.fn().mockResolvedValue(sampleConnectors) });
    const { result } = renderHook(() => useConnectors(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(sampleConnectors);
    expect(result.current.error).toBeNull();
  });

  it('returns empty array when API returns []', async () => {
    const api = createApi({ getConnectors: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useConnectors(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getConnectors rejects', async () => {
    const api = createApi({ getConnectors: vi.fn().mockRejectedValue(new Error('connectors down')) });
    const { result } = renderHook(() => useConnectors(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('connectors down');
    expect(result.current.data).toEqual([]);
  });

  it('does not update state after unmount', async () => {
    let resolve: (v: Connector[]) => void = () => {};
    const api = createApi({
      getConnectors: vi.fn(() => new Promise<Connector[]>((res) => { resolve = res; })),
    });
    const { result, unmount } = renderHook(() => useConnectors(api));

    unmount();
    resolve(sampleConnectors);
    await Promise.resolve();

    expect(result.current.data).toEqual([]);
  });
});

describe('useVault', () => {
  it('starts with isLoading=true and empty data', () => {
    const api = createApi({ getVaultSecrets: vi.fn(() => new Promise<VaultSecret[]>(() => {})) });
    const { result } = renderHook(() => useVault(api));
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it('loads vault secrets on success', async () => {
    const api = createApi({ getVaultSecrets: vi.fn().mockResolvedValue(sampleSecrets) });
    const { result } = renderHook(() => useVault(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual(sampleSecrets);
    expect(result.current.error).toBeNull();
  });

  it('returns empty secrets when API returns []', async () => {
    const api = createApi({ getVaultSecrets: vi.fn().mockResolvedValue([]) });
    const { result } = renderHook(() => useVault(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getVaultSecrets rejects', async () => {
    const api = createApi({ getVaultSecrets: vi.fn().mockRejectedValue(new Error('vault locked')) });
    const { result } = renderHook(() => useVault(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('vault locked');
    expect(result.current.data).toEqual([]);
  });

  it('deleteSecret calls API and removes the secret from local state', async () => {
    const api = createApi({
      getVaultSecrets: vi.fn().mockResolvedValue(sampleSecrets),
      deleteVaultSecret: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useVault(api));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.deleteSecret('sec-1');
    });

    expect(api.deleteVaultSecret).toHaveBeenCalledWith('sec-1');
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe('sec-2');
  });

  it('does not update state after unmount', async () => {
    let resolve: (v: VaultSecret[]) => void = () => {};
    const api = createApi({
      getVaultSecrets: vi.fn(() => new Promise<VaultSecret[]>((res) => { resolve = res; })),
    });
    const { result, unmount } = renderHook(() => useVault(api));

    unmount();
    resolve(sampleSecrets);
    await Promise.resolve();

    expect(result.current.data).toEqual([]);
  });
});
