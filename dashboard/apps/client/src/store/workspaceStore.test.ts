/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/queryClient', () => ({
  queryClient: {
    invalidateQueries: vi.fn(),
  },
}));

import { useWorkspaceStore } from './workspaceStore';
import { queryClient } from '@/lib/queryClient';

describe('workspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    vi.mocked(queryClient.invalidateQueries).mockClear();
  });

  describe('initial state', () => {
    it('defaults to null active workspace', () => {
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    });
  });

  describe('setActiveWorkspaceId', () => {
    it('sets the active workspace id', () => {
      useWorkspaceStore.getState().setActiveWorkspaceId('ws-1');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    });

    it('invalidates queries on workspace change', () => {
      useWorkspaceStore.getState().setActiveWorkspaceId('ws-1');
      expect(queryClient.invalidateQueries).toHaveBeenCalled();
    });

    it('can set back to null', () => {
      useWorkspaceStore.getState().setActiveWorkspaceId('ws-1');
      useWorkspaceStore.getState().setActiveWorkspaceId(null);
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    });

    it('invalidates queries each time workspace changes', () => {
      useWorkspaceStore.getState().setActiveWorkspaceId('ws-1');
      useWorkspaceStore.getState().setActiveWorkspaceId('ws-2');
      expect(queryClient.invalidateQueries).toHaveBeenCalledTimes(2);
    });
  });
});
