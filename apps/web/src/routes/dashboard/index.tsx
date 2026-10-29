import React from 'react';
import { createRoute } from '@tanstack/react-router';
import {
  Badge,
  Button,
  Dialog,
  DialogClose,
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
  useFitCount,
} from '../../components/kit.js';
import { isRunActive, useRuns } from '../../hooks/useRuns.js';
import { defaultApiClient, type ApiClient, type Run } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';
import { formatDuration } from '../../lib/insights.js';
import { runDetailPath } from '../../route-manifest.js';
import { Responsive } from '../../components/responsive.js';

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
  // The table measures its own panel: a row is ~56px under a ~44px head.
  const [size, tableBox] = useFitCount(56, 8, 44);
  const pager = usePager(runs, size);
  const showProject = runs.some((run) => run.projectId != null);
  const showDuration = runs.some((run) => run.summary.durationMs != null);
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
          description="Automate could not load your runs. Try again. If this continues, ask the installation owner to check the API service and its logs."
          action={
            <div className="space-y-3">
              <Button onClick={() => void refresh()}>Try loading runs again</Button>
              <details className="text-sm text-fg-muted">
                <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus">
                  Technical details
                </summary>
                <p className="mt-2">{error.message}</p>
              </details>
            </div>
          }
        />
      </PageFrame>
    );
  }

  const passed = runs.filter((run) => run.outcome === 'passed').length;
  const failed = runs.filter((run) => run.outcome === 'failed').length;
  const active = runs.filter(isRunActive).length;

  const table = (
    <>
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
          {/*
            A column no run fills is a column of dashes. Reporter-sent runs carry neither a
            project nor a duration, so both columns appear only once some run has one.
          */}
          <div ref={tableBox} className="min-h-0 flex-1 overflow-hidden">
            <Table aria-label="Runs">
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  {showProject ? (
                    <TableHead className="hidden lg:table-cell">Project</TableHead>
                  ) : null}
                  <TableHead className="hidden md:table-cell">Phase</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  {showDuration ? (
                    <TableHead className="hidden sm:table-cell">Duration</TableHead>
                  ) : null}
                  <TableHead>Tests</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pager.items.map((run) => (
                  <TableRow key={run.id} data-testid={`run-row-${run.id}`}>
                    <TableCell>
                      <a
                        href={runDetailPath(run.id)}
                        className="inline-flex min-h-6 items-center rounded-sm font-mono text-xs text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                      >
                        {run.suite ?? run.id.slice(0, 8)}
                      </a>
                    </TableCell>
                    {showProject ? (
                      <TableCell className="hidden lg:table-cell">{run.projectId ?? '—'}</TableCell>
                    ) : null}
                    <TableCell className="hidden md:table-cell">
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
                    <TableCell className="hidden md:table-cell">
                      {formatDate(run.createdAt, 'Not started')}
                    </TableCell>
                    {showDuration ? (
                      <TableCell numeric className="hidden sm:table-cell">
                        {run.summary.durationMs != null
                          ? formatDuration(run.summary.durationMs)
                          : '—'}
                      </TableCell>
                    ) : null}
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
    </>
  );
  const readiness = <ReleaseReadinessCard releaseId={latestReleaseId} api={api} />;
  const recent = <RecentRuns runs={runs} isLive={isLive} />;

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
      <section aria-label="Run totals" className="grid shrink-0 grid-cols-4 gap-2 sm:gap-3">
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
      <Responsive
        label="Runs sections"
        desktop={
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-3">
            {table}
            <div className="flex min-h-0 flex-col gap-3">
              {readiness}
              {recent}
            </div>
          </div>
        }
        panels={[
          { id: 'runs', label: 'Runs', node: table },
          { id: 'readiness', label: 'Readiness', node: readiness },
          ...(runs.length === 0 ? [] : [{ id: 'recent', label: 'Recent', node: recent }]),
        ]}
      />
      <Dialog
        open={launching}
        onOpenChange={setLaunching}
        aria-label="Launch browser run"
        className="max-w-2xl"
      >
        <DialogContent>
          <DialogClose label="Close" />
          <LaunchRunForm
            api={api}
            onCreated={() => {
              void refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </PageFrame>
  );
}
