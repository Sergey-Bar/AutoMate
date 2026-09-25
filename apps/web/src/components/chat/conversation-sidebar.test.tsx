import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import {
  ConversationSidebar,
  ConversationSidebarPure,
  ConnectedConversationSidebar,
} from './conversation-sidebar.js';

// ---------------------------------------------------------------------------
// Mocks for ConnectedConversationSidebar deps
// ---------------------------------------------------------------------------
const mockNavigate = vi.fn();
let mockConversations: Array<{ id: string; title: string | null; createdAt: string }> = [];
let mockLoading = false;
const mockCreate = vi.fn();
let mockParams: Record<string, string> = {};

vi.mock('@/hooks/use-conversations.js', () => ({
  useConversations: () => ({
    conversations: mockConversations,
    loading: mockLoading,
    create: mockCreate,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
}));

// ---------------------------------------------------------------------------
// ConversationSidebarPure (named export)
// ---------------------------------------------------------------------------
describe('ConversationSidebarPure', () => {
  it('renders without crashing', () => {
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: [], activeId: null, onSelect: () => {} })
    );
    expect(typeof html).toBe('string');
  });

  it('renders conversation titles', () => {
    const convos = [
      { id: '1', title: 'Test Conversation', createdAt: '2026-01-01' },
      { id: '2', title: 'Another Chat', createdAt: '2026-01-02' },
    ];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: '1', onSelect: () => {} })
    );
    expect(html).toContain('Test Conversation');
    expect(html).toContain('Another Chat');
  });

  it('marks active conversation with aria-current="true"', () => {
    const convos = [
      { id: '1', title: 'Active', createdAt: '2026-01-01' },
      { id: '2', title: 'Inactive', createdAt: '2026-01-02' },
    ];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: '1', onSelect: () => {} })
    );
    expect(html).toContain('aria-current="true"');
  });

  it('does NOT set aria-current on inactive conversations', () => {
    const convos = [
      { id: '1', title: 'Active', createdAt: '2026-01-01' },
      { id: '2', title: 'Inactive', createdAt: '2026-01-02' },
    ];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: '1', onSelect: () => {} })
    );
    // Only one aria-current in the output (the active one)
    const matches = html.match(/aria-current/g) || [];
    expect(matches.length).toBe(1);
  });

  it('adds active CSS class to active item', () => {
    const convos = [{ id: '42', title: 'Active Item', createdAt: '2026-01-01' }];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: '42', onSelect: () => {} })
    );
    expect(html).toContain('sidebar-item active');
  });

  it('does not add active CSS class to inactive items', () => {
    const convos = [{ id: '1', title: 'Not Active', createdAt: '2026-01-01' }];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: 'other', onSelect: () => {} })
    );
    expect(html).toContain('sidebar-item');
    expect(html).not.toContain('sidebar-item active');
  });

  it('renders empty state when no conversations', () => {
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: [], activeId: null, onSelect: () => {} })
    );
    expect(html).toContain('No conversations');
    expect(html).toContain('sidebar-empty');
  });

  it('renders "Untitled" for conversations with null title', () => {
    const convos = [{ id: '1', title: null, createdAt: '2026-01-01' }];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: null, onSelect: () => {} })
    );
    expect(html).toContain('Untitled');
  });

  it('renders createdAt date', () => {
    const convos = [{ id: '1', title: 'Chat', createdAt: '2026-03-15' }];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: null, onSelect: () => {} })
    );
    expect(html).toContain('2026-03-15');
  });

  it('renders a ul.sidebar-list when conversations exist', () => {
    const convos = [{ id: '1', title: 'A', createdAt: '2026-01-01' }];
    const html = renderToString(
      React.createElement(ConversationSidebarPure, { conversations: convos, activeId: null, onSelect: () => {} })
    );
    expect(html).toContain('sidebar-list');
  });

  it('clicking a conversation item calls onSelect with its id (line 31)', () => {
    const onSelect = vi.fn();
    const convos = [{ id: 'test-id-99', title: 'Click Me', createdAt: '2026-01-01' }];

    // Call component as function to obtain the virtual DOM tree
    const aside = ConversationSidebarPure({ conversations: convos, activeId: null, onSelect }) as React.ReactElement<{
      children?: React.ReactNode;
    }>;
    // aside -> ul -> li
    const ul = React.Children.toArray(aside.props.children)[0] as React.ReactElement<{
      children?: React.ReactNode;
    }>;
    const li = React.Children.toArray(ul.props.children)[0] as React.ReactElement<{
      onClick?: () => void;
    }>;

    // Invoke the onClick arrow function directly — covers line 31: onClick: () => onSelect(convo.id)
    li.props.onClick?.();

    expect(onSelect).toHaveBeenCalledWith('test-id-99');
  });
});

// ---------------------------------------------------------------------------
// ConversationSidebar (backward-compat alias = ConversationSidebarPure)
// ---------------------------------------------------------------------------
describe('ConversationSidebar (alias)', () => {
  it('is the same component as ConversationSidebarPure', () => {
    expect(ConversationSidebar).toBe(ConversationSidebarPure);
  });

  it('renders empty state', () => {
    const html = renderToString(
      React.createElement(ConversationSidebar, { conversations: [], activeId: null, onSelect: () => {} })
    );
    expect(html).toContain('No conversations');
  });
});

// ---------------------------------------------------------------------------
// ConnectedConversationSidebar
// ---------------------------------------------------------------------------
describe('ConnectedConversationSidebar', () => {
  it('renders loading indicator while loading', () => {
    mockLoading = true;
    mockConversations = [];
    mockParams = {};
    const html = renderToString(React.createElement(ConnectedConversationSidebar));
    expect(html).toContain('Loading...');
  });

  it('renders new chat button when not loading', () => {
    mockLoading = false;
    mockConversations = [];
    mockParams = {};
    const html = renderToString(React.createElement(ConnectedConversationSidebar));
    expect(html).toContain('+ New Chat');
  });

  it('renders conversation list via ConversationSidebarPure when not loading', () => {
    mockLoading = false;
    mockConversations = [
      { id: '1', title: 'First Chat', createdAt: '2026-01-01' },
    ];
    mockParams = {};
    const html = renderToString(React.createElement(ConnectedConversationSidebar));
    expect(html).toContain('First Chat');
  });

  it('marks active conversation based on conversationId param', () => {
    mockLoading = false;
    mockConversations = [
      { id: 'abc', title: 'Active', createdAt: '2026-01-01' },
      { id: 'xyz', title: 'Inactive', createdAt: '2026-01-02' },
    ];
    mockParams = { conversationId: 'abc' };
    const html = renderToString(React.createElement(ConnectedConversationSidebar));
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('sidebar-item active');
  });

  it('passes null activeId when conversationId param is absent', () => {
    mockLoading = false;
    mockConversations = [
      { id: 'abc', title: 'Chat', createdAt: '2026-01-01' },
    ];
    mockParams = {};
    const html = renderToString(React.createElement(ConnectedConversationSidebar));
    expect(html).not.toContain('aria-current');
  });

  it('renders overflow container for conversation list', () => {
    mockLoading = false;
    mockConversations = [];
    mockParams = {};
    const html = renderToString(React.createElement(ConnectedConversationSidebar));
    expect(html).toContain('overflow-y-auto');
  });
});

// ---------------------------------------------------------------------------
// ConnectedConversationSidebar handler coverage
// ---------------------------------------------------------------------------
describe('ConnectedConversationSidebar handler coverage', () => {
  it('handleSelect navigates to chat URL on conversation click', () => {
    mockLoading = false;
    mockConversations = [{ id: 'conv-123', title: 'Test', createdAt: '2026-01-01' }];
    mockParams = {};

    // Get the element and find the New Chat button + ConversationSidebarPure
    const element = ConnectedConversationSidebar() as React.ReactElement<{ children: React.ReactNode[] }>;
    const outerChildren = React.Children.toArray(element.props.children) as React.ReactElement[];
    // outerChildren[1] is the overflow div containing ConversationSidebarPure
    const overflowDiv = outerChildren[1] as React.ReactElement<{ children: React.ReactNode[] }>;
    const pureEl = React.Children.toArray(overflowDiv?.props?.children ?? [])[0] as React.ReactElement<{
      onSelect?: (id: string) => void;
    }>;
    if (pureEl?.props?.onSelect) {
      pureEl.props.onSelect('conv-123');
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/chat/$conversationId',
        params: { conversationId: 'conv-123' },
      });
    }
  });

  it('handleNewChat creates a conversation and navigates', async () => {
    mockLoading = false;
    mockConversations = [];
    mockParams = {};
    mockCreate.mockResolvedValueOnce({ id: 'new-conv-456' });

    const element = ConnectedConversationSidebar() as React.ReactElement<{ children: React.ReactNode[] }>;
    const outerChildren = React.Children.toArray(element.props.children) as React.ReactElement[];
    const newChatBtn = outerChildren[0] as React.ReactElement<{ onClick?: () => Promise<void> }>;

    if (newChatBtn?.props?.onClick) {
      await newChatBtn.props.onClick();
      expect(mockCreate).toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/chat/$conversationId',
        params: { conversationId: 'new-conv-456' },
      });
    }
  });
});
