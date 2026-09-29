import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export type Theme = 'dark' | 'light' | 'system';

export interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
}

export interface ThemeProviderState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(undefined);

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = 'automate-theme',
}: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme !== 'system') {
      root.setAttribute('data-theme', theme);
      return;
    }

    // In system mode the OS is the source of truth, so this subscribes rather than
    // asking once.
    //
    // It used to ask once and return, which meant a reader on the default theme —
    // the only setting that promises to follow the system — got the answer at page
    // load and nothing after it. Switching the OS to dark at 6pm left them on a
    // white page until they reloaded, and nothing looked wrong (ledger W-9).
    if (typeof window === 'undefined' || !window.matchMedia) {
      root.setAttribute('data-theme', 'light');
      return;
    }
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    // One named handler, referenced by both `addEventListener` and the cleanup.
    // A second arrow in the cleanup would not be the same function, so
    // `removeEventListener` would silently do nothing and the listener would
    // outlive the provider.
    const onChange = (event: MediaQueryListEvent) =>
      root.setAttribute('data-theme', event.matches ? 'dark' : 'light');
    root.setAttribute('data-theme', query.matches ? 'dark' : 'light');
    query.addEventListener('change', onChange);
    // Unsubscribed, or a provider that unmounts and remounts — which a route
    // change does — leaves a listener behind holding a closure for the life of
    // the page, and each of them would write the attribute again.
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, [theme]);

  const setTheme = (newTheme: Theme) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, newTheme);
    }
    setThemeState(newTheme);
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
