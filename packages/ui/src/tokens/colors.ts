export const colors = {
  // 11-step ramps (dark-first, meaning 50 is darkest? or 950 is darkest? Usually 50 is lightest in Tailwind, let's stick to standard so we don't confuse users)
  // Wait, if it's dark-first, maybe 50 is darkest. But Tailwind convention is 50=light, 900=dark. Let's stick to tailwind convention for the ramp, but semantic tokens map to dark colors.
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

  // Semantic tokens (using var references with fallbacks to the hex)
  surface: 'var(--color-surface, #0a0a0a)', // neutral.950
  'surface-muted': 'var(--color-surface-muted, #171717)', // neutral.900
  border: 'var(--color-border, #262626)', // neutral.800
  fg: 'var(--color-fg, #fafafa)', // neutral.50
  'fg-muted': 'var(--color-fg-muted, #a3a3a3)', // neutral.400
  accent: 'var(--color-accent, #3b82f6)', // blue.500
  success: 'var(--color-success, #22c55e)', // green.500
  warning: 'var(--color-warning, #f59e0b)', // amber.500
  danger: 'var(--color-danger, #ef4444)', // red.500
  info: 'var(--color-info, #3b82f6)', // blue.500
};
