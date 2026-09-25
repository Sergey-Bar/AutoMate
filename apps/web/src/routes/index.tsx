import { ChatShell } from '@/components/chat/chat-shell.js';
import { useParams } from '@tanstack/react-router';

export function ChatPage() {
  // conversationId comes from /chat/$conversationId route, undefined on /
  const params = useParams({ strict: false });
  const conversationId = (params as { conversationId?: string }).conversationId;

  return <ChatShell conversationId={conversationId} />;
}

export default ChatPage;
