import { useTheme } from '../theme/ThemeProvider.js';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  const handleToggle = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('system');
    else setTheme('dark');
  };

  return (
    <button
      onClick={handleToggle}
      data-testid="theme-toggle"
      className="p-2 rounded-md hover:bg-[var(--color-surface-muted)] text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      title={`Current theme: ${theme}. Click to change.`}
    >
      {theme === 'dark' && <span aria-hidden="true">🌙</span>}
      {theme === 'light' && <span aria-hidden="true">☀️</span>}
      {theme === 'system' && <span aria-hidden="true">🖥️</span>}
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
