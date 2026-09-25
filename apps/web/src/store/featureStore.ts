import { create } from 'zustand';

interface FeatureState {
  flags: Record<string, boolean>;
  loaded: boolean;
  fetchFlags: () => Promise<void>;
}

export const useFeatureStore = create<FeatureState>((set) => ({
  flags: {},
  loaded: false,
  fetchFlags: async () => {
    try {
      const res = await fetch('/api/features');
      const flags = await res.json();
      set({ flags, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

export function useFeature(flag: string): boolean {
  return useFeatureStore((s) => s.flags[flag] ?? false);
}
