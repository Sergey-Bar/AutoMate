import React, { useRef, useState } from 'react';
import { createRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Badge, Button } from '@automate/ui';
import { Route as rootRoute } from './__root.js';
import type { CreateRunRequest, DomainReadinessStatus } from '@automate/shared-contracts';
import { useReleaseReadiness } from '../hooks/useDashboard.js';
import { isRunActive } from '../hooks/useRuns.js';
import { Dashboard } from '../components/Dashboard.js';
import { Panel, Quiet } from '../components/kit.js';
import { createQaClient } from '../lib/qa-client.js';
import { defaultApiClient, type ApiClient, type Run } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardLayout,
});

/**
 * `run.createdAt` is a required `string` here, so there is no empty state to
 * render and no fallback to invent — one would be a user-visible string chosen
 * by a refactor. The shared helper takes a fallback, so this stays a thin
 * non-fallback wrapper over the same `toLocaleString()`.
 */
function formatRequiredDate(value: string): string {
  return formatDate(value, '');
}

function readinessTone(
  status: DomainReadinessStatus,
): 'success' | 'danger' | 'warning' | 'secondary' {
  if (status === 'passed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'warning' || status === 'unknown') return 'warning';
  return 'secondary';
}

export function LaunchRunForm({ api, onCreated }: { api: ApiClient; onCreated: () => void }) {
  const [projectId, setProjectId] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [releaseId, setReleaseId] = useState('');
  const [branch, setBranch] = useState('');
  const [commit, setCommit] = useState('');
  const [selection, setSelection] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState('1800');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [createdRun, setCreatedRun] = useState<Run | null>(null);
  const idempotencyKey = useRef<string | null>(null);

  /**
   * The form handler itself. It is sync because it awaits the create call,
   * but React does not await an onSubmit handler: the value it returns is
   * discarded, and a rejection there would be an unhandled rejection rather
   * than a visible error.
   *
   * So the async part is a named function and the handler is a thin wrapper that
   * discards the promise *after* attaching a catch, which is what turns a failed
   * submit into the error state this component already renders.
   */
  const submitAsync = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    const key = idempotencyKey.current ?? crypto.randomUUID();
    idempotencyKey.current = key;
    const body: CreateRunRequest = {
      projectId: projectId.trim(),
      environmentId: environmentId.trim(),
      releaseId: releaseId.trim(),
      branch: branch.trim(),
      commit: commit.trim(),
      testType: 'browser',
      framework: 'playwright',
      source: 'web',
      selection: {
        testIds: [],
        paths: selection
          .split(/[\n,]/u)
          .map((value) => value.trim())
          .filter(Boolean),
        tags: [],
      },
      timeoutMs: Math.max(1, Number(timeoutSeconds)) * 1_000,
      idempotencyKey: key,
      priority: 0,
      requiredCapabilities: ['playwright'],
      labels: [],
      configuration: {},
      metadata: {},
    };

    try {
      const run = await api.createRun(body);
      setCreatedRun(run);
      idempotencyKey.current = null;
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('Run launch failed'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputClass =
    'mt-1 w-full rounded-md border border-border-default bg-surface px-3 py-2 text-sm outline-none focus:border-accent';

  return (
    <div>
      <div>
        <h2 className="text-lg font-semibold">Launch browser run</h2>
        <p className="mt-1 max-w-measure text-sm text-fg-muted">
          Project, environment, and release IDs must already be registered with the execution
          service.
        </p>
      </div>
      <form
        data-testid="launch-run-form"
        onSubmit={(event) => void submitAsync(event)}
        className="mt-5 grid gap-4 md:grid-cols-2"
      >
        <label className="text-sm font-medium">
          Project ID
          <input
            data-testid="launch-project-id"
            required
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium">
          Environment ID
          <input
            data-testid="launch-environment-id"
            required
            value={environmentId}
            onChange={(event) => setEnvironmentId(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium">
          Release ID
          <input
            data-testid="launch-release-id"
            required
            value={releaseId}
            onChange={(event) => setReleaseId(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium">
          Branch
          <input
            data-testid="launch-branch"
            required
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium">
          Commit
          <input
            data-testid="launch-commit"
            required
            value={commit}
            onChange={(event) => setCommit(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium">
          Timeout (seconds)
          <input
            data-testid="launch-timeout"
            required
            type="number"
            min="1"
            value={timeoutSeconds}
            onChange={(event) => setTimeoutSeconds(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="text-sm font-medium md:col-span-2">
          Test path selection
          <textarea
            data-testid="launch-selection"
            rows={3}
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
            placeholder="e2e/fixtures/playwright-smoke/pass.spec.ts"
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-fg-muted">
            Comma or newline separated. Leave empty for the registered project default.
          </span>
        </label>
        <div className="md:col-span-2">
          <Button data-testid="launch-run-submit" type="submit" loading={isSubmitting}>
            Queue browser run
          </Button>
        </div>
      </form>
      {error ? (
        <p data-testid="launch-run-error" role="alert" className="mt-4 text-sm text-danger">
          {error.message}
        </p>
      ) : null}
      {createdRun ? (
        <p data-testid="launch-run-created" className="mt-4 text-sm text-success">
          Run queued.{' '}
          <a
            href={`/dashboard/runs/${encodeURIComponent(createdRun.id)}`}
            className="rounded-sm font-mono underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {createdRun.id}
          </a>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Release readiness, compact: one row per domain, the decision in the panel header.
 *
 * Rows rather than the tile grid it used to be, because seven tiles at three per row was a
 * third of the runs page on its own and the redesign's runs page fits the viewport.
 */
export function ReleaseReadinessCard({
  releaseId,
  api,
}: {
  releaseId: string | null;
  api: ApiClient;
}) {
  const { data, isLoading, error } = useReleaseReadiness(releaseId, api);

  if (isLoading) {
    return (
      <Panel title="Release readiness">
        <Quiet>Loading persisted gate evidence…</Quiet>
      </Panel>
    );
  }

  return (
    <Panel
      title="Release readiness"
      data-testid="release-readiness"
      action={
        <Badge
          variant={
            data?.decision === 'ready'
              ? 'success'
              : data?.decision === 'blocked'
                ? 'danger'
                : 'warning'
          }
        >
          {(data?.decision ?? 'unknown').toUpperCase()}
        </Badge>
      }
    >
      <p className="max-w-measure truncate text-xs text-fg-muted">
        {releaseId ? `Release ${releaseId}` : 'No release selected'}
      </p>
      {error ? (
        <p className="mt-1 max-w-measure text-xs text-danger">
          Readiness could not be loaded: {error.message}
        </p>
      ) : null}
      {data ? (
        <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          {Object.entries(data.domains).map(([domain, status]) => (
            <li key={domain} className="flex min-w-0 flex-col">
              <span className="text-xs capitalize text-fg-muted">{domain}</span>
              <Badge variant={readinessTone(status)} className="self-start">
                {status.toUpperCase()}
              </Badge>
            </li>
          ))}
        </ul>
      ) : error ? null : (
        // No release, so nothing was evaluated: no per-domain status is drawn, because one
        // drawn here would be a claim about the install that no read made.
        <Quiet data-testid="release-readiness-unread">
          No readiness has been evaluated. A run that names a release brings its evidence here.
        </Quiet>
      )}
    </Panel>
  );
}

export function RecentRuns({ runs, isLive }: { runs: Run[]; isLive: boolean }) {
  // **Nothing, not an empty state.** This panel sits beside the full run table, which
  // renders its own empty state. Two "there is nothing here" panels on one screen is noise
  // that reads as two separate failures.
  if (runs.length === 0) return null;

  return (
    <Panel
      title="Recent executions"
      action={<span className="text-xs text-fg-muted">{isLive ? 'LIVE' : 'RECONNECTING'}</span>}
    >
      <div className="divide-y divide-border-default">
        {runs.slice(0, 3).map((run) => (
          <Link
            key={run.id}
            to="/dashboard/runs/$runId"
            params={{ runId: run.id }}
            data-testid={`run-item-${run.id}`}
            className="flex items-center justify-between gap-3 rounded-md py-2 no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-xs" title={run.suite ?? run.id}>
                {run.suite ?? run.id}
              </div>
              <div className="text-xs text-fg-muted">{formatRequiredDate(run.createdAt)}</div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <Badge variant={isRunActive(run) ? 'default' : 'outline'}>{run.phase}</Badge>
              {/*
               * `role="status"` is a polite live region, so a screen-reader user hears
               * "run-42 passed" the moment the status flips. Without it the badge silently
               * changes colour and text under a user who is watching something else.
               */}
              <Badge
                role="status"
                aria-live="polite"
                data-testid={`run-status-${run.id}`}
                variant={
                  run.outcome === 'passed'
                    ? 'success'
                    : run.outcome === 'failed'
                      ? 'danger'
                      : 'secondary'
                }
              >
                {(run.outcome ?? (run.phase === 'running' ? 'running' : run.phase)).toLowerCase()}
              </Badge>
            </div>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

/**
 * The dashboard layout, and the only component on the `/dashboard` path.
 *
 * `/dashboard` is the dashboard: open the install and read the whole QA picture of the
 * repository. Every other screen is a child route rendered through the outlet.
 *
 * **It calls no hook that opens a resource.** `useRuns` used to be called here *before*
 * the exact-path guard, so every child route ran a second armed poller and a second list
 * fetch that nothing rendered (ledger W-5). `useRouterState` is a subscription, not a
 * resource: it holds no socket and arms no timer. The test that says so is
 * `dashboard.test.tsx` › "arms one run poller on the runs route, not one per level".
 */
function DashboardLayout() {
  const isExactDashboard = useRouterState({
    select: (state) => state.location.pathname === '/dashboard',
  });

  return (
    <div data-testid="dashboard-page" className="h-full min-h-0">
      {isExactDashboard ? <Dashboard qa={createQaClient()} api={defaultApiClient} /> : <Outlet />}
    </div>
  );
}
