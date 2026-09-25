/// <reference types="vitest/globals" />
import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useMCPServers } from './useMCPServers.js';
import type { MCPServer } from './useMCPServers.js';

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const sampleServers: MCPServer[] = [
  {
    id: 'custom-1',
    name: 'Custom MCP',
    status: 'connected',
    tools: [{ name: 'run', description: 'Run a command' }],
  },
];

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useMCPServers', () => {
  it('starts with isLoading=true and empty data', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMCPServers());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('loads server list from /api/mcp/servers on success', async () => {
    mockFetch.mockResolvedValue(okJson(sampleServers));

    const { result } = renderHook(() => useMCPServers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockFetch).toHaveBeenCalledWith('/api/mcp/servers');
    expect(result.current.data).toEqual(sampleServers);
    expect(result.current.error).toBeNull();
  });

  it('returns empty list when API returns []', async () => {
    mockFetch.mockResolvedValue(okJson([]));

    const { result } = renderHook(() => useMCPServers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.data).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('falls back to DEFAULT_MCP_SERVERS and sets error on non-ok response', async () => {
    mockFetch.mockResolvedValue(new Response('Not Found', { status: 404 }));

    const { result } = renderHook(() => useMCPServers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error?.message).toMatch('Failed to fetch MCP servers: 404');
    // Falls back to built-in defaults
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].id).toBe('playwright');
  });

  it('falls back to DEFAULT_MCP_SERVERS and sets error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('connection reset'));

    const { result } = renderHook(() => useMCPServers());

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('connection reset');
    // Fallback data populated
    expect(result.current.data[0].id).toBe('playwright');
    expect(result.current.data[0].tools.length).toBeGreaterThan(0);
  });

  it('does not update state after unmount (mounted branch)', async () => {
    let resolve: (r: Response) => void = () => {};
    mockFetch.mockReturnValue(new Promise<Response>((res) => { resolve = res; }));

    const { result, unmount } = renderHook(() => useMCPServers());
    expect(result.current.isLoading).toBe(true);

    unmount();
    resolve(okJson(sampleServers));
    await Promise.resolve();

    // data stays empty because unmounted before resolution
    expect(result.current.data).toEqual([]);
  });
});
