import { useThemeStore, type ThemeMode } from '@/store/themeStore';
import { Sun, Moon, Monitor } from 'lucide-react';

const THEME_CYCLE: ThemeMode[] = ['dark', 'light', 'system'];
const THEME_ICON: Record<ThemeMode, typeof Sun> = { dark: Moon, light: Sun, system: Monitor };
const THEME_LABEL: Record<ThemeMode, string> = { dark: 'Dark', light: 'Light', system: 'System' };

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const Icon = THEME_ICON[theme];

  const cycle = () => {
    const idx = THEME_CYCLE.indexOf(theme);
    setTheme(THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className="flex items-center gap-1.5 px-2 py-1 rounded text-xs border transition-colors icon-btn-hover"
      style={{
        color: 'var(--color-text-tertiary)',
        borderColor: 'var(--color-border-default)',
      }}
      title={`Theme: ${THEME_LABEL[theme]}`}
      aria-label={`Switch theme (current: ${THEME_LABEL[theme]})`}
    >
      <Icon size={13} />
      <span className="hidden sm:inline">{THEME_LABEL[theme]}</span>
    </button>
  );
}
