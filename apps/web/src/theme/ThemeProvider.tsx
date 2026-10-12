import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'dark';

/** The single theme - dark only. */
const THEME: Theme = 'dark';

export interface ThemeProviderProps {
  children: ReactNode;
  storageKey?: string;
}

export interface ThemeProviderState {
  theme: Theme;
  /** A no-op. The product ships one theme, so there is nothing to set. */
  setTheme: () => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({ children, storageKey = 'automate-theme' }: ThemeProviderProps) {
  const [theme, _setThemeState] = useState<Theme>(THEME);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const root = window.document.documentElement;
    root.setAttribute('data-theme', theme);
    // Ensure localStorage is set to dark for consistency
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, theme);
    }
  }, [theme]);

  const setTheme = () => {
    // No-op - theme is fixed to dark
  };

  const value = {
    theme,
    setTheme,
  };

  return <ThemeProviderContext.Provider value={value}>{children}</ThemeProviderContext.Provider>;
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider');
  return context;
};
