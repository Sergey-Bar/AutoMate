/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MCPServerCard } from '../../components/automate/MCPServerCard.js';
import { MCPPage, Route as MCPRoute } from './mcp.js';
import type { MCPServer } from '../../hooks/useMCPServers.js';

const playwrightServer: MCPServer = {
  id: 'playwright',
  name: 'Playwright',
  status: 'connected',
  tools: [
    { name: 'navigate', description: 'Navigate to a URL' },
    { name: 'click', description: 'Click an element' },
    { name: 'fill', description: 'Fill an input field' },
    { name: 'screenshot', description: 'Take a screenshot' },
    { name: 'waitForSelector', description: 'Wait for an element to appear' },
  ],
};

const disconnectedServer: MCPServer = {
  id: 'custom',
  name: 'Custom Server',
  status: 'disconnected',
  tools: [{ name: 'ping', description: 'Ping the server' }],
};

// ─── MCPServerCard ────────────────────────────────────────────────────────────

describe('MCPServerCard', () => {
  it('renders server name', () => {
    render(<MCPServerCard server={playwrightServer} />);
    expect(screen.getByTestId('mcp-server-name-playwright')).toHaveTextContent('Playwright');
  });

  it('renders connected status badge', () => {
    render(<MCPServerCard server={playwrightServer} />);
    expect(screen.getByTestId('mcp-server-status-playwright')).toHaveTextContent('connected');
  });

  it('renders disconnected status badge', () => {
    render(<MCPServerCard server={disconnectedServer} />);
    expect(screen.getByTestId('mcp-server-status-custom')).toHaveTextContent('disconnected');
  });

  it('renders all tools', () => {
    render(<MCPServerCard server={playwrightServer} />);
    const toolsList = screen.getByTestId('mcp-server-tools-playwright');
    expect(toolsList).toHaveTextContent('navigate');
    expect(toolsList).toHaveTextContent('click');
    expect(toolsList).toHaveTextContent('fill');
    expect(toolsList).toHaveTextContent('screenshot');
    expect(toolsList).toHaveTextContent('waitForSelector');
  });

  it('renders Configure button', () => {
    render(<MCPServerCard server={playwrightServer} />);
    expect(screen.getByTestId('mcp-server-configure-playwright')).toHaveTextContent('Configure');
  });

  it('calls onConfigure when Configure button is clicked', () => {
    const onConfigure = vi.fn();
    render(<MCPServerCard server={playwrightServer} onConfigure={onConfigure} />);
    fireEvent.click(screen.getByTestId('mcp-server-configure-playwright'));
    expect(onConfigure).toHaveBeenCalledWith(playwrightServer);
  });
});

// ─── MCPPage ──────────────────────────────────────────────────────────────────

describe('MCPPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders server list when fetch succeeds', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([playwrightServer]),
      } as Response)
    );

    render(<MCPPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-server-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mcp-server-card-playwright')).toBeInTheDocument();
  });

  it('shows Playwright tools when fetch succeeds', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([playwrightServer]),
      } as Response)
    );

    render(<MCPPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-server-tools-playwright')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mcp-server-tools-playwright')).toHaveTextContent('navigate');
  });

  it('shows empty state when server returns empty array', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([]),
      } as Response)
    );

    render(<MCPPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-empty')).toBeInTheDocument();
    });
  });

  it('falls back to default Playwright server on fetch error', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    render(<MCPPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-server-grid')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mcp-server-card-playwright')).toBeInTheDocument();
  });

  it('shows error message on fetch failure', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('Network error')));

    render(<MCPPage />);
    await waitFor(() => {
      expect(screen.getByTestId('mcp-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('mcp-error')).toHaveTextContent('Network error');
  });

  it('renders loading state while fetch is pending', () => {
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));

    render(<MCPPage />);
    expect(screen.getByTestId('mcp-loading')).toBeInTheDocument();
  });

  it('renders mcp-page container', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve([playwrightServer]),
      } as Response)
    );

    render(<MCPPage />);
    expect(screen.getByTestId('mcp-page')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('mcp-server-grid')).toBeInTheDocument();
    });
  });

  it('Route.options.getParentRoute returns defined parent', () => {
    const opts = (MCPRoute as unknown as { options: { getParentRoute: () => unknown } }).options;
    expect(opts.getParentRoute()).toBeDefined();
  });

  it('Route.options.component lambda renders MCPPage', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) } as Response)
    );
    const opts = (MCPRoute as unknown as { options: { component: () => React.JSX.Element } }).options;
    render(opts.component());
    await waitFor(() => {
      expect(screen.getByTestId('mcp-empty')).toBeInTheDocument();
    });
  });
});
