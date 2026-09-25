/// <reference types="vitest/globals" />
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useSchedules } from './useSchedules.js';
import type { Schedule } from './useSchedules.js';

const mockFetch = vi.fn();

beforeEach(() => {
  globalThis.fetch = mockFetch;
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeSchedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: 'sched-1',
    name: 'Nightly Run',
    cron: '0 0 * * *',
    suiteId: 'suite-1',
    enabled: true,
    ...overrides,
  };
}

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notOk(status = 500): Response {
  return new Response('Error', { status });
}

describe('useSchedules', () => {
  describe('initial load', () => {
    it('starts with isLoading=true and empty data', () => {
      mockFetch.mockReturnValue(new Promise(() => {}));
      const { result } = renderHook(() => useSchedules());
      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('loads schedules and clears error on success', async () => {
      const schedules = [makeSchedule(), makeSchedule({ id: 'sched-2', name: 'Weekly' })];
      mockFetch.mockResolvedValue(okJson(schedules));

      const { result } = renderHook(() => useSchedules());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.data).toEqual(schedules);
      expect(result.current.error).toBeNull();
    });

    it('returns empty array when API returns []', async () => {
      mockFetch.mockResolvedValue(okJson([]));

      const { result } = renderHook(() => useSchedules());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.data).toEqual([]);
      expect(result.current.error).toBeNull();
    });

    it('sets error on non-ok response', async () => {
      mockFetch.mockResolvedValue(notOk(503));

      const { result } = renderHook(() => useSchedules());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error?.message).toMatch('Failed to fetch schedules: 503');
      expect(result.current.data).toEqual([]);
    });

    it('sets error on network rejection', async () => {
      mockFetch.mockRejectedValue(new Error('connection refused'));

      const { result } = renderHook(() => useSchedules());

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      expect(result.current.error?.message).toBe('connection refused');
    });

    it('does not update state after unmount (cancelled branch)', async () => {
      let resolve: (r: Response) => void = () => {};
      mockFetch.mockReturnValue(new Promise<Response>((res) => { resolve = res; }));

      const { result, unmount } = renderHook(() => useSchedules());
      expect(result.current.isLoading).toBe(true);

      unmount();
      resolve(okJson([makeSchedule()]));
      await Promise.resolve();

      // data must not have been populated after unmount
      expect(result.current.data).toEqual([]);
    });
  });

  describe('reload()', () => {
    it('re-fetches schedules and updates data', async () => {
      const first = [makeSchedule()];
      const second = [makeSchedule(), makeSchedule({ id: 'sched-2' })];
      mockFetch
        .mockResolvedValueOnce(okJson(first))
        .mockResolvedValueOnce(okJson(second));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.data).toHaveLength(1);

      await act(async () => {
        await result.current.reload();
      });

      expect(result.current.data).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('sets error when reload fetch fails', async () => {
      mockFetch
        .mockResolvedValueOnce(okJson([]))
        .mockResolvedValueOnce(notOk(502));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.reload();
      });

      expect(result.current.error?.message).toMatch('Failed to fetch schedules: 502');
    });
  });

  describe('createSchedule()', () => {
    it('posts to /api/schedules and appends created item to data', async () => {
      const existing = makeSchedule();
      const created = makeSchedule({ id: 'sched-new', name: 'Created' });
      mockFetch
        .mockResolvedValueOnce(okJson([existing]))
        .mockResolvedValueOnce(okJson(created));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: Schedule | undefined;
      await act(async () => {
        returned = await result.current.createSchedule({
          name: 'Created',
          cron: '0 * * * *',
          suiteId: 'suite-1',
          enabled: true,
        });
      });

      expect(returned).toEqual(created);
      expect(result.current.data).toHaveLength(2);
      expect(result.current.data[1]).toEqual(created);
      expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/schedules', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }));
    });

    it('throws when create returns non-ok', async () => {
      mockFetch
        .mockResolvedValueOnce(okJson([]))
        .mockResolvedValueOnce(notOk(422));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await expect(
        act(async () => {
          await result.current.createSchedule({ name: 'x', cron: '0 0 * * *', suiteId: 's', enabled: true });
        }),
      ).rejects.toThrow('Failed to create schedule: 422');
    });
  });

  describe('updateSchedule()', () => {
    it('patches the schedule and updates existing item in data', async () => {
      const original = makeSchedule();
      const updated = makeSchedule({ name: 'Updated', enabled: false });
      mockFetch
        .mockResolvedValueOnce(okJson([original]))
        .mockResolvedValueOnce(okJson(updated));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: Schedule | undefined;
      await act(async () => {
        returned = await result.current.updateSchedule('sched-1', { name: 'Updated', enabled: false });
      });

      expect(returned).toEqual(updated);
      expect(result.current.data[0]).toEqual(updated);
      expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/schedules/sched-1', expect.objectContaining({ method: 'PATCH' }));
    });

    it('throws when update returns non-ok', async () => {
      mockFetch
        .mockResolvedValueOnce(okJson([makeSchedule()]))
        .mockResolvedValueOnce(notOk(404));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await expect(
        act(async () => {
          await result.current.updateSchedule('sched-1', { enabled: false });
        }),
      ).rejects.toThrow('Failed to update schedule: 404');
    });
  });

  describe('deleteSchedule()', () => {
    it('deletes the schedule and removes it from data', async () => {
      const s1 = makeSchedule({ id: 'sched-1' });
      const s2 = makeSchedule({ id: 'sched-2' });
      mockFetch
        .mockResolvedValueOnce(okJson([s1, s2]))
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.deleteSchedule('sched-1');
      });

      expect(result.current.data).toHaveLength(1);
      expect(result.current.data[0].id).toBe('sched-2');
      expect(mockFetch).toHaveBeenNthCalledWith(2, '/api/schedules/sched-1', { method: 'DELETE' });
    });

    it('throws when delete returns non-ok', async () => {
      mockFetch
        .mockResolvedValueOnce(okJson([makeSchedule()]))
        .mockResolvedValueOnce(notOk(403));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await expect(
        act(async () => {
          await result.current.deleteSchedule('sched-1');
        }),
      ).rejects.toThrow('Failed to delete schedule: 403');
    });
  });

  describe('toggleSchedule()', () => {
    it('delegates to updateSchedule with enabled flag', async () => {
      const original = makeSchedule({ enabled: true });
      const toggled = makeSchedule({ enabled: false });
      mockFetch
        .mockResolvedValueOnce(okJson([original]))
        .mockResolvedValueOnce(okJson(toggled));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      let returned: Schedule | undefined;
      await act(async () => {
        returned = await result.current.toggleSchedule('sched-1', false);
      });

      expect(returned).toEqual(toggled);
      expect(result.current.data[0].enabled).toBe(false);
    });
  });

  describe('branch coverage gaps', () => {
    it('does not set error after unmount when initial fetch fails (cancelled branch in catch)', async () => {
      let reject: (e: Error) => void = () => {};
      mockFetch.mockReturnValue(
        new Promise<Response>((_, rej) => { reject = rej; }),
      );

      const { result, unmount } = renderHook(() => useSchedules());
      expect(result.current.isLoading).toBe(true);

      unmount(); // cancelled = true
      reject(new Error('network failure after unmount'));
      await Promise.resolve();

      // Error must NOT be set because cancelled=true
      expect(result.current.error).toBeNull();
    });

    it('updateSchedule keeps non-matching items unchanged (covers ternary false branch)', async () => {
      const s1 = makeSchedule({ id: 'sched-1', name: 'First' });
      const s2 = makeSchedule({ id: 'sched-2', name: 'Second' });
      const updated = makeSchedule({ id: 'sched-1', name: 'Updated First' });
      mockFetch
        .mockResolvedValueOnce(okJson([s1, s2])) // 2 items so map visits both
        .mockResolvedValueOnce(okJson(updated));

      const { result } = renderHook(() => useSchedules());
      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.updateSchedule('sched-1', { name: 'Updated First' });
      });

      expect(result.current.data[0]).toEqual(updated); // matched — replaced
      expect(result.current.data[1]).toEqual(s2);      // non-matching — kept as-is
    });
  });
});
