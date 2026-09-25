import { create } from 'zustand';

type FeatureFlags = Record<string, boolean>;

interface FeatureState {
  flags: FeatureFlags;
  loaded: boolean;
  error: string | null;
  fetchFlags: () => Promise<void>;
}

export const useFeatureStore = create<FeatureState>((set, get) => ({
  flags: {},
  loaded: false,
  error: null,
  fetchFlags: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch('/api/features');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const flags = await res.json();
      set({ flags, loaded: true, error: null });
    } catch (err) {
      set({ error: (err as Error).message, loaded: true });
    }
  },
}));

/** Hook: returns whether a feature flag is enabled. Defaults to false if not loaded. */
export function useFeature(flag: string): boolean {
  return useFeatureStore((s) => s.flags[flag] ?? false);
}
