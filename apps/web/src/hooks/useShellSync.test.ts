import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useShellSync } from './useShellSync.js';
import * as reactRouter from '@tanstack/react-router';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: vi.fn(),
  useRouterState: vi.fn(),
}));

describe('useShellSync', () => {
  const mockNavigate = vi.fn();
  let mockPostMessage: unknown;
  const originalLocation = window.location;
  
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reactRouter.useNavigate).mockReturnValue(mockNavigate);
    
    mockPostMessage = vi.fn();
    Object.defineProperty(window, 'parent', {
      value: { postMessage: mockPostMessage },
      writable: true,
    });
    
    Object.defineProperty(window, 'location', {
      value: { origin: 'http://localhost:5173', href: 'http://localhost:5173/' },
      writable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
    });
    Object.defineProperty(window, 'parent', {
      value: window, // restore to window
      writable: true,
    });
  });

  it('does nothing when not embedded', () => {
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/test' } });
      return { href: '/test' };
    }) as unknown as typeof reactRouter.useRouterState);
    
    renderHook(() => useShellSync(false));
    
    expect(mockPostMessage).not.toHaveBeenCalled();
    
    // Simulate incoming message
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost:5173',
      data: { type: 'navigate', path: '/foo' }
    }));
    
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('posts message on route change when embedded', () => {
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/test' } });
      return { href: '/test' };
    }) as unknown as typeof reactRouter.useRouterState);
    
    const { rerender } = renderHook(() => useShellSync(true));
    
    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: 'route-change', path: '/test' },
      'http://localhost:5173'
    );
    
    vi.mocked(mockPostMessage as () => void).mockClear();
    
    // Change location
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/new-path' } });
      return { href: '/new-path' };
    }) as unknown as typeof reactRouter.useRouterState);
    rerender();
    
    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: 'route-change', path: '/new-path' },
      'http://localhost:5173'
    );
  });

  it('listens to navigate messages from shell and navigates', () => {
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/test' } });
      return { href: '/test' };
    }) as unknown as typeof reactRouter.useRouterState);
    
    renderHook(() => useShellSync(true));
    
    // Dispatch navigate message
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost:5173',
      data: { type: 'navigate', path: '/shell-path' }
    }));
    
    expect(mockNavigate).toHaveBeenCalledWith({ to: '/shell-path' });
  });

  it('ignores messages from different origins', () => {
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/test' } });
      return { href: '/test' };
    }) as unknown as typeof reactRouter.useRouterState);
    
    renderHook(() => useShellSync(true));
    
    // Dispatch message from evil origin
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://evil.com',
      data: { type: 'navigate', path: '/shell-path' }
    }));
    
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ignores invalid message types', () => {
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/test' } });
      return { href: '/test' };
    }) as unknown as typeof reactRouter.useRouterState);
    
    renderHook(() => useShellSync(true));
    
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost:5173',
      data: { type: 'unknown', path: '/shell-path' }
    }));
    
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not post message if window.parent === window', () => {
    Object.defineProperty(window, 'parent', {
      value: window,
      writable: true,
    });
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/test2' } });
      return { href: '/test2' };
    }) as unknown as typeof reactRouter.useRouterState);
    renderHook(() => useShellSync(true));
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it('ignores navigate if path is identical', () => {
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/same' } });
      return { href: '/same' };
    }) as unknown as typeof reactRouter.useRouterState);
    renderHook(() => useShellSync(true));
    
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost:5173',
      data: { type: 'navigate', path: '/same' }
    }));
    
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('ignores invalid message data', () => {
    vi.mocked(reactRouter.useRouterState).mockImplementation(((opts: { select?: (s: { location: { href: string } }) => { href: string } }) => {
      if (opts?.select) opts.select({ location: { href: '/test' } });
      return { href: '/test' };
    }) as unknown as typeof reactRouter.useRouterState);
    renderHook(() => useShellSync(true));
    
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'http://localhost:5173',
      data: null // invalid
    }));
    
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
