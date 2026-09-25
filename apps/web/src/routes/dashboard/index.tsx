import React from 'react';
import { createRoute } from '@tanstack/react-router';
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
import { Route as dashboardRoute } from '../dashboard.js';
import { isRunActive, useRuns } from '../../hooks/useRuns.js';
import type { ApiClient, Run } from '../../lib/api.js';
import { runDetailPath } from '../../route-manifest.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/runs',
  component: () => <RunsListPage />,
});

function outcomeVariant(
  outcome: Run['outcome'],
): 'success' | 'danger' | 'warning' | 'default' | 'secondary' {
  switch (outcome) {
    case 'passed':
      return 'success';
    case 'failed':
      return 'danger';
    case 'partial':
    case 'unknown':
      return 'warning';
    default:
      return 'secondary';
  }
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not started';
}

export function RunsListPage({ api }: { api?: ApiClient }) {
  const { runs, isLoading, error, isLive } = useRuns(api);

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
        title="Runs unavailable"
        description={error.message}
      />
    );
  }

  const passed = runs.filter((run) => run.outcome === 'passed').length;
  const failed = runs.filter((run) => run.outcome === 'failed').length;
  const active = runs.filter(isRunActive).length;

  return (
    <div data-testid="runs-list-page" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Runs</h1>
          <p className="mt-1 text-sm text-fg-muted">
            Canonical execution records and current evidence state.
          </p>
        </div>
        <span data-testid="runs-live-state" className="text-xs text-fg-muted">
          {isLive ? 'Live stream connected' : 'Live stream disconnected'}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard data-testid="stat-total" title="Total Runs" value={runs.length} />
        <StatCard data-testid="stat-passed" title="Passed" value={passed} />
        <StatCard data-testid="stat-failed" title="Failed" value={failed} />
        <StatCard data-testid="stat-running" title="Active" value={active} />
      </div>

      {runs.length === 0 ? (
        <EmptyState
          data-testid="runs-list-empty"
          title="No execution evidence"
          description="Launch a registered browser project from the Command Center to create the first run."
          action={
            <a
              href="/dashboard"
              className="rounded-md bg-primary px-4 py-2 text-sm text-white no-underline"
            >
              Open Command Center
            </a>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Tests</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} data-testid={`run-row-${run.id}`}>
                  <TableCell>
                    <a
                      href={runDetailPath(run.id)}
                      className="font-mono text-xs text-accent no-underline hover:underline"
                    >
                      {run.id.slice(0, 8)}
                    </a>
                  </TableCell>
                  <TableCell>{run.projectId ?? 'UNKNOWN'}</TableCell>
                  <TableCell>
                    <Badge variant={isRunActive(run) ? 'default' : 'outline'}>{run.phase}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      data-testid={`run-outcome-${run.id}`}
                      variant={outcomeVariant(run.outcome)}
                    >
                      {run.outcome ?? 'PENDING'}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(run.createdAt)}</TableCell>
                  <TableCell>
                    {run.summary.durationMs != null ? `${run.summary.durationMs}ms` : 'UNKNOWN'}
                  </TableCell>
                  <TableCell>
                    {run.summary.total > 0
                      ? `${run.summary.passed}/${run.summary.total}`
                      : 'No tests reported'}
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
