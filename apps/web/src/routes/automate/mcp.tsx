import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as automateRoute } from '../automate.js';
import { Stack, Skeleton } from '@automate/ui';
import { useMCPServers } from '../../hooks/useMCPServers.js';
import { MCPServerCard } from '../../components/automate/MCPServerCard.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: 'mcp',
  component: () => <MCPPage />,
});

export function MCPPage() {
  const { data: servers, isLoading, error } = useMCPServers();

  return (
    <div data-testid="mcp-page" className="p-6">
      <Stack gap={6}>
        <div>
          <h1 className="text-2xl font-bold">MCP Servers</h1>
          <p className="text-sm text-fg-muted mt-1">
            Registered Model Context Protocol servers available to AI agents
          </p>
        </div>

        {isLoading && (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="mcp-loading"
          >
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )}

        {error && !isLoading && (
          <div data-testid="mcp-error" className="text-danger text-sm">
            {error.message}
          </div>
        )}

        {!isLoading && servers.length === 0 && (
          <p data-testid="mcp-empty" className="text-fg-muted">
            No MCP servers registered.
          </p>
        )}

        {!isLoading && servers.length > 0 && (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            data-testid="mcp-server-grid"
          >
            {servers.map(server => (
              <MCPServerCard key={server.id} server={server} />
            ))}
          </div>
        )}
      </Stack>
    </div>
  );
}
