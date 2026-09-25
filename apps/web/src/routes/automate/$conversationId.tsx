import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as automateRoute } from '../automate.js';
import { Card, CardContent, Stack, Badge, Skeleton } from '@automate/ui';
import { useConversation } from '../../hooks/useAutomate.js';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: '$conversationId',
  component: ConversationDetailPage,
});

function ConversationDetailPage() {
  const { conversationId } = Route.useParams();
  return <ConversationDetail conversationId={conversationId} />;
}

export function ConversationDetail({ conversationId, api }: { conversationId: string; api?: ApiClient }) {
  const { messages, isLoading, error } = useConversation(conversationId, api);

  return (
    <div data-testid="conversation-detail-page" className="p-6">
      <Stack gap={6}>
        <h1 className="text-2xl font-bold">Conversation</h1>

        {isLoading && (
          <Stack gap={3} data-testid="messages-loading">
            <Skeleton className="h-16 w-3/4" />
            <Skeleton className="h-16 w-3/4 self-end" />
            <Skeleton className="h-16 w-3/4" />
          </Stack>
        )}

        {error && (
          <div data-testid="messages-error" className="text-danger text-sm">
            {error.message}
          </div>
        )}

        {!isLoading && !error && messages.length === 0 && (
          <p data-testid="messages-empty" className="text-fg-muted">
            No messages in this conversation.
          </p>
        )}

        {!isLoading && !error && messages.length > 0 && (
          <Stack gap={3} data-testid="messages-list">
            {messages.map(msg => (
              <div
                key={msg.id}
                className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              >
                <Card
                  className={`max-w-[70%] ${msg.role === 'user' ? 'bg-accent text-fg' : ''}`}
                  data-testid={`message-${msg.role}`}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Badge variant={msg.role === 'user' ? 'default' : 'secondary'}>
                        {msg.role}
                      </Badge>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  </CardContent>
                </Card>
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </div>
  );
}
