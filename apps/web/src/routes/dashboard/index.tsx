import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useRuns } from '../../hooks/useRuns.js';
import {
  Badge,
  Card,
  EmptyState,
  Skeleton,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import type { ApiClient, Run } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/',
  component: () => <RunsListPage />,
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

export function RunsListPage({ api }: { api?: ApiClient }) {
  const { runs, isLoading, error } = useRuns(api);

  if (isLoading) {
    return (
      <div data-testid="runs-list-loading" className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        data-testid="runs-list-error"
        title="Error Loading Runs"
        description={error.message}
      />
    );
  }

  const total = runs.length;
  const passed = runs.filter((r) => r.status === 'passed').length;
  const failed = runs.filter((r) => r.status === 'failed').length;
  const running = runs.filter((r) => r.status === 'running').length;

  return (
    <div data-testid="runs-list-page" className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard data-testid="stat-total" title="Total Runs" value={total} />
        <StatCard data-testid="stat-passed" title="Passed" value={passed} trend="up" />
        <StatCard data-testid="stat-failed" title="Failed" value={failed} trend={failed > 0 ? 'down' : 'neutral'} />
        <StatCard data-testid="stat-running" title="Running" value={running} />
      </div>

      {runs.length === 0 ? (
        <EmptyState
          data-testid="runs-list-empty"
          title="No Runs Yet"
          description="Test runs will appear here once you connect Playwright."
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Tests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run: Run) => (
                <TableRow key={run.id} data-testid={`run-row-${run.id}`}>
                  <TableCell>
                    <a
                      href={`/dashboard/${run.id}`}
                      className="font-mono text-xs hover:underline text-blue-500"
                    >
                      {run.id.slice(0, 8)}
                    </a>
                  </TableCell>
                  <TableCell>{run.projectName ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </TableCell>
                  <TableCell>{new Date(run.startedAt).toLocaleString()}</TableCell>
                  <TableCell>
                    {run.durationMs != null ? `${run.durationMs}ms` : '—'}
                  </TableCell>
                  <TableCell>
                    {run.total != null
                      ? `${run.passed ?? 0}/${run.total}`
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
