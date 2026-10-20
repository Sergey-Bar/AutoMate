import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import { LaunchRunForm, RecentRuns, ReleaseReadinessCard } from '../dashboard.js';
import {
  Kpi,
  PageFrame,
  PageHeader,
  Panel,
  PagerControls,
  usePager,
  useViewportRows,
} from '../../components/kit.js';
import { isRunActive, useRuns } from '../../hooks/useRuns.js';
import { defaultApiClient, type ApiClient, type Run } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { formatDuration } from '../../lib/insights.js';
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

/**
 * Every run, paged into the viewport, with readiness and the live feed beside it.
 *
 * The launch form is a dialog rather than a block above the table: eight fields above the
 * evidence made the page a form you had to scroll past to read anything, and the redesign's
 * rule is that a screen fits. It stays mounted while closed, so its state survives a
 * close-and-reopen and the idempotency key it holds is not minted twice for one run.
 */
export function RunsListPage({ api = defaultApiClient }: { api?: ApiClient }) {
  const { runs, isLoading, error, isLive, refresh } = useRuns(api);
  const [launching, setLaunching] = React.useState(false);
  // Header, totals, panel title, table head and pager take about 440px; a row is ~56px.
  const pager = usePager(runs, useViewportRows(440, 56));
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
      <PageFrame>
        <PageHeader title="Runs" />
        <EmptyState
          headingLevel={2}
          data-testid="runs-list-error"
          title="Runs unavailable"
          description={error.message}
        />
      </PageFrame>
    );
  }

  const passed = runs.filter((run) => run.outcome === 'passed').length;
  const failed = runs.filter((run) => run.outcome === 'failed').length;
  const active = runs.filter(isRunActive).length;

  return (
    <PageFrame data-testid="runs-list-page">
      <PageHeader
        title="Runs"
        subtitle={
          <span data-testid="runs-live-state">
            {isLive ? 'Live stream connected' : 'Live stream disconnected'}
          </span>
        }
        actions={
          <Button
            data-testid="launch-run-open"
            onClick={() => setLaunching(true)}
            className="min-h-11"
          >
            New browser run
          </Button>
        }
      />
      <section aria-label="Run totals" className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi data-testid="stat-total" label="Total runs" value={String(runs.length)} />
        <Kpi data-testid="stat-passed" label="Passed" value={String(passed)} tone="text-success" />
        <Kpi
          data-testid="stat-failed"
          label="Failed"
          value={String(failed)}
          tone={failed > 0 ? 'text-danger' : undefined}
        />
        <Kpi data-testid="stat-running" label="Active" value={String(active)} />
      </section>
      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        {runs.length === 0 ? (
          <EmptyState
            headingLevel={2}
            data-testid="runs-list-empty"
            title="No execution evidence"
            description="Start a tool from the Runner, launch a browser run, or let the dashboard show what is blocking you."
            action={
              <a
                href="/dashboard/runner"
                className="rounded-md bg-primary px-4 py-2 text-sm text-on-fill no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
              >
                Open the runner
              </a>
            }
          />
        ) : (
          <Panel title="All runs" data-testid="runs-table">
            <div className="min-h-0 flex-1 xl:overflow-hidden">
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
                  {pager.items.map((run) => (
                    <TableRow key={run.id} data-testid={`run-row-${run.id}`}>
                      <TableCell>
                        <a
                          href={runDetailPath(run.id)}
                          className="inline-flex min-h-6 items-center rounded-sm font-mono text-xs text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                        >
                          {run.suite ?? run.id.slice(0, 8)}
                        </a>
                      </TableCell>
                      <TableCell>{run.projectId ?? 'UNKNOWN'}</TableCell>
                      <TableCell>
                        <Badge variant={isRunActive(run) ? 'default' : 'outline'}>
                          {run.phase}
                        </Badge>
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
                      <TableCell numeric>
                        {run.summary.durationMs != null
                          ? formatDuration(run.summary.durationMs)
                          : 'UNKNOWN'}
                      </TableCell>
                      <TableCell numeric>
                        {run.summary.total > 0
                          ? `${run.summary.passed}/${run.summary.total}`
                          : 'No tests reported'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <PagerControls pager={pager} label="run" />
          </Panel>
        )}
        <div className="flex min-h-0 flex-col gap-3">
          <ReleaseReadinessCard releaseId={latestReleaseId} api={api} />
          <RecentRuns runs={runs} isLive={isLive} />
        </div>
      </div>
      <Dialog
        open={launching}
        onOpenChange={setLaunching}
        aria-label="Launch browser run"
        className="max-w-2xl"
      >
        <DialogContent>
          <LaunchRunForm
            api={api}
            onCreated={() => {
              void refresh();
            }}
          />
          <div className="mt-4 flex justify-end">
            <Button variant="outline" onClick={() => setLaunching(false)} className="min-h-11">
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
