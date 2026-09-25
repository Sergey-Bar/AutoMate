import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAIGenerate, aiGenerateApiPath } from './useAIGenerate.js';

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAIGenerate', () => {
  it('exports the correct API path', () => {
    expect(aiGenerateApiPath).toBe('/api/ai/generate-test');
  });

  it('starts in idle state with no result or error', () => {
    const { result } = renderHook(() => useAIGenerate());
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('sets status to loading while fetching', async () => {
    let resolvePromise!: (value: Response) => void;
    const pending = new Promise<Response>(res => { resolvePromise = res; });
    mockFetch.mockReturnValue(pending);

    const { result } = renderHook(() => useAIGenerate());

    act(() => {
      void result.current.generate('test prompt', 'https://example.com');
    });

    expect(result.current.status).toBe('loading');

    // Resolve to avoid unhandled promise
    resolvePromise(new Response(JSON.stringify({ code: '', explanation: '' }), { status: 200 }));
  });

  it('sets result on successful response', async () => {
    const mockResult = { code: 'test("example", async () => {})', explanation: 'A simple test' };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(mockResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const { result } = renderHook(() => useAIGenerate());

    await act(async () => {
      await result.current.generate('click the login button', 'https://example.com');
    });

    expect(result.current.status).toBe('success');
    expect(result.current.result).toEqual(mockResult);
    expect(result.current.error).toBeNull();
  });

  it('sets error on non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue(new Response('Not Found', { status: 404 }));

    const { result } = renderHook(() => useAIGenerate());

    await act(async () => {
      await result.current.generate('some prompt', '');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('HTTP 404');
    expect(result.current.result).toBeNull();
  });

  it('sets error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    const { result } = renderHook(() => useAIGenerate());

    await act(async () => {
      await result.current.generate('some prompt', '');
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Network error');
  });

  it('does nothing when prompt is empty', async () => {
    const { result } = renderHook(() => useAIGenerate());

    await act(async () => {
      await result.current.generate('   ', '');
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });

  it('posts to the correct endpoint with prompt and targetUrl', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: 'code', explanation: 'exp' }), { status: 200 })
    );

    const { result } = renderHook(() => useAIGenerate());

    await act(async () => {
      await result.current.generate('my prompt', 'https://test.com');
    });

    expect(mockFetch).toHaveBeenCalledWith('/api/ai/generate-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'my prompt', targetUrl: 'https://test.com' }),
    });
  });

  it('resets state back to idle', async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ code: 'code', explanation: 'exp' }), { status: 200 })
    );

    const { result } = renderHook(() => useAIGenerate());

    await act(async () => {
      await result.current.generate('prompt', '');
    });

    expect(result.current.status).toBe('success');

    act(() => {
      result.current.reset();
    });

    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
