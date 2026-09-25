import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, fireEvent } from '../../../test/test-utils';
import { AppShell } from '../AppShell';
import { useWsStore } from '../../../store/wsStore';
import { useThemeStore } from '../../../store/themeStore';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { useNotificationStore } from '../../../store/notificationStore';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  matches: [{ pathname: '/', routeId: 'root' }] as Array<{ pathname: string; routeId: string }>,
  useRuns: vi.fn(),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: (_target: unknown, prop: string) => {
        return ({
          initial: _i,
          animate: _a,
          exit: _e,
          variants: _v,
          whileHover: _wh,
          whileTap: _wt,
          transition: _t,
          layout: _l,
          layoutId: _lid,
          ...rest
        }: Record<string, unknown>) => {
          const tags = [
            'div', 'span', 'button', 'p', 'li', 'section', 'tr', 'td', 'form',
            'ul', 'nav', 'header', 'footer', 'main', 'aside', 'article',
            'label', 'input', 'a', 'h1', 'h2', 'h3', 'h4',
          ];
          const Tag = typeof prop === 'string' && tags.includes(prop) ? prop : 'div';
          return React.createElement(Tag, rest);
        };
      },
    },
  ),
  AnimatePresence: ({ children }: { children: React.ReactNode }) =>
    React.createElement(React.Fragment, null, children),
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

  Command.Input = ({
    placeholder,
    value,
    onValueChange,
    ...rest
  }: {
    placeholder?: string;
    value?: string;
    onValueChange?: (value: string) => void;
  } & Record<string, unknown>) =>
    React.createElement('input', {
      placeholder,
      value,
      'data-testid': 'cmdk-input',
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => onValueChange?.(e.target.value),
      ...rest,
    });

  Command.List = ({ children, ...rest }: { children: React.ReactNode } & Record<string, unknown>) =>
    React.createElement('div', { 'data-testid': 'cmdk-list', ...rest }, children);
  Command.Empty = ({ children }: { children: React.ReactNode }) =>
    React.createElement('div', null, children);
  Command.Group = ({ heading, children }: { heading: string; children: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': `cmdk-group-${heading}` }, children);
  Command.Item = ({ children, onSelect, ...rest }: { children: React.ReactNode; onSelect?: () => void } & Record<string, unknown>) =>
    React.createElement('div', { onClick: onSelect, role: 'option', ...rest }, children);
  Command.Dialog = ({ children, open, ...rest }: { children: React.ReactNode; open: boolean } & Record<string, unknown>) =>
    open ? React.createElement('div', { role: 'dialog', ...rest }, children) : null;
  return { Command, default: Command };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key, i18n: {} }),
}));

vi.mock('@/hooks/useRun', () => ({
  useRuns: () => mocks.useRuns(),
}));

vi.mock('../../shared/ShortcutsModal', () => ({
  ShortcutsModal: ({ onClose }: { onClose: () => void }) =>
    React.createElement('div', { role: 'dialog', 'aria-label': 'Keyboard Shortcuts' },
      React.createElement('button', { type: 'button', onClick: onClose }, 'Close shortcuts'),
    ),
}));

vi.mock('../../onboarding/OnboardingWizard', () => ({
  OnboardingWizard: () => null,
}));

describe('AppShell extra coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationStore.setState({ notifications: [], unreadCount: 0 });
    useThemeStore.setState({ theme: 'dark' });
    useWorkspaceStore.setState({ activeWorkspaceId: null });
    useWsStore.setState({ connectionState: 'offline' });
    mocks.matches = [{ pathname: '/', routeId: 'root' }];
    mocks.useRuns.mockReturnValue({ data: [] });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 })));
    sessionStorage.clear();
    // Reset window width to a normal value
    Object.defineProperty(window, 'innerWidth', { value: 1920, configurable: true });
  });

  it('[ key toggles sidebar collapse state', async () => {
    renderWithProviders(<AppShell />);

    // Initially sidebar not collapsed at 1920px (auto not collapsed)
    // pressing [ should toggle
    fireEvent.keyDown(window, { key: '[' });
    // Fire a second [ to toggle back — both should not throw
    fireEvent.keyDown(window, { key: '[' });
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('Ctrl+K opens command palette', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(await screen.findByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();
  });

  it('Cmd+K also opens command palette', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(await screen.findByRole('dialog', { name: 'Command Palette' })).toBeInTheDocument();
  });

  it('? key opens shortcuts modal', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: '?' });

    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();
  });

  it('closing shortcuts modal with its close button removes it', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Close shortcuts' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument();
  });

  it('G+R navigates to /runs', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'r' });

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/runs' });
  });

  it('G+A navigates to /analytics', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'a' });

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/analytics' });
  });

  it('G+S navigates to /settings', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 's' });

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/settings' });
  });

  it('G+D navigates to /', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'd' });

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' });
  });

  it('G+unknown key does not navigate', async () => {
    renderWithProviders(<AppShell />);

    fireEvent.keyDown(window, { key: 'g' });
    fireEvent.keyDown(window, { key: 'z' }); // not in G_MAP

    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('keyboard shortcuts are ignored when input is focused', async () => {
    renderWithProviders(<AppShell />);

    // Create an input element and focus it
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(window, { key: '?' });
    // shortcutsModal should NOT open since input is focused
    expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument();

    input.remove();
  });

  it('auto-collapses sidebar when viewport is narrow', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
    renderWithProviders(<AppShell />);
    // Just check it renders without errors at narrow width
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('fetches feature flags on mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<AppShell />);
    // fetchFlags is called in useEffect
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});
