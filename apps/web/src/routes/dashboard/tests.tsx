import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useTests } from '../../hooks/useDashboardPages.js';
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
import type { ApiClient, Test } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/tests',
  component: () => <TestsPage />,
});

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'default' | 'secondary' {
  switch (status) {
    case 'passed': return 'success';
    case 'failed': return 'danger';
    case 'flaky': return 'warning';
    case 'running': return 'default';
    default: return 'secondary';
  }
}

export function TestsPage({ api }: { api?: ApiClient }) {
  const { data: tests, isLoading, error } = useTests(api);

  if (isLoading) {
    return (
      <div data-testid="tests-loading" className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        data-testid="tests-error"
        title="Error Loading Tests"
        description={error.message}
      />
    );
  }

  if (tests.length === 0) {
    return (
      <EmptyState
        data-testid="tests-empty"
        title="No Tests Found"
        description="Tests will appear here once you run your test suite."
      />
    );
  }

  return (
    <div data-testid="tests-page" className="space-y-4">
      <h2 className="text-xl font-bold text-text-primary">Tests</h2>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Suite</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Duration</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tests.map((test: Test) => (
              <TableRow key={test.id} data-testid={`test-row-${test.id}`}>
                <TableCell className="font-medium">{test.title}</TableCell>
                <TableCell>{test.suiteName ?? '—'}</TableCell>
                <TableCell className="font-mono text-xs">{test.file ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(test.status)}>{test.status}</Badge>
                </TableCell>
                <TableCell>
                  {test.durationMs != null ? `${test.durationMs}ms` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
