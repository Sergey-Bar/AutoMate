import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { queryClient } from '@/lib/queryClient';

export interface Workspace {
  id: string;
  name: string;
  configPath: string;
  testResultsDir?: string | null;
  createdAt: string;
}

interface WorkspaceState {
  activeWorkspaceId: string | null;
  setActiveWorkspaceId: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      activeWorkspaceId: null,
      setActiveWorkspaceId: (id) => {
        set({ activeWorkspaceId: id });
        queryClient.invalidateQueries();
      },
    }),
    { name: 'mc-workspace' },
  ),
);
