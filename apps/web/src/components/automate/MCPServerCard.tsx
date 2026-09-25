import React from 'react';
import { Card, CardHeader, CardTitle, Badge, Button } from '@automate/ui';
import type { MCPServer } from '../../hooks/useMCPServers.js';

export interface MCPServerCardProps {
  server: MCPServer;
  onConfigure?: (server: MCPServer) => void;
}

export function MCPServerCard({ server, onConfigure }: MCPServerCardProps) {
  const statusVariant = server.status === 'connected' ? ('success' as const) : ('secondary' as const);

  return (
    <Card data-testid={`mcp-server-card-${server.id}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base" data-testid={`mcp-server-name-${server.id}`}>
            {server.name}
          </CardTitle>
          <Badge variant={statusVariant} data-testid={`mcp-server-status-${server.id}`}>
            {server.status}
          </Badge>
        </div>
      </CardHeader>
      <div className="p-4 pt-0">
        <p className="text-sm text-fg-muted mb-3">
          {server.tools.length} tool{server.tools.length !== 1 ? 's' : ''} available
        </p>
        <ul
          className="space-y-1 mb-4"
          data-testid={`mcp-server-tools-${server.id}`}
        >
          {server.tools.map(tool => (
            <li key={tool.name} className="flex items-start gap-2 text-sm">
              <span className="font-mono text-xs bg-surface-raised px-1.5 py-0.5 rounded text-fg-muted">
                {tool.name}
              </span>
              <span className="text-fg-muted">{tool.description}</span>
            </li>
          ))}
        </ul>
        <Button
          variant="outline"
          size="sm"
          data-testid={`mcp-server-configure-${server.id}`}
          onClick={() => onConfigure?.(server)}
        >
          Configure
        </Button>
      </div>
    </Card>
  );
}
