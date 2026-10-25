import React from 'react';

/**
 * Three ways to make the dashboard quieter, kept beside the theme and persisted per browser.
 *
 *  - **Focus** hides the secondary navigation (section tabs, bottom tab bar), so a page is
 *    the page and nothing else. The command palette and the shortcuts still go everywhere.
 *  - **Density** compact scales the whole rem-based layout down by one step.
 *  - **Motion** reduced sets the one motion multiplier `motion.css` reads to its floor. It
 *    starts from the operating system's `prefers-reduced-motion`, and a person can override it.
 *
 * Each is a `data-*` attribute on `<html>` that `index.css` reads, so no component needs to
 * know about any of them and every token keeps its meaning.
 */
export interface Preferences {
  focus: boolean;
  density: 'comfortable' | 'compact';
  motion: 'full' | 'reduced';
}

export const PREFERENCES_KEY = 'automate-preferences';

function systemMotion(): Preferences['motion'] {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    ? 'reduced'
    : 'full';
}

/** Validated rather than cast: localStorage is a string anyone can edit. */
export function readPreferences(raw: string | null): Preferences {
  const defaults: Preferences = { focus: false, density: 'comfortable', motion: systemMotion() };
  if (raw === null) return defaults;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      focus: parsed['focus'] === true,
      density: parsed['density'] === 'compact' ? 'compact' : 'comfortable',
      motion:
        parsed['motion'] === 'reduced' || parsed['motion'] === 'full'
          ? parsed['motion']
          : defaults.motion,
    };
  } catch {
    return defaults;
  }
}

interface PreferencesState {
  preferences: Preferences;
  update: (change: Partial<Preferences>) => void;
}

const PreferencesContext = React.createContext<PreferencesState>({
  preferences: { focus: false, density: 'comfortable', motion: 'full' },
  update: () => undefined,
});

export function PreferencesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [preferences, setPreferences] = React.useState<Preferences>(() =>
    readPreferences(localStorage.getItem(PREFERENCES_KEY)),
  );
  React.useEffect(() => {
    const root = document.documentElement;
    root.dataset['focus'] = preferences.focus ? 'on' : 'off';
    root.dataset['density'] = preferences.density;
    root.dataset['motion'] = preferences.motion;
  }, [preferences]);
  const update = React.useCallback((change: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...change };
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  const value = React.useMemo(() => ({ preferences, update }), [preferences, update]);
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): PreferencesState {
  return React.useContext(PreferencesContext);
}
