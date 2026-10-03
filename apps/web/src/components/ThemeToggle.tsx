import { Monitor, Moon, Sun } from '@automate/ui';
import { useTheme, type Theme } from '../theme/ThemeProvider.js';

/**
 * The theme control, and the only one.
 *
 * **It was a component and a copy.** `NavBar` rendered its own inline button with
 * the *same* `data-testid="theme-toggle"` — different label, different cycle order,
 * different accessible name — and this file was imported by nothing except its own
 * test and the axe sweep. Two controls for one setting, one of them reachable only
 * from a test, and a `getByTestId('theme-toggle')` that resolved to whichever one
 * the caller happened to render. `NavBar` now renders this, so there is one.
 *
 * **The cycle follows `THEMES` in `ThemeProvider`, and the other order was wrong.**
 * The inline copy went `light → dark → system → light`; this goes
 * `dark → light → system → dark`, which is the declaration order of the domain and
 * therefore the order a reader meets on first use — the provider's own default is
 * `system`, and pressing the button from the default lands on the theme the reader
 * is least likely to have been using. The old cycle put `system` third from `light`
 * and first from `dark`.
 */
const NEXT_THEME: Record<Theme, Theme> = {
  dark: 'light',
  light: 'system',
  system: 'dark',
};

/** The icon for each theme. `Monitor` for `system`, because that is what it means. */
const THEME_ICON = {
  dark: Moon,
  light: Sun,
  system: Monitor,
} as const;

/** How each theme is named in the accessible description. */
const THEME_LABEL: Record<Theme, string> = {
  dark: 'dark',
  light: 'light',
  system: 'your system setting',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const Icon = THEME_ICON[theme];
  const next = NEXT_THEME[theme];

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      data-testid="theme-toggle"
      className="p-2 rounded-md hover:bg-bg-muted text-text-secondary hover:text-text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      title={`Current theme: ${theme}. Click to change.`}
      /*
       * The name says where pressing it lands, not just that it is a toggle.
       *
       * It was the two words "Toggle theme" against a visible label of
       * `Theme: dark`, which is a WCAG 2.5.3 *Label in Name* failure: a voice
       * control user who says the words they can see gets nothing. There is no
       * visible text here any more — the label is an icon — so the name is free to
       * carry the whole sentence, which is more useful than "toggle" was.
       */
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}.`}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}
