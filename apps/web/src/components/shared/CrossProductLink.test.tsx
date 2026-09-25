import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CrossProductLink, buildCrossProductAppPath } from './CrossProductLink';

describe('CrossProductLink', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders button with label and data attribute', () => {
    render(<CrossProductLink targetApp="dashboard" path="/runs/123" label="View in Dashboard" />);

    expect(screen.getByRole('button', { name: 'View in Dashboard' })).toHaveAttribute('data-automate-link', 'dashboard:/runs/123');
  });

  it('opens a new tab in standalone mode', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<CrossProductLink targetApp="ai" path="/chat" label="Ask AI" />);
    await user.click(screen.getByRole('button', { name: 'Ask AI' }));

    expect(openSpy).toHaveBeenCalledWith(
      `${window.location.origin}/ai/app/chat`,
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('posts navigate-cross message in embedded mode', async () => {
    const user = userEvent.setup();
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    vi.spyOn(window, 'top', 'get').mockReturnValue({} as Window);

    render(
      <CrossProductLink
        targetApp="dashboard"
        path="/runs/456"
        context="Analyze this test failure"
        label="View in Dashboard"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'View in Dashboard' }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'navigate-cross', targetApp: 'dashboard', path: '/runs/456', context: 'Analyze this test failure' },
      window.location.origin,
    );
  });

  it('normalizes app paths for both apps', () => {
    expect(buildCrossProductAppPath('ai', '/chat')).toBe('/ai/app/chat');
    expect(buildCrossProductAppPath('ai', '/ai/chat')).toBe('/ai/app/chat');
    expect(buildCrossProductAppPath('dashboard', '/dashboard/runs/1')).toBe('/dashboard/app/runs/1');
    expect(buildCrossProductAppPath('dashboard', '/dashboard/app/runs/1')).toBe('/dashboard/app/runs/1');
  });

  it('falls back to embedded-safe mode when window.top access throws', () => {
    const topSpy = vi.spyOn(window, 'top', 'get').mockImplementation(() => {
      throw new Error('cross-origin');
    });

    render(<CrossProductLink targetApp="ai" path="/chat" label="Ask AI" />);

    expect(screen.getByRole('button', { name: 'Ask AI' })).toBeTruthy();
    topSpy.mockRestore();
  });

  it('renders SSR fallback span (not button) when window is undefined', () => {
    vi.stubGlobal('window', undefined);
    try {
      // Call the component function directly to get a React element —
      // avoids any DOM dependency while window is undefined.
      const element = CrossProductLink({
        targetApp: 'dashboard',
        path: '/runs/1',
        label: 'View in Dashboard',
      }) as import('react').ReactElement<Record<string, unknown>>;

      // Must return a <span>, not a <button>
      expect(element.type).toBe('span');
      expect(element.props['data-automate-link']).toBe('dashboard:/runs/1');
      // Default className applied when no className prop is provided
      expect(element.props['className']).toContain('text-blue-400');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses custom className on SSR fallback span when className prop is provided', () => {
    vi.stubGlobal('window', undefined);
    try {
      const element = CrossProductLink({
        targetApp: 'ai',
        path: '/chat',
        label: 'Ask AI',
        className: 'my-custom-class',
      }) as import('react').ReactElement<Record<string, unknown>>;

      expect(element.type).toBe('span');
      expect(element.props['className']).toBe('my-custom-class');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses custom className on button when className prop is provided', () => {
    render(
      <CrossProductLink
        targetApp="dashboard"
        path="/runs/1"
        label="View"
        className="custom-link-class"
      />,
    );
    const btn = screen.getByRole('button', { name: 'View' });
    expect(btn).toHaveAttribute('class', 'custom-link-class');
  });
});
