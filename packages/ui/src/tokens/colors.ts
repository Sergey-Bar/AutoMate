/**
 * The single TypeScript source for the design tokens.
 *
 * This file owns the *ramps* and the *semantic token names*. The shipped CSS
 * (`theme.css`, imported by `apps/web/src/index.css`) owns the light/dark
 * values for those names. `theme.test.ts` fails if the two drift, and
 * `apps/web/src/theme-resolution.test.ts` fails if Tailwind does not actually
 * emit CSS for a utility a component uses — which is the check that would have
 * caught the unstyled destructive button.
 *
 * The previous arrangement had two independent token systems, one of which
 * (`tokens/colors.ts`, imported only by its own test) referenced
 * `var(--color-*)` values that nothing defined, so `bg-error`,
 * `text-text-muted`, `bg-brand-50`, `bg-bg-base`, `text-success-500` and
 * `text-error-500` resolved to nothing and rendered unstyled.
 */

export type ColorRamp = Readonly<Record<string, string>>;

/** 11-step ramps, Tailwind convention: 50 is lightest, 950 is darkest. */
export const ramps = {
  neutral: {
    50: '#fafafa',
    100: '#f5f5f5',
    200: '#e5e5e5',
    300: '#d4d4d4',
    400: '#a3a3a3',
    500: '#737373',
    600: '#525252',
    700: '#404040',
    800: '#262626',
    900: '#171717',
    950: '#0a0a0a',
  },
  blue: {
    50: '#eff6ff',
    100: '#dbeafe',
    200: '#bfdbfe',
    300: '#93c5fd',
    400: '#60a5fa',
    500: '#3b82f6',
    600: '#2563eb',
    700: '#1d4ed8',
    800: '#1e40af',
    900: '#1e3a8a',
    950: '#172554',
  },
  green: {
    50: '#f0fdf4',
    100: '#dcfce7',
    200: '#bbf7d0',
    300: '#86efac',
    400: '#4ade80',
    500: '#22c55e',
    600: '#16a34a',
    700: '#15803d',
    800: '#166534',
    900: '#14532d',
    950: '#052e16',
  },
  amber: {
    50: '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
    950: '#451a03',
  },
  red: {
    50: '#fef2f2',
    100: '#fee2e2',
    200: '#fecaca',
    300: '#fca5a5',
    400: '#f87171',
    500: '#ef4444',
    600: '#dc2626',
    700: '#b91c1c',
    800: '#991b1b',
    900: '#7f1d1d',
    950: '#450a0a',
  },
} as const satisfies Record<string, ColorRamp>;

/**
 * The semantic token names that must exist in the shipped theme.
 *
 * The value is the `--automate-*` variable the CSS maps the name onto, so a
 * name here with no mapping in `theme.css` is a drift the test catches.
 */
export const semanticColorTokens = {
  surface: '--automate-surface',
  'surface-muted': '--automate-surface-muted',
  fg: '--automate-fg',
  'fg-muted': '--automate-fg-muted',
  border: '--automate-border',
  accent: '--automate-accent',
  primary: '--automate-accent',
  success: '--automate-success',
  warning: '--automate-warning',
  danger: '--automate-danger',
  info: '--automate-info',
  /**
   * `error` is the name the components use (`bg-error` is the destructive
   * "Cancel run" button). It is an alias of `danger`, kept because renaming
   * every call site would be churn without changing the rendered colour.
   */
  error: '--automate-danger',
  'text-primary': '--automate-fg',
  'text-secondary': '--automate-fg-muted',
  'text-muted': '--automate-fg-muted',
  'bg-primary': '--automate-surface',
  'bg-base': '--automate-surface',
  'bg-elevated': '--automate-surface-muted',
  'bg-secondary': '--automate-surface-muted',
  'bg-muted': '--automate-surface-muted',
  'border-default': '--automate-border',
  'border-focus': '--automate-accent',
  'brand-500': '--automate-accent',
  'brand-50': '--automate-surface-muted',
  'brand-700': '--automate-accent',
  'success-500': '--automate-success',
  'error-500': '--automate-danger',
} as const satisfies Record<string, string>;

/** Colour names Tailwind resolves without a theme entry. */
export const builtInColorNames = ['black', 'white', 'transparent', 'current', 'inherit'] as const;

export const colors = ramps;
