import React from 'react';
import { useConversations } from '@/hooks/use-conversations.js';
import { useNavigate, useParams } from '@tanstack/react-router';

export interface SidebarConversation {
  id: string;
  title: string | null;
  createdAt: string;
}

export interface ConversationSidebarProps {
  conversations: SidebarConversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function ConversationSidebarPure({ conversations, activeId, onSelect }: ConversationSidebarProps) {
  if (conversations.length === 0) {
    return React.createElement('aside', { className: 'conversation-sidebar' },
      React.createElement('p', { className: 'sidebar-empty' }, 'No conversations yet. Start a new chat!')
    );
  }

  return React.createElement('aside', { className: 'conversation-sidebar' },
    React.createElement('ul', { className: 'sidebar-list' },
      conversations.map((convo) =>
        React.createElement('li', {
          key: convo.id,
          className: `sidebar-item${convo.id === activeId ? ' active' : ''}`,
          'aria-current': convo.id === activeId ? 'true' : undefined,
          onClick: () => onSelect(convo.id),
        },
          React.createElement('span', { className: 'sidebar-title' }, convo.title ?? 'Untitled'),
          React.createElement('span', { className: 'sidebar-date' }, convo.createdAt),
        )
      )
    )
  );
}

/** Backward-compatible alias */
export const ConversationSidebar = ConversationSidebarPure;

/** Connected sidebar that fetches conversations and navigates via TanStack Router */
export function ConnectedConversationSidebar() {
  const { conversations, loading, create } = useConversations();
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const activeId = (params as { conversationId?: string }).conversationId ?? null;

  const handleSelect = (id: string) => {
    navigate({ to: '/chat/$conversationId', params: { conversationId: id } });
  };

  const handleNewChat = async () => {
    const conv = await create();
    navigate({ to: '/chat/$conversationId', params: { conversationId: conv.id } });
  };

  if (loading) {
    return React.createElement('div', { className: 'p-4 text-sm text-zinc-500' }, 'Loading...');
  }

  return React.createElement('div', { className: 'flex flex-col flex-1 overflow-hidden' },
    React.createElement('button', {
      type: 'button',
      className: 'mx-4 mt-2 mb-2 px-3 py-1.5 text-sm rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800',
      onClick: handleNewChat,
    }, '+ New Chat'),
    React.createElement('div', { className: 'flex-1 overflow-y-auto' },
      React.createElement(ConversationSidebarPure, {
        conversations,
        activeId,
        onSelect: handleSelect,
      })
    )
  );
}
