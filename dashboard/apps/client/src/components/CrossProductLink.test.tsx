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
    render(<CrossProductLink targetApp="ai" path="/chat" label="Ask AI" />);

    expect(screen.getByRole('button', { name: 'Ask AI' })).toHaveAttribute('data-automate-link', 'ai:/chat');
  });

  it('opens a new tab in standalone mode', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<CrossProductLink targetApp="dashboard" path="/runs/run-1" label="View in Dashboard" />);
    await user.click(screen.getByRole('button', { name: 'View in Dashboard' }));

    expect(openSpy).toHaveBeenCalledWith(
      `${window.location.origin}/dashboard/app/runs/run-1`,
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
        targetApp="ai"
        path="/chat"
        context="Analyze this test failure"
        label="Ask AI"
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ask AI' }));

    expect(postMessageSpy).toHaveBeenCalledWith(
      { type: 'navigate-cross', targetApp: 'ai', path: '/chat', context: 'Analyze this test failure' },
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

    render(<CrossProductLink targetApp="dashboard" path="/runs/1" label="View in Dashboard" />);

    expect(screen.getByRole('button', { name: 'View in Dashboard' })).toBeTruthy();
    topSpy.mockRestore();
  });
});
