import { create } from 'zustand';

interface AuthState {
  enabled: boolean;
  authenticated: boolean;
  loading: boolean;
  error: string | null;
  role: 'admin' | 'editor' | 'viewer';
  checkAuthStatus: () => Promise<void>;
  login: (apiKey: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  enabled: false,
  authenticated: false,
  loading: false,
  error: null,
  role: 'admin',

  checkAuthStatus: async () => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/auth/status', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { enabled: boolean; authenticated: boolean };
      set({
        enabled: data.enabled,
        authenticated: data.authenticated,
        loading: false,
        error: null,
      });
    } catch (err) {
      set({
        loading: false,
        error: (err as Error).message,
      });
    }
  },

  login: async (apiKey: string) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      set({ authenticated: true, loading: false, error: null });
      return true;
    } catch (err) {
      set({ authenticated: false, loading: false, error: (err as Error).message });
      return false;
    }
  },

  logout: async () => {
    set({ loading: true, error: null });
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
      set({ authenticated: false, loading: false, error: null });
    } catch (err) {
      set({ authenticated: false, loading: false, error: (err as Error).message });
    }
  },
}));

export function useUserRole(): AuthState['role'] {
  return useAuthStore((s) => s.role);
}
