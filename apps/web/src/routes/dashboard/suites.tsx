import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useSuites } from '../../hooks/useDashboardPages.js';
import {
  Badge,
  Card,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import type { ApiClient, Suite } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/suites',
  component: () => <SuitesPage />,
});

export function SuitesPage({ api }: { api?: ApiClient }) {
  const { data: suites, isLoading, error } = useSuites(api);

  if (isLoading) {
    return (
      <div data-testid="suites-loading" className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        data-testid="suites-error"
        title="Error Loading Suites"
        description={error.message}
      />
    );
  }

  if (suites.length === 0) {
    return (
      <EmptyState
        data-testid="suites-empty"
        title="No Suites Found"
        description="Test suites will appear here once you run your tests."
      />
    );
  }

  return (
    <div data-testid="suites-page" className="space-y-4">
      <h2 className="text-xl font-bold text-text-primary">Test Suites</h2>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Suite Name</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Total Runs</TableHead>
              <TableHead>Pass Rate</TableHead>
              <TableHead>Last Run</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suites.map((suite: Suite) => (
              <TableRow key={suite.id} data-testid={`suite-row-${suite.id}`}>
                <TableCell className="font-medium">{suite.name}</TableCell>
                <TableCell>{suite.projectName ?? '—'}</TableCell>
                <TableCell>{suite.totalRuns ?? '—'}</TableCell>
                <TableCell>
                  {suite.passRate != null ? (
                    <Badge variant={suite.passRate >= 80 ? 'success' : suite.passRate >= 50 ? 'warning' : 'danger'}>
                      {suite.passRate}%
                    </Badge>
                  ) : (
                    '—'
                  )}
                </TableCell>
                <TableCell>
                  {suite.lastRunAt ? new Date(suite.lastRunAt).toLocaleString() : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
