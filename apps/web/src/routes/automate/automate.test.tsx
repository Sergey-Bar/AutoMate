/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ConversationsPage } from './index.js';
import { ConversationDetail, Route as ConvDetailRoute } from './$conversationId.js';
import { ConnectorsPage, Route as ConnectorsRoute } from './connectors.js';
import { VaultPage } from './vault.js';
import type { ApiClient, Conversation, Message, Connector, VaultSecret } from '../../lib/api.js';

const neverResolve = () => new Promise<never>(() => {});

describe('ConversationsPage', () => {
  it('renders loading state', () => {
    const api = {
      getConversations: vi.fn(neverResolve),
    } as unknown as ApiClient;

    render(<ConversationsPage api={api} />);
    expect(screen.getByTestId('conversations-loading')).toBeInTheDocument();
  });

  it('renders empty state when no conversations', async () => {
    const api = {
      getConversations: vi.fn((): Promise<Conversation[]> => Promise.resolve([])),
    } as unknown as ApiClient;

    render(<ConversationsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('conversations-empty')).toBeInTheDocument();
    });
  });

  it('renders conversations list', async () => {
    const conversations: Conversation[] = [
      { id: 'c1', title: 'Test QA Run', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'c2', title: 'Regression Check', createdAt: '2024-01-02T00:00:00Z' },
    ];
    const api = {
      getConversations: vi.fn(() => Promise.resolve(conversations)),
    } as unknown as ApiClient;

    render(<ConversationsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('conversations-list')).toBeInTheDocument();
    });
    expect(screen.getByText('Test QA Run')).toBeInTheDocument();
    expect(screen.getByText('Regression Check')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    const api = {
      getConversations: vi.fn(() => Promise.reject(new Error('Network failure'))),
    } as unknown as ApiClient;

    render(<ConversationsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('conversations-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Network failure')).toBeInTheDocument();
  });
});

describe('ConversationDetail', () => {
  it('renders loading state', () => {
    const api = {
      getMessages: vi.fn(neverResolve),
    } as unknown as ApiClient;

    render(<ConversationDetail conversationId="c1" api={api} />);
    expect(screen.getByTestId('messages-loading')).toBeInTheDocument();
  });

  it('renders messages', async () => {
    const messages: Message[] = [
      { id: 'm1', role: 'user', content: 'Hello AI', createdAt: '2024-01-01T00:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'Hello human', createdAt: '2024-01-01T00:01:00Z' },
    ];
    const api = {
      getMessages: vi.fn(() => Promise.resolve(messages)),
    } as unknown as ApiClient;

    render(<ConversationDetail conversationId="c1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('messages-list')).toBeInTheDocument();
    });
    expect(screen.getByText('Hello AI')).toBeInTheDocument();
    expect(screen.getByText('Hello human')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    const api = {
      getMessages: vi.fn(() => Promise.reject(new Error('Messages unavailable'))),
    } as unknown as ApiClient;

    render(<ConversationDetail conversationId="c1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('messages-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Messages unavailable')).toBeInTheDocument();
  });

  it('renders empty state when conversation has no messages', async () => {
    const api = {
      getMessages: vi.fn((): Promise<Message[]> => Promise.resolve([])),
    } as unknown as ApiClient;

    render(<ConversationDetail conversationId="c1" api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('messages-empty')).toBeInTheDocument();
    });
  });
});

describe('ConnectorsPage', () => {
  it('renders loading state', () => {
    const api = {
      getConnectors: vi.fn(neverResolve),
    } as unknown as ApiClient;

    render(<ConnectorsPage api={api} />);
    expect(screen.getByTestId('connectors-loading')).toBeInTheDocument();
  });

  it('renders connectors table', async () => {
    const connectors: Connector[] = [
      { name: 'github', displayName: 'GitHub', type: 'vcs', status: 'active', lastSynced: '2024-01-01T00:00:00Z' },
      { name: 'jira', displayName: 'Jira', type: 'issue-tracker', status: 'inactive', lastSynced: null },
    ];
    const api = {
      getConnectors: vi.fn(() => Promise.resolve(connectors)),
    } as unknown as ApiClient;

    render(<ConnectorsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('connectors-table')).toBeInTheDocument();
    });
    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Jira')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  it('renders error state', async () => {
    const api = {
      getConnectors: vi.fn(() => Promise.reject(new Error('Connectors unavailable'))),
    } as unknown as ApiClient;

    render(<ConnectorsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('connectors-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Connectors unavailable')).toBeInTheDocument();
  });

  it('renders empty state when no connectors', async () => {
    const api = {
      getConnectors: vi.fn((): Promise<Connector[]> => Promise.resolve([])),
    } as unknown as ApiClient;

    render(<ConnectorsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('connectors-empty')).toBeInTheDocument();
    });
  });

  it('renders error-status connector with danger badge', async () => {
    const connectors: Connector[] = [
      { name: 'ci', displayName: 'CI System', type: 'ci', status: 'error', lastSynced: null },
    ];
    const api = {
      getConnectors: vi.fn(() => Promise.resolve(connectors)),
    } as unknown as ApiClient;

    render(<ConnectorsPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('connectors-table')).toBeInTheDocument();
    });
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('CI System')).toBeInTheDocument();
  });
});

describe('VaultPage', () => {
  it('renders loading state', () => {
    const api = {
      getVaultSecrets: vi.fn(neverResolve),
    } as unknown as ApiClient;

    render(<VaultPage api={api} />);
    expect(screen.getByTestId('vault-loading')).toBeInTheDocument();
  });

  it('renders secrets table with masked values', async () => {
    const secrets: VaultSecret[] = [
      { id: 's1', name: 'GITHUB_TOKEN', connector: 'github', updatedAt: '2024-01-01T00:00:00Z' },
      { id: 's2', name: 'JIRA_API_KEY', connector: undefined, updatedAt: '2024-01-02T00:00:00Z' },
    ];
    const api = {
      getVaultSecrets: vi.fn(() => Promise.resolve(secrets)),
    } as unknown as ApiClient;

    render(<VaultPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('vault-table')).toBeInTheDocument();
    });
    expect(screen.getByText('GITHUB_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('JIRA_API_KEY')).toBeInTheDocument();
    // Values should be masked
    const masked = screen.getAllByText('••••••••');
    expect(masked.length).toBeGreaterThan(0);
  });

  it('deletes a secret when delete button is clicked', async () => {
    const secrets: VaultSecret[] = [
      { id: 's1', name: 'GITHUB_TOKEN', connector: 'github', updatedAt: '2024-01-01T00:00:00Z' },
    ];
    const api = {
      getVaultSecrets: vi.fn(() => Promise.resolve(secrets)),
      deleteVaultSecret: vi.fn(() => Promise.resolve()),
    } as unknown as ApiClient;

    render(<VaultPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('delete-secret-s1')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('delete-secret-s1'));
    await waitFor(() => {
      expect(api.deleteVaultSecret).toHaveBeenCalledWith('s1');
    });
  });

  it('renders error state', async () => {
    const api = {
      getVaultSecrets: vi.fn(() => Promise.reject(new Error('Vault locked'))),
    } as unknown as ApiClient;

    render(<VaultPage api={api} />);
    await waitFor(() => {
      expect(screen.getByTestId('vault-error')).toBeInTheDocument();
    });
    expect(screen.getByText('Vault locked')).toBeInTheDocument();
  });
});

// ─── Route options coverage ───────────────────────────────────────────────────

describe('ConnectorsPage Route options', () => {
  it('getParentRoute returns defined parent', () => {
    const opts = (ConnectorsRoute as unknown as { options: { getParentRoute: () => unknown } }).options;
    expect(opts.getParentRoute()).toBeDefined();
  });

  it('component lambda renders ConnectorsPage', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] } as Response)
    );
    const opts = (ConnectorsRoute as unknown as { options: { component: () => React.JSX.Element } }).options;
    render(opts.component());
    await waitFor(() => {
      expect(screen.getByTestId('connectors-page')).toBeInTheDocument();
    });
    vi.restoreAllMocks();
  });
});

describe('ConversationDetail Route options', () => {
  it('getParentRoute returns defined parent', () => {
    const opts = (ConvDetailRoute as unknown as { options: { getParentRoute: () => unknown } }).options;
    expect(opts.getParentRoute()).toBeDefined();
  });

  it('ConversationDetailPage renders via Route component with mocked useParams', async () => {
    globalThis.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: async () => [] } as Response)
    );
    const routeObj = ConvDetailRoute as unknown as {
      useParams: () => { conversationId: string };
      options: { component: React.ComponentType<Record<string, never>> };
    };
    const spy = vi.spyOn(routeObj, 'useParams').mockReturnValue({ conversationId: 'c1' });
    render(React.createElement(routeObj.options.component));
    await waitFor(() => {
      expect(screen.getByTestId('messages-empty')).toBeInTheDocument();
    });
    spy.mockRestore();
    vi.restoreAllMocks();
  });
});
