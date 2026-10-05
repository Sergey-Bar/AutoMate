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
import { LaunchRunForm, RecentRuns, ReleaseReadinessCard } from '../dashboard.js';
import { isRunActive, useRuns } from '../../hooks/useRuns.js';
import { defaultApiClient, type ApiClient, type Run } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
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

export function RunsListPage({ api = defaultApiClient }: { api?: ApiClient }) {
  const { runs, isLoading, error, isLive, refresh } = useRuns(api);
  const latestReleaseId = runs.find((run) => run.releaseId)?.releaseId ?? null;

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
          <p className="mt-1 text-sm text-fg-muted max-w-measure text-pretty">
            Launch a registered browser run, then read canonical execution records and current
            evidence state.
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

      {/*
        The launch form lives here rather than on `/dashboard`.

        The cockpit's job is to say what is blocking you, and a form is not that — and
        putting an eight-field form above the verdict made the home page a page you had
        to fill in before it told you anything. Everything here is evidence *about* runs,
        so it belongs with the runs.
      */}
      <LaunchRunForm api={api} onCreated={() => void refresh()} />

      <section aria-labelledby="recent-runs-heading">
        <h2 id="recent-runs-heading" className="sr-only">
          Recent runs
        </h2>
        {isLoading ? (
          <Card className="p-6 text-sm text-fg-muted">Loading canonical run state...</Card>
        ) : (
          <RecentRuns runs={runs} isLive={isLive} />
        )}
      </section>

      <ReleaseReadinessCard releaseId={latestReleaseId} api={api} />

      {runs.length === 0 ? (
        <EmptyState
          data-testid="runs-list-empty"
          title="No execution evidence"
          description="Launch a run with the form above to create the first one, or let the cockpit show what is blocking you."
          action={
            <a
              href="/dashboard"
              className="rounded-md bg-primary px-4 py-2 text-sm text-on-fill no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Open the cockpit
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
                      className="rounded-sm font-mono text-xs text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
                  <TableCell>{formatDate(run.createdAt, 'Not started')}</TableCell>
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
