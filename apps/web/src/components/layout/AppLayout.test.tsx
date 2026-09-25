/* eslint-disable @typescript-eslint/no-require-imports */
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ location: { href: '/' } }),
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (require('react') as any).createElement('a', { href: to, className }, children),
  Outlet: () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (require('react') as any).createElement('div', { 'data-testid': 'outlet' }),
}));

// Mock ThemeToggle
vi.mock('./ThemeToggle.js', () => ({
  ThemeToggle: () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (require('react') as any).createElement('div', { 'data-testid': 'theme-toggle' }),
}));

// Mock ConnectedConversationSidebar
vi.mock('../chat/conversation-sidebar.js', () => ({
  ConnectedConversationSidebar: () =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (require('react') as any).createElement('div', { 'data-testid': 'conversation-sidebar' }),
}));

import { AppLayout } from './AppLayout.js';
import * as useEmbeddedMode from '../../hooks/useEmbeddedMode.js';

describe('AppLayout', () => {
  it('renders the Automate brand name', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('Automate');
  });

  it('renders navigation links', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('Connectors');
    expect(html).toContain('Model');
    expect(html).toContain('Vault');
    expect(html).toContain('SQL Browser');
  });

  it('renders links with correct hrefs', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('/settings/connectors');
    expect(html).toContain('/settings/model');
    expect(html).toContain('/settings/vault');
    expect(html).toContain('/sql');
  });

  it('renders the Outlet placeholder', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('data-testid="outlet"');
  });

  it('renders the ThemeToggle component', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('data-testid="theme-toggle"');
  });

  it('renders the ConversationSidebar', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('data-testid="conversation-sidebar"');
  });

  it('renders aside element', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('<aside');
  });

  it('renders main element', () => {
    const html = renderToString(<AppLayout />);
    expect(html).toContain('<main');
  });

  it('hides sidebar when embedded', () => {
    vi.spyOn(useEmbeddedMode, 'useEmbeddedMode').mockReturnValue(true);
    const html = renderToString(<AppLayout />);
    expect(html).not.toContain('<aside');
    expect(html).not.toContain('Automate');
    expect(html).not.toContain('Connectors');
    vi.restoreAllMocks();
  });
});
