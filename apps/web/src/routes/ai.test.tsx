/// <reference types="vitest/globals" />
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { AnyRootRoute } from '@tanstack/react-router';
import { Route as aiRoute } from './ai.js';
import { defaultApiClient } from '../lib/api.js';
import type { Message } from '../lib/api.js';

vi.mock('../lib/api.js', () => ({
  defaultApiClient: {
    getConversations: vi.fn(),
    createConversation: vi.fn(),
    sendMessage: vi.fn(),
    getMessages: vi.fn(),
  }
}));

Object.defineProperty(window, 'scrollTo', { value: vi.fn(), writable: true });

describe('AI Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(defaultApiClient.getMessages).mockResolvedValue([]);
  });

  const renderRoute = () => {
    const rootRoute = createRootRoute({});
    const testRoute = aiRoute;
    testRoute.options.getParentRoute = () => rootRoute as AnyRootRoute;
    rootRoute.addChildren([testRoute]);
    
    const history = createMemoryHistory({
      initialEntries: ['/ai'],
    });
    
    const router = createRouter({
      routeTree: rootRoute,
      history,
    });
    
    return render(<RouterProvider router={router} />);
  };

  it('renders empty conversations', async () => {
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([]);
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByText('No conversations.')).toBeInTheDocument();
    });
    
    expect(screen.getByTestId('ai-page')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-list')).toBeInTheDocument();
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    expect(screen.getByTestId('send-message')).toBeInTheDocument();
  });

  it('displays error message when fetching conversations fails', async () => {
    vi.mocked(defaultApiClient.getConversations).mockRejectedValue(new Error('Network error'));
    
    renderRoute();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays conversations and allows sending a message in a new conversation', async () => {
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([]);
    vi.mocked(defaultApiClient.createConversation).mockResolvedValue({ id: 'c1', title: 'Hello', createdAt: '' });
    vi.mocked(defaultApiClient.sendMessage).mockResolvedValue({ id: 'm1', role: 'assistant', content: 'Hi there', createdAt: '' });
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByText('No conversations.')).toBeInTheDocument();
    });

    const input = screen.getByTestId('chat-input');
    const sendButton = screen.getByTestId('send-message');

    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(input).toHaveValue('Hello');
    
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(defaultApiClient.createConversation).toHaveBeenCalledWith('Hello');
      expect(defaultApiClient.sendMessage).toHaveBeenCalledWith('c1', 'Hello');
    });

    await waitFor(() => {
      expect(screen.getByTestId('assistant-message')).toHaveTextContent('Hi there');
    });
  });

  it('allows sending message in existing conversation', async () => {
    const conv = { id: 'c1', title: 'Existing', createdAt: '' };
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([conv]);
    vi.mocked(defaultApiClient.sendMessage).mockResolvedValue({ id: 'm2', role: 'assistant', content: 'Reply', createdAt: '' });
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByText('Existing')).toBeInTheDocument();
    });

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Next message' } });
    
    fireEvent.click(screen.getByTestId('send-message'));

    await waitFor(() => {
      expect(defaultApiClient.createConversation).not.toHaveBeenCalled();
      expect(defaultApiClient.sendMessage).toHaveBeenCalledWith('c1', 'Next message');
    });

    await waitFor(() => {
      expect(screen.getByTestId('assistant-message')).toHaveTextContent('Reply');
    });
  });

  it('shows error when sending message fails', async () => {
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([]);
    vi.mocked(defaultApiClient.createConversation).mockResolvedValue({ id: 'c1', title: 'Hello', createdAt: '' });
    vi.mocked(defaultApiClient.sendMessage).mockRejectedValue(new Error('Send failed'));
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByText('No conversations.')).toBeInTheDocument();
    });

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.click(screen.getByTestId('send-message'));

    await waitFor(() => {
      expect(screen.getByText('Send failed')).toBeInTheDocument();
    });
  });

  it('shows chat-error banner with testid when sendMessage rejects', async () => {
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([]);
    vi.mocked(defaultApiClient.createConversation).mockResolvedValue({ id: 'c1', title: 'Hello', createdAt: '' });
    vi.mocked(defaultApiClient.sendMessage).mockRejectedValue(new Error('API failure'));
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByText('No conversations.')).toBeInTheDocument();
    });

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Trigger error' } });
    fireEvent.click(screen.getByTestId('send-message'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-error')).toBeInTheDocument();
      expect(screen.getByTestId('chat-error')).toHaveTextContent('API failure');
    });
  });

  it('disables input while sending', async () => {
    let resolveSend: (value: Message) => void;
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([{ id: 'c1', title: 'Ex', createdAt: '' }]);
    vi.mocked(defaultApiClient.sendMessage).mockReturnValue(new Promise(res => { resolveSend = res; }));
    
    renderRoute();
    await waitFor(() => {
      expect(screen.getByText('Ex')).toBeInTheDocument();
    });

    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Yo' } });
    fireEvent.click(screen.getByTestId('send-message'));

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeDisabled();
      expect(screen.getByTestId('send-message')).toBeDisabled();
    });

    resolveSend!({ id: 'm3', role: 'assistant', content: 'Done', createdAt: '' });

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).not.toBeDisabled();
    });
  });

  it('loads isolated messages when switching conversations', async () => {
    const convA = { id: 'c-a', title: 'Conversation A', createdAt: '' };
    const convB = { id: 'c-b', title: 'Conversation B', createdAt: '' };
    
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([convA, convB]);
    vi.mocked(defaultApiClient.getMessages).mockImplementation(async (convId) => {
      if (convId === 'c-a') return [{ id: 'msg-a', role: 'assistant', content: 'Message from A', createdAt: '' }];
      if (convId === 'c-b') return [{ id: 'msg-b', role: 'assistant', content: 'Message from B', createdAt: '' }];
      return [];
    });
    
    renderRoute();
    
    // Wait for initial load — auto-selects first conversation
    await waitFor(() => {
      expect(screen.getByText('Conversation A')).toBeInTheDocument();
    });
    
    // First conversation messages should show
    await waitFor(() => {
      expect(screen.getByText('Message from A')).toBeInTheDocument();
    });
    expect(screen.queryByText('Message from B')).not.toBeInTheDocument();
    
    // Click conversation B
    fireEvent.click(screen.getByText('Conversation B'));
    
    // B messages should replace A messages
    await waitFor(() => {
      expect(screen.getByText('Message from B')).toBeInTheDocument();
    });
    expect(screen.queryByText('Message from A')).not.toBeInTheDocument();
  });

  it('rolls back optimistic message on send failure', async () => {
    const conv = { id: 'c1', title: 'Conv', createdAt: '' };
    vi.mocked(defaultApiClient.getConversations).mockResolvedValue([conv]);
    vi.mocked(defaultApiClient.getMessages).mockResolvedValue([]);
    vi.mocked(defaultApiClient.sendMessage).mockRejectedValue(new Error('Send failed'));
    
    renderRoute();
    
    await waitFor(() => {
      expect(screen.getByText('Conv')).toBeInTheDocument();
    });
    
    const input = screen.getByTestId('chat-input');
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.click(screen.getByTestId('send-message'));
    
    await waitFor(() => {
      expect(screen.getByTestId('chat-error')).toBeInTheDocument();
    });
    
    // The optimistic user message should be rolled back (not visible)
    expect(screen.queryByText('Test message')).not.toBeInTheDocument();
    // Input should be restored so user can retry
    expect(screen.getByTestId('chat-input')).toHaveValue('Test message');
  });
});
