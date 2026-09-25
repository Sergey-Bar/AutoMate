import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as automateRoute } from '../automate.js';
import { Card, CardHeader, CardTitle, Badge, Stack, Skeleton } from '@automate/ui';
import { useConversations } from '../../hooks/useAutomate.js';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: '/',
  component: () => <ConversationsPage />,
});

export function ConversationsPage({ api }: { api?: ApiClient }) {
  const { data: conversations, isLoading, error } = useConversations(api);

  return (
    <div data-testid="conversations-page" className="p-6">
      <Stack gap={6}>
        <div>
          <h1 className="text-2xl font-bold">Conversations</h1>
          <p className="text-sm text-fg-muted mt-1">AI QA conversations</p>
        </div>

        {isLoading && (
          <Stack gap={3} data-testid="conversations-loading">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </Stack>
        )}

        {error && (
          <div data-testid="conversations-error" className="text-danger text-sm">
            {error.message}
          </div>
        )}

        {!isLoading && !error && conversations.length === 0 && (
          <p data-testid="conversations-empty" className="text-fg-muted">
            No conversations yet.
          </p>
        )}

        {!isLoading && !error && conversations.length > 0 && (
          <Stack gap={3} data-testid="conversations-list">
            {conversations.map(conv => (
              <a
                key={conv.id}
                href={`/automate/${conv.id}`}
              >
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">{conv.title}</CardTitle>
                      <Badge variant="secondary">
                        {new Date(conv.createdAt).toLocaleDateString()}
                      </Badge>
                    </div>
                  </CardHeader>
                </Card>
              </a>
            ))}
          </Stack>
        )}
      </Stack>
    </div>
  );
}
