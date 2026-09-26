import { useCallback, useEffect, useState } from 'react';

type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated';
type Listener = (status: AuthStatus) => void;

let status: AuthStatus = 'checking';
let refreshPromise: Promise<void> | undefined;
const listeners = new Set<Listener>();

/**
 * Incremented on every reset.
 *
 * A refresh in flight when `resetAuthState()` is called still resolves
 * afterwards, and its `setStatus` would then overwrite the state the *next*
 * caller just established — so a logout did not take effect until some later
 * request, and a stale session flashed back. The generation lets a continuation
 * notice it belongs to a superseded attempt and drop its result.
 */
let generation = 0;

function setStatus(next: AuthStatus) {
  status = next;
  for (const listener of listeners) listener(next);
}

async function refreshSession(): Promise<void> {
  if (refreshPromise) return refreshPromise;
  const attempt = generation;
  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/v1/auth/session', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (attempt !== generation) return;
      setStatus(response.ok ? 'authenticated' : 'unauthenticated');
    } catch {
      if (attempt !== generation) return;
      setStatus('unauthenticated');
    } finally {
      // Only the attempt that is still current may clear the memo, or a
      // superseded request would unblock the next one mid-flight.
      if (attempt === generation) refreshPromise = undefined;
    }
  })();
  return refreshPromise;
}

export function resetAuthState(): void {
  generation += 1;
  status = 'checking';
  refreshPromise = undefined;
  listeners.clear();
}

export interface UseAuthReturn {
  isAuthenticated: boolean;
  isChecking: boolean;
  login: (apiKey: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [currentStatus, setCurrentStatus] = useState<AuthStatus>(status);

  useEffect(() => {
    const listener: Listener = (next) => setCurrentStatus(next);
    listeners.add(listener);
    if (status === 'checking') void refreshSession();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const login = useCallback(async (apiKey: string) => {
    const response = await fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apiKey }),
    });
    if (!response.ok) throw new Error('Invalid API key');
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Logout failed');
    setStatus('unauthenticated');
  }, []);

  return {
    isAuthenticated: currentStatus === 'authenticated',
    isChecking: currentStatus === 'checking',
    login,
    logout,
  };
}
