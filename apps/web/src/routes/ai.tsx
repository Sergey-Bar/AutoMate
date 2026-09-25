import React, { useState, useEffect } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as rootRoute } from './__root.js';
import { defaultApiClient, type Conversation, type Message } from '../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ai',
  component: AIPage,
});

function AIPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const fetchMessages = async (convId: string) => {
    try {
      setMessagesLoading(true);
      setMessages([]);
      const data = await defaultApiClient.getMessages(convId);
      setMessages(data);
    } catch (_err) {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  };

  const handleConversationSwitch = (convId: string) => {
    if (convId === activeConversationId) return;
    setActiveConversationId(convId);
    fetchMessages(convId);
  };

  useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await defaultApiClient.getConversations();
      setConversations(data);
      if (data.length > 0 && !activeConversationId) {
        setActiveConversationId(data[0].id);
        fetchMessages(data[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim()) return;
    
    let currentConvId = activeConversationId;
    const currentInput = input;
    
    try {
      setSending(true);
      setError(null);
      
      if (!currentConvId) {
        const newConv = await defaultApiClient.createConversation(currentInput.slice(0, 50));
        setConversations(prev => [newConv, ...prev]);
        currentConvId = newConv.id;
        setActiveConversationId(currentConvId);
      }
      
      const userMsg: Message = { id: Date.now().toString(), role: 'user', content: currentInput, createdAt: new Date().toISOString() };
      setMessages(prev => [...prev, userMsg]);
      setInput('');
      
      const assistantMsg = await defaultApiClient.sendMessage(currentConvId, currentInput);
      setMessages(prev => [...prev, assistantMsg]);
      
    } catch (err) {
      setError((err as Error).message);
      setInput(currentInput);  // Restore input for retry
      // Remove the optimistic user message if it was added
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'user' && last.content === currentInput) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div data-testid="ai-page" className="flex h-full min-h-[500px]">
      {/* Sidebar */}
      <div data-testid="conversation-list" className="w-64 border-r bg-gray-50 p-4 overflow-y-auto">
        <h2 className="font-semibold mb-4">Conversations</h2>
        {loading && <p>Loading conversations...</p>}
        {!loading && conversations.length === 0 && <p>No conversations.</p>}
        <ul>
          {conversations.map(conv => (
            <li 
              key={conv.id} 
              className={`p-2 mb-2 rounded cursor-pointer ${activeConversationId === conv.id ? 'bg-blue-100' : 'hover:bg-gray-200'}`}
              onClick={() => handleConversationSwitch(conv.id)}
            >
              {conv.title}
            </li>
          ))}
        </ul>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col p-4 relative">
        {error && <div data-testid="chat-error" className="bg-red-100 text-red-700 p-3 mb-4 rounded">{error}</div>}
        
        <div className="flex-1 overflow-y-auto mb-4 space-y-4">
          {messagesLoading && (
            <div data-testid="messages-loading" className="text-gray-500 text-center mt-10">Loading messages...</div>
          )}
          {!messagesLoading && messages.length === 0 && !loading && (
            <div className="text-gray-500 text-center mt-10">Start a conversation</div>
          )}
          {messages.map(msg => (
            <div key={msg.id} className={`p-3 rounded-lg max-w-[80%] ${msg.role === 'user' ? 'bg-blue-100 self-end ml-auto' : 'bg-gray-100 self-start mr-auto'}`}>
              <div 
                data-testid={msg.role === 'assistant' ? 'assistant-message' : undefined}
                className="whitespace-pre-wrap"
              >
                {msg.content}
              </div>
            </div>
          ))}
          {sending && (
            <div className="bg-gray-100 p-3 rounded-lg self-start mr-auto">
              Thinking...
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <input
            data-testid="chat-input"
            type="text"
            className="flex-1 border rounded p-2"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={sending}
            placeholder="Ask something..."
          />
          <button
            data-testid="send-message"
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50"
            onClick={handleSend}
            disabled={sending || !input.trim()}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}