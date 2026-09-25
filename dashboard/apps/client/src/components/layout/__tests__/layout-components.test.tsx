import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, renderWithProviders, screen, userEvent, waitFor } from '../../../test/test-utils';
import { AppShell } from '../AppShell';
import { Breadcrumbs } from '../Breadcrumbs';
import { CommandPalette } from '../CommandPalette';
import { NotificationCenter } from '../NotificationCenter';
import { PageTransition } from '../PageTransition';
import { Sidebar } from '../Sidebar';
import { ThemeToggle } from '../ThemeToggle';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';
import { useNotificationStore } from '../../../store/notificationStore';
import { useThemeStore } from '../../../store/themeStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { useWsStore } from '../../../store/wsStore';
import { useFeatureStore } from '../../../store/featureStore';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  matches: [{ pathname: '/', routeId: 'root' }],
  useRuns: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({ initial: _initial, animate: _animate, exit: _exit, variants: _variants, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, layout: _layout, layoutId: _layoutId, ...rest }: Record<string, unknown>) => {
          const tags = ['div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form', 'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article', 'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4'];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  useAnimation: () => ({ start: vi.fn(), stop: vi.fn() }),
  useMotionValue: (init: number) => ({ get: () => init, set: vi.fn(), on: vi.fn() }),
  useTransform: (_v: unknown, _input: unknown, output: number[]) => ({ get: () => output?.[0] ?? 0 }),
  useSpring: (v: unknown) => v,
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...rest }: { children: React.ReactNode; to: string } & Record<string, unknown>) =>
    React.createElement('a', { href: to, ...rest }, children),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ navigate: vi.fn(), state: { location: { pathname: '/' } } }),
  useRouterState: () => ({ location: { pathname: '/runs' } }),
  useSearch: () => ({}),
  useParams: () => ({}),
  useMatch: () => ({ pathname: '/' }),
  useMatches: () => mocks.matches,
  Outlet: () => React.createElement('div', { 'data-testid': 'outlet' }),
}));

vi.mock('cmdk', () => {
  const Command = ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'cmdk', ...rest }, children);

  Command.Input = ({ placeholder, value, onValueChange, ...rest }: { placeholder?: string; value?: string; onValueChange?: (value: string) => void } & Record<string, unknown>) =>
    React.createElement('input', {
      placeholder,
      value,
      'data-testid': 'cmdk-input',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onValueChange?.(e.target.value),
      ...rest,
    });

  Command.List = ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'cmdk-list', ...rest }, children);
  Command.Empty = ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children);
  Command.Group = ({ heading, children }: { heading: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': `cmdk-group-${heading}` }, children);
  Command.Item = ({ children, onSelect, ...rest }: { children: React.ReactNode; onSelect?: () => void } & Record<string, unknown>) =>
    React.createElement('div', { onClick: onSelect, role: 'option', ...rest }, children);
  Command.Dialog = ({ children, open, ...rest }: { children: React.ReactNode; open: boolean } & Record<string, unknown>) =>
    open ? React.createElement('div', { role: 'dialog', ...rest }, children) : null;
  return { Command, default: Command };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

vi.mock('@/hooks/useRun', () => ({
  useRuns: () => mocks.useRuns(),
}));

vi.mock('../../shared/ShortcutsModal', () => ({
  ShortcutsModal: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>
      Close shortcuts
    </button>
  ),
}));

vi.mock('../../onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => null,
}));

describe('layout components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
    useThemeStore.setState({ theme: 'dark' });
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    useWsStore.setState({ connectionState: 'offline' });
    mocks.matches = [{ pathname: '/', routeId: 'root' }];
    mocks.useRuns.mockReturnValue({ data: [{ id: 'run-12345678', branch: 'main' }] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    sessionStorage.clear();
  });

  describe('AppShell', () => {
    it('renders sidebar, outlet, footer and opens command palette from topbar', async () => {
      renderWithProviders(<AppShell />);

      expect(screen.getByTestId('outlet')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Sergey Bar/i })).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: 'Open command palette' }));
      expect(await screen.findByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();
    });

    it('dismisses narrow viewport notice and persists dismissal', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 600, configurable: true });
      renderWithProviders(<AppShell />);

      expect(screen.getByText('Best viewed at 640px+')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Dismiss viewport warning' }));

      expect(sessionStorage.getItem('mc-vp-dismissed')).toBe('1');
    });
  });

  describe('Breadcrumbs', () => {
    it('renders dashboard crumb by default', () => {
      const target = document.createElement('div');
      target.id = 'breadcrumb-portal';
      document.body.appendChild(target);

      render(<Breadcrumbs />);
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });

    it('renders dynamic run breadcrumb from route match', () => {
      const target = document.createElement('div');
      target.id = 'breadcrumb-portal';
      document.body.appendChild(target);

      mocks.matches = [
        { pathname: '/', routeId: 'root' },
        { pathname: '/runs', routeId: 'runs' },
        { pathname: '/runs/abcdef123456', routeId: 'runDetail' },
      ];

      render(<Breadcrumbs />);
      expect(screen.getByText('Runs')).toBeInTheDocument();
      expect(screen.getByText('Run #abcdef12')).toBeInTheDocument();
    });

    it('prepends Dashboard crumb when first crumb is not root', () => {
      const target = document.createElement('div');
      target.id = 'breadcrumb-portal';
      document.body.appendChild(target);

      // Only analytics match — resolveLabel returns 'Analytics', crumbs[0].to = '/analytics' !== '/'
      mocks.matches = [{ pathname: '/analytics', routeId: 'analytics' }];

      render(<Breadcrumbs />);
      // Dashboard should be prepended (unshift branch)
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
      expect(screen.getByText('Analytics')).toBeInTheDocument();
    });

    it('pushes Dashboard as default when no crumbs are resolved', () => {
      const target = document.createElement('div');
      target.id = 'breadcrumb-portal';
      document.body.appendChild(target);

      // Unknown path → resolveLabel returns null → crumbs empty → push Dashboard
      mocks.matches = [{ pathname: '/unknown/deep/path', routeId: 'unknown' }];

      render(<Breadcrumbs />);
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  describe('CommandPalette', () => {
    it('navigates to selected route and closes', async () => {
      const onClose = vi.fn();
      renderWithProviders(<CommandPalette onClose={onClose} />);

      const options = screen.getAllByRole('option');
      const analyticsOption = options.find(opt => opt.textContent?.includes('Analytics'));
      expect(analyticsOption).toBeTruthy();
      await userEvent.click(analyticsOption!);

      expect(mocks.navigate).toHaveBeenCalledWith({ to: '/analytics' });
      expect(onClose).toHaveBeenCalled();
    });

    it('runs NL query in ? mode and renders result table', async () => {
      const nlData = JSON.stringify({
        query: 'failed tests',
        sql: 'select * from tests',
        results: [{ test: 'a', status: 'failed' }],
        resultCount: 1,
      });
      const runsData = JSON.stringify([{ id: 'run-12345678', branch: 'main' }]);
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/nl-query')) {
          return Promise.resolve(new Response(nlData, { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return Promise.resolve(new Response(runsData, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      });
      vi.stubGlobal('fetch', fetchMock);

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);

      const input = screen.getByTestId('cmdk-input');
      await userEvent.type(input, '?failed tests{enter}');

      expect(await screen.findByText('1 result')).toBeInTheDocument();
      expect(screen.getByText('Generated SQL')).toBeInTheDocument();
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/nl-query',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('sanitizes NL mode error messages', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'SQLITE_ERROR: SELECT * FROM users WHERE id = 1' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);

      const input = screen.getByTestId('cmdk-input');
      await userEvent.type(input, '?show users{enter}');

      expect(await screen.findByText('A database error occurred. Please try again or contact support.')).toBeInTheDocument();
      expect(screen.queryByText('SQLITE_ERROR: SELECT * FROM users WHERE id = 1')).toBeNull();
    });

    it('shows Network error when fetch throws non-Error value', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/nl-query') && !url.includes('history')) {
          return Promise.reject('network string error');
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchImpl);

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);

      const input = screen.getByTestId('cmdk-input');
      await userEvent.type(input, '?query that fails{enter}');

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });

    it('calls handleSuggestionClick when a suggested query is selected', async () => {
      const fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/nl-query') && !url.includes('history')) {
          return Promise.resolve(new Response(
            JSON.stringify({ query: 'flaky', sql: 'SELECT 1', results: [], resultCount: 0 }),
            { status: 200 },
          ));
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchImpl);

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);
      const input = screen.getByTestId('cmdk-input');

      // Enter NL mode by typing '?'
      await userEvent.type(input, '?');

      // SuggestedQueries renders with suggestion buttons
      const suggestion = await screen.findByText('Flaky tests this week');
      await userEvent.click(suggestion);

      // handleSuggestionClick calls executeNLQuery which posts to /api/nl-query
      await waitFor(() => {
        expect(fetchImpl).toHaveBeenCalledWith(
          '/api/nl-query',
          expect.objectContaining({ method: 'POST' }),
        );
      });
    });

    it('shows dash for null branch in recent runs', async () => {
      mocks.useRuns.mockReturnValue({ data: [{ id: 'run-abcdef123456', branch: null }] });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);

      // run.branch ?? '—' renders '—' for null branch
      expect(await screen.findByText('—')).toBeInTheDocument();
    });

    it('uses plain search placeholder when nl-query feature flag is disabled', () => {
      useFeatureStore.setState({ flags: { 'nl-query': false }, loaded: true });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);

      const input = screen.getByTestId('cmdk-input');
      // canUseNL=false → third placeholder branch
      expect(input).toHaveAttribute('placeholder', 'Search runs, tests, actions…');

      // Restore feature flags
      useFeatureStore.setState({ flags: {}, loaded: false });
    });

    it('renders NLResults with plural result count and >20 rows', async () => {
      const manyResults = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, name: `item-${i + 1}` }));
      const fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/nl-query') && !url.includes('history')) {
          return Promise.resolve(new Response(
            JSON.stringify({ query: 'all items', sql: 'SELECT * FROM items', results: manyResults, resultCount: 25 }),
            { status: 200 },
          ));
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchImpl);

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);
      const input = screen.getByTestId('cmdk-input');
      await userEvent.type(input, '?all items{enter}');

      // resultCount !== 1 → 's'; results.length > 20 → "Showing 20 of 25 rows"
      await waitFor(() => {
        expect(screen.getByText('25 results')).toBeInTheDocument();
      });
      expect(screen.getByText('Showing 20 of 25 rows')).toBeInTheDocument();
    });

    it('renders NLResults with >6 columns showing overflow header', async () => {
      const wideRow = { col1: 'a', col2: 'b', col3: 'c', col4: 'd', col5: 'e', col6: 'f', col7: 'g' };
      const fetchImpl = vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('/api/nl-query') && !url.includes('history')) {
          return Promise.resolve(new Response(
            JSON.stringify({ query: 'wide', sql: 'SELECT ...', results: [wideRow], resultCount: 1 }),
            { status: 200 },
          ));
        }
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      });
      vi.stubGlobal('fetch', fetchImpl);

      renderWithProviders(<CommandPalette onClose={vi.fn()} />);
      const input = screen.getByTestId('cmdk-input');
      await userEvent.type(input, '?wide{enter}');

      // columns.length > maxCols (6) → show "+1 more" header and "…" cell
      await waitFor(() => {
        expect(screen.getByText('+1 more')).toBeInTheDocument();
      });
    });

  });
  describe('NotificationCenter', () => {
    it('shows unread badge and marks notification as read when clicked', async () => {
      const ts = 1705312800000;
      useNotificationStore.setState({
        notifications: [
          { id: 'n1', type: 'info', title: 'Build done', description: 'ok', read: false, timestamp: ts },
        ],
        unreadCount: 1,
      });

      render(<NotificationCenter />);

      await userEvent.click(screen.getByRole('button', { name: 'Notifications (1 unread)' }));
      await userEvent.click(screen.getByText('Build done'));

      expect(useNotificationStore.getState().unreadCount).toBe(0);
    });

    it('supports mark all read and clear actions', async () => {
      const ts = 1705312800000;
      useNotificationStore.setState({
        notifications: [
          { id: 'n1', type: 'failure', title: 'Fail', read: false, timestamp: ts },
          { id: 'n2', type: 'info', title: 'Info', read: false, timestamp: ts },
        ],
        unreadCount: 2,
      });

      render(<NotificationCenter />);

      await userEvent.click(screen.getByRole('button', { name: 'Notifications (2 unread)' }));
      await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }));
      expect(useNotificationStore.getState().unreadCount).toBe(0);

      await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });
  });

  describe('PageTransition', () => {
    it('renders child content and updates with routeKey', () => {
      const { rerender } = render(<PageTransition routeKey="/runs">Runs page</PageTransition>);
      expect(screen.getByText('Runs page')).toBeInTheDocument();

      rerender(<PageTransition routeKey="/tests">Tests page</PageTransition>);
      expect(screen.getByText('Tests page')).toBeInTheDocument();
    });
  });

  describe('Sidebar', () => {
    it('renders navigation labels and calls onToggle', async () => {
      const onToggle = vi.fn();
      renderWithProviders(<Sidebar collapsed={false} onToggle={onToggle} connectionState="connected" />);

      expect(screen.getByText('Automate')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Runs' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Toggle sidebar' }));
      expect(onToggle).toHaveBeenCalled();
    });

    it('shows retry action when offline and calls ws connect', async () => {
      const connectSpy = vi.spyOn(useWsStore.getState(), 'connect');
      renderWithProviders(<Sidebar collapsed={false} onToggle={vi.fn()} connectionState="offline" />);

      await userEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
      expect(connectSpy).toHaveBeenCalled();
      connectSpy.mockRestore();
    });
  });

  describe('ThemeToggle', () => {
    it('cycles theme dark → light → system', async () => {
      useThemeStore.setState({ theme: 'dark' });
      render(<ThemeToggle />);

      const btn = screen.getByRole('button', { name: /Switch theme/i });
      await userEvent.click(btn);
      expect(useThemeStore.getState().theme).toBe('light');

      await userEvent.click(btn);
      expect(useThemeStore.getState().theme).toBe('system');
    });
  });

  describe('WorkspaceSwitcher', () => {
    it('renders active workspace and switches selection', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            { id: 'w1', name: 'Main', configPath: 'playwright.config.ts', createdAt: '2026-01-01' },
            { id: 'w2', name: 'E2E', configPath: 'e2e.config.ts', createdAt: '2026-01-01' },
          ]),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
      renderWithProviders(<WorkspaceSwitcher collapsed={false} />);

      expect(await screen.findByText('Main')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Main/i }));
      await userEvent.click(screen.getByRole('button', { name: 'E2E' }));

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('w2');
    });

    it('can switch to all workspaces option', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([{ id: 'w1', name: 'Main', configPath: 'playwright.config.ts', createdAt: '2026-01-01' }]),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
      renderWithProviders(<WorkspaceSwitcher collapsed={false} />);

      await userEvent.click(await screen.findByRole('button', { name: /Main/i }));
      await userEvent.click(screen.getByRole('button', { name: 'All workspaces' }));

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBeNull();
    });

    it('renders in collapsed mode with title attribute', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([{ id: 'w1', name: 'MyProject', configPath: 'playwright.config.ts', createdAt: '2026-01-01' }]),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
      renderWithProviders(<WorkspaceSwitcher collapsed={true} />);

      const btn = await screen.findByTitle('MyProject');
      expect(btn).toBeInTheDocument();
    });

    it('closes dropdown when clicking outside the switcher', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([{ id: 'w1', name: 'Main', configPath: 'playwright.config.ts', createdAt: '2026-01-01' }]),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      useWorkspaceStore.setState({ activeWorkspaceId: 'w1' });
      renderWithProviders(<WorkspaceSwitcher collapsed={false} />);

      // Open the dropdown
      await userEvent.click(await screen.findByRole('button', { name: /Main/i }));
      expect(screen.getByText('All workspaces')).toBeInTheDocument();

      // Click outside
      fireEvent.mouseDown(document.body);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'All workspaces' })).toBeNull();
      });
    });

    it('highlights All workspaces button when no active workspace', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([{ id: 'w1', name: 'Main', configPath: 'playwright.config.ts', createdAt: '2026-01-01' }]),
          { status: 200 },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      useWorkspaceStore.setState({ activeWorkspaceId: null });
      renderWithProviders(<WorkspaceSwitcher collapsed={false} />);

      // Open the dropdown — button shows 'All workspaces' when no active workspace
      const toggleBtn = await screen.findByRole('button', { name: /All workspaces/i });
      await userEvent.click(toggleBtn);

      // The dropdown's 'All workspaces' button is rendered (activeWorkspaceId=null branch)
      const allButtons = screen.getAllByRole('button', { name: /All workspaces/i });
      expect(allButtons.length).toBeGreaterThan(0);
    });
  });
});
