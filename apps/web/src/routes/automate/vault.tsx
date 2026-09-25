import React, { useState } from 'react';
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
  Button,
} from '@automate/ui';
import { useVault } from '../../hooks/useAutomate.js';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => automateRoute,
  path: 'vault',
  component: () => <VaultPage />,
});

export function VaultPage({ api }: { api?: ApiClient }) {
  const { data: secrets, isLoading, error, deleteSecret } = useVault(api);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteSecret(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div data-testid="vault-page" className="p-6">
      <Stack gap={6}>
        <div>
          <h1 className="text-2xl font-bold">Vault</h1>
          <p className="text-sm text-fg-muted mt-1">Manage secrets and credentials</p>
        </div>

        {isLoading && (
          <Stack gap={2} data-testid="vault-loading">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </Stack>
        )}

        {error && (
          <div data-testid="vault-error" className="text-danger text-sm">
            {error.message}
          </div>
        )}

        {!isLoading && !error && secrets.length === 0 && (
          <p data-testid="vault-empty" className="text-fg-muted">
            No secrets stored.
          </p>
        )}

        {!isLoading && !error && secrets.length > 0 && (
          <Table data-testid="vault-table">
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Connector</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {secrets.map(secret => (
                <TableRow key={secret.id}>
                  <TableCell className="font-medium">{secret.name}</TableCell>
                  <TableCell>
                    {secret.connector ? (
                      <Badge variant="secondary">{secret.connector}</Badge>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-fg-muted">••••••••</span>
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    {new Date(secret.updatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(secret.id)}
                      disabled={deletingId === secret.id}
                      data-testid={`delete-secret-${secret.id}`}
                    >
                      {deletingId === secret.id ? 'Deleting…' : 'Delete'}
                    </Button>
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
