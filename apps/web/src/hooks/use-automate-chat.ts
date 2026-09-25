import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';

export const chatApiPath = '/api/chat';

export function useAutomateChat(conversationId?: string) {
  const transport = new DefaultChatTransport({
    api: chatApiPath,
    body: conversationId ? { conversationId } : undefined,
  });
  const chat = useChat({
    transport,
    // Automatically continue conversation after all tool approvals are handled
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });

  return {
    messages: chat.messages,
    sendMessage: chat.sendMessage,
    isLoading: chat.status === 'streaming',
    error: chat.error,
    regenerate: chat.regenerate,
    addToolApprovalResponse: chat.addToolApprovalResponse,
  };
}
