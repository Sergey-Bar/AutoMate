import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpProcessLifecycle, type ProcessHandle } from './lifecycle.js';

describe('McpProcessLifecycle', () => {
  let lifecycle: McpProcessLifecycle;

  beforeEach(() => {
    lifecycle = new McpProcessLifecycle();
  });

  afterEach(async () => {
    await lifecycle.shutdownAll();
  });

  describe('isRunning', () => {
    it('returns false for unknown server', () => {
      expect(lifecycle.isRunning('unknown')).toBe(false);
    });
  });

  describe('getHandle', () => {
    it('returns undefined for unknown server', () => {
      expect(lifecycle.getHandle('unknown')).toBeUndefined();
    });
  });

  describe('register / unregister', () => {
    it('tracks a manually registered handle', () => {
      const mockHandle: ProcessHandle = {
        serverId: 'test-server',
        pid: 12345,
        kill: vi.fn().mockResolvedValue(undefined),
      };

      lifecycle.registerHandle(mockHandle);
      expect(lifecycle.isRunning('test-server')).toBe(true);
      expect(lifecycle.getHandle('test-server')?.pid).toBe(12345);
    });

    it('removes a handle on unregister', async () => {
      const mockHandle: ProcessHandle = {
        serverId: 'test-server',
        pid: 12345,
        kill: vi.fn().mockResolvedValue(undefined),
      };

      lifecycle.registerHandle(mockHandle);
      await lifecycle.shutdown('test-server');
      expect(lifecycle.isRunning('test-server')).toBe(false);
      expect(mockHandle.kill).toHaveBeenCalled();
    });
  });

  describe('shutdownAll', () => {
    it('kills all registered processes', async () => {
      const killA = vi.fn().mockResolvedValue(undefined);
      const killB = vi.fn().mockResolvedValue(undefined);

      lifecycle.registerHandle({ serverId: 'a', pid: 1, kill: killA });
      lifecycle.registerHandle({ serverId: 'b', pid: 2, kill: killB });

      await lifecycle.shutdownAll();
      expect(killA).toHaveBeenCalled();
      expect(killB).toHaveBeenCalled();
      expect(lifecycle.isRunning('a')).toBe(false);
      expect(lifecycle.isRunning('b')).toBe(false);
    });
  });

  describe('getStatus', () => {
    it('returns status for all tracked processes', () => {
      lifecycle.registerHandle({
        serverId: 'server-1',
        pid: 100,
        kill: vi.fn(),
      });

      const status = lifecycle.getStatus();
      expect(status).toHaveLength(1);
      expect(status[0]).toEqual({
        serverId: 'server-1',
        pid: 100,
        running: true,
      });
    });
  });

  describe('shutdown — branch coverage', () => {
    it('shutdown of unknown serverId is a no-op (covers !handle early-return branch)', async () => {
      // Should not throw or error when server was never registered
      await expect(lifecycle.shutdown('never-registered')).resolves.toBeUndefined();
      expect(lifecycle.isRunning('never-registered')).toBe(false);
    });

    it('shutdown when kill() throws still removes handle (covers catch branch)', async () => {
      const throwingKill = vi.fn().mockRejectedValue(new Error('kill failed'));
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      lifecycle.registerHandle({ serverId: 'failing-server', pid: 9999, kill: throwingKill });
      expect(lifecycle.isRunning('failing-server')).toBe(true);

      await lifecycle.shutdown('failing-server');

      expect(throwingKill).toHaveBeenCalled();
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('kill failed'));
      expect(lifecycle.isRunning('failing-server')).toBe(false);

      stderrSpy.mockRestore();
    });
  });
});
