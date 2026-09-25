import { useState, useCallback, useEffect } from 'react';

const AUTH_KEY = 'automate_authenticated';

function getIsAuthenticated(): boolean {
  try {
    return sessionStorage.getItem(AUTH_KEY) === 'true';
  } catch {
    return false;
  }
}

function setAuthenticated(value: boolean): void {
  try {
    if (value) {
      sessionStorage.setItem(AUTH_KEY, 'true');
    } else {
      sessionStorage.removeItem(AUTH_KEY);
    }
  } catch {
    // sessionStorage unavailable
  }
}

export interface UseAuthReturn {
  isAuthenticated: boolean;
  login: (apiKey: string) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(getIsAuthenticated);

  useEffect(() => {
    let active = true;

    const syncWithServerSession = async () => {
      try {
        const response = await fetch('/api/auth/session');
        if (!active) return;

        if (!response.ok) {
          setAuthenticated(false);
          setIsAuthenticated(false);
          return;
        }

        const body = (await response.json().catch(() => null)) as
          | { authenticated?: boolean }
          | null;
        const authenticated = body?.authenticated === true;
        setAuthenticated(authenticated);
        setIsAuthenticated(authenticated);
      } catch {
        if (!active) return;
        setAuthenticated(false);
        setIsAuthenticated(false);
      }
    };

    void syncWithServerSession();

    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (apiKey: string): Promise<void> => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey }),
    });

    if (!response.ok) {
      throw new Error('Invalid API key');
    }

    setAuthenticated(true);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Ignore network errors on logout
    }
    setAuthenticated(false);
    setIsAuthenticated(false);
  }, []);

  return { isAuthenticated, login, logout };
}
