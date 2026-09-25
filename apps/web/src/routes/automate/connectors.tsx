import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as automateRoute } from '../automate.js';
import {
  Stack,
  Badge,
  Skeleton,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@automate/ui';
import { useConnectors } from '../../hooks/useAutomate.js';
import type { ApiClient, Connector } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: 'connectors',
  component: () => <ConnectorsPage />,
});

function statusVariant(status: Connector['status']) {
  if (status === 'active') return 'success' as const;
  if (status === 'error') return 'danger' as const;
  return 'secondary' as const;
}

export function ConnectorsPage({ api }: { api?: ApiClient }) {
  const { data: connectors, isLoading, error } = useConnectors(api);

  return (
    <div data-testid="connectors-page" className="p-6">
      <Stack gap={6}>
        <div>
          <h1 className="text-2xl font-bold">Connectors</h1>
          <p className="text-sm text-fg-muted mt-1">Manage integrations and data sources</p>
        </div>

        {isLoading && (
          <Stack gap={2} data-testid="connectors-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Stack>
        )}

        {error && (
          <div data-testid="connectors-error" className="text-danger text-sm">
            {error.message}
          </div>
        )}

        {!isLoading && !error && connectors.length === 0 && (
          <p data-testid="connectors-empty" className="text-fg-muted">
            No connectors configured.
          </p>
        )}

        {!isLoading && !error && connectors.length > 0 && (
          <Table data-testid="connectors-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Synced</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connectors.map(connector => (
                <TableRow key={connector.name}>
                  <TableCell className="font-medium">{connector.displayName}</TableCell>
                  <TableCell>{connector.type}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(connector.status)}>
                      {connector.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {connector.lastSynced
                      ? new Date(connector.lastSynced).toLocaleString()
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Stack>
    </div>
  );
}
