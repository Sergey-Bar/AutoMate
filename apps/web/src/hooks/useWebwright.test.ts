/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useWebwrightTask, useCreateWebwrightTask } from './useWebwright.js';
import { createTask, getTask, connectTaskStream } from '../services/webwright-client.js';
import type { WebwrightTask } from '../services/webwright-client.js';

vi.mock('../services/webwright-client.js', () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  connectTaskStream: vi.fn(),
}));

const mockTask: WebwrightTask = {
  id: 'task-1',
  url: 'https://example.com',
  actions: ['click #submit'],
  status: 'pending',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

function makeStream() {
  let msgHandler: ((task: WebwrightTask) => void) | null = null;
  let errHandler: ((event: Event) => void) | null = null;
  const closeFn = vi.fn();

  const handle = {
    onMessage: vi.fn((h: (task: WebwrightTask) => void) => {
      msgHandler = h;
    }),
    onError: vi.fn((h: (event: Event) => void) => {
      errHandler = h;
    }),
    close: closeFn,
  };

  return {
    handle,
    triggerMessage: (task: WebwrightTask) => msgHandler?.(task),
    triggerError: (event: Event) => errHandler?.(event),
    close: closeFn,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default stream so the hook never receives undefined from connectTaskStream
  vi.mocked(connectTaskStream).mockReturnValue(makeStream().handle);
});

describe('useWebwrightTask', () => {
  it('with null id: returns defaults without fetching or connecting', () => {
    const { result } = renderHook(() => useWebwrightTask(null));

    expect(result.current.task).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getTask).not.toHaveBeenCalled();
    expect(connectTaskStream).not.toHaveBeenCalled();
  });

  it('with null id: refresh() is a no-op and does not call getTask', async () => {
    const { result } = renderHook(() => useWebwrightTask(null));

    await act(async () => {
      await result.current.refresh();
    });

    expect(getTask).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });

  it('with id: fetches task and registers stream handlers on mount', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockResolvedValue(mockTask);

    const { result } = renderHook(() => useWebwrightTask('task-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(getTask).toHaveBeenCalledWith('task-1');
    expect(connectTaskStream).toHaveBeenCalledWith('task-1');
    expect(result.current.task).toEqual(mockTask);
    expect(result.current.error).toBeNull();
    expect(stream.handle.onMessage).toHaveBeenCalled();
    expect(stream.handle.onError).toHaveBeenCalled();
  });

  it('with id: sets error when getTask rejects', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockRejectedValue(new Error('task not found'));

    const { result } = renderHook(() => useWebwrightTask('task-1'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error?.message).toBe('task not found');
    expect(result.current.task).toBeNull();
  });

  it('updates task state when stream receives a message', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockResolvedValue(mockTask);

    const { result } = renderHook(() => useWebwrightTask('task-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const completedTask: WebwrightTask = { ...mockTask, status: 'completed' };
    act(() => {
      stream.triggerMessage(completedTask);
    });

    expect(result.current.task?.status).toBe('completed');
  });

  it('sets error with "WebSocket error:" prefix when stream emits an error', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockResolvedValue(mockTask);

    const { result } = renderHook(() => useWebwrightTask('task-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => {
      stream.triggerError(new Event('error'));
    });

    expect(result.current.error?.message).toBe('WebSocket error: error');
  });

  it('calls stream.close() on unmount', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockResolvedValue(mockTask);

    const { unmount } = renderHook(() => useWebwrightTask('task-1'));
    await waitFor(() => expect(vi.mocked(getTask)).toHaveBeenCalledOnce());

    unmount();

    expect(stream.close).toHaveBeenCalledOnce();
  });

  it('refresh() re-fetches the task and updates state', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    const runningTask: WebwrightTask = { ...mockTask, status: 'running' };
    vi.mocked(getTask)
      .mockResolvedValueOnce(mockTask)
      .mockResolvedValueOnce(runningTask);

    const { result } = renderHook(() => useWebwrightTask('task-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.task?.status).toBe('pending');

    await act(async () => {
      await result.current.refresh();
    });

    expect(getTask).toHaveBeenCalledTimes(2);
    expect(result.current.task?.status).toBe('running');
    expect(result.current.isLoading).toBe(false);
  });

  it('refresh() sets error when re-fetch fails', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask)
      .mockResolvedValueOnce(mockTask)
      .mockRejectedValueOnce(new Error('refresh failed'));

    const { result } = renderHook(() => useWebwrightTask('task-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error?.message).toBe('refresh failed');
    expect(result.current.isLoading).toBe(false);
  });

  it('does not update state after unmount (mounted guard)', async () => {
    let resolveTask: (t: WebwrightTask) => void = () => {};
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockReturnValue(
      new Promise<WebwrightTask>((res) => {
        resolveTask = res;
      }),
    );

    const { result, unmount } = renderHook(() => useWebwrightTask('task-1'));
    unmount();

    resolveTask(mockTask);
    await Promise.resolve();

    // task was not set because mounted=false
    expect(result.current.task).toBeNull();
  });

  it('stream message after unmount does not update task state (mounted=false branch)', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockResolvedValue(mockTask);

    const { result, unmount } = renderHook(() => useWebwrightTask('task-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.task?.status).toBe('pending');

    unmount(); // mounted = false

    const updatedTask: WebwrightTask = { ...mockTask, status: 'completed' };
    act(() => {
      stream.triggerMessage(updatedTask); // fires handler with mounted=false
    });

    // state must not have changed because mounted is false
    expect(result.current.task?.status).toBe('pending');
  });

  it('stream error after unmount does not update error state (mounted=false branch)', async () => {
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockResolvedValue(mockTask);

    const { result, unmount } = renderHook(() => useWebwrightTask('task-1'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    unmount(); // mounted = false

    act(() => {
      stream.triggerError(new Event('error')); // fires handler with mounted=false
    });

    expect(result.current.error).toBeNull(); // not updated after unmount
  });

  it('getTask rejection after unmount does not set error (mounted=false in catch)', async () => {
    let rejectTask: (e: Error) => void = () => {};
    const stream = makeStream();
    vi.mocked(connectTaskStream).mockReturnValue(stream.handle);
    vi.mocked(getTask).mockReturnValue(
      new Promise<WebwrightTask>((_, rej) => { rejectTask = rej; }),
    );

    const { result, unmount } = renderHook(() => useWebwrightTask('task-1'));
    unmount(); // mounted = false immediately

    rejectTask(new Error('fetch failed after unmount'));
    await Promise.resolve();

    expect(result.current.error).toBeNull(); // not set because mounted=false
  });
});

describe('useCreateWebwrightTask', () => {
  it('starts with isCreating=false and no error', () => {
    const { result } = renderHook(() => useCreateWebwrightTask());
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('creates task successfully and returns it', async () => {
    vi.mocked(createTask).mockResolvedValue(mockTask);

    const { result } = renderHook(() => useCreateWebwrightTask());

    let returned: WebwrightTask | undefined;
    await act(async () => {
      returned = await result.current.create('https://example.com', ['click #btn']);
    });

    expect(createTask).toHaveBeenCalledWith('https://example.com', ['click #btn']);
    expect(returned).toEqual(mockTask);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('resets isCreating to false after create resolves', async () => {
    vi.mocked(createTask).mockResolvedValue(mockTask);

    const { result } = renderHook(() => useCreateWebwrightTask());
    expect(result.current.isCreating).toBe(false);

    await act(async () => {
      await result.current.create('https://example.com', []);
    });

    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets error and re-throws when createTask rejects', async () => {
    vi.mocked(createTask).mockRejectedValue(new Error('creation failed'));

    const { result } = renderHook(() => useCreateWebwrightTask());

    // Catch inside act so React 18 can flush setError(e) before we assert
    let thrownError: Error | undefined;
    await act(async () => {
      try {
        await result.current.create('https://example.com', []);
      } catch (e) {
        thrownError = e as Error;
      }
    });

    expect(thrownError?.message).toBe('creation failed');
    expect(result.current.error?.message).toBe('creation failed');
    expect(result.current.isCreating).toBe(false);
  });
});
