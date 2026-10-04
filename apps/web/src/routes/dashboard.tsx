import React, { useRef, useState } from 'react';
import { createRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Badge, Button, Card } from '@automate/ui';
import { Route as rootRoute } from './__root.js';
import type { CreateRunRequest, DomainReadinessStatus } from '@automate/shared-contracts';
import { useReleaseReadiness } from '../hooks/useDashboard.js';
import { isRunActive } from '../hooks/useRuns.js';
import { Cockpit } from '../components/Cockpit.js';
import { createQaClient } from '../lib/qa-client.js';
import { defaultApiClient, type ApiClient, type Run } from '../lib/api.js';
import { formatDate } from '../lib/format.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardLayout,
});

const DEFAULT_DOMAIN_STATUS: Record<string, DomainReadinessStatus> = {
  browser: 'unknown',
  api: 'not_configured',
  mobile: 'not_configured',
  performance: 'not_configured',
  security: 'not_configured',
  accessibility: 'not_configured',
  other: 'not_configured',
};

const DEFAULT_DOMAIN_REASONS: Record<string, string> = {
  browser: 'No release evidence has been evaluated.',
  api: 'No executable API quality adapter is configured.',
  mobile: 'No executable mobile adapter is configured.',
  performance: 'No executable performance adapter is configured.',
  security: 'No executable security adapter is configured.',
  accessibility: 'No executable accessibility adapter is configured.',
  other: 'No additional quality adapter is configured.',
};

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
    <Card className="p-6">
      <div>
        <h2 className="text-lg font-semibold">Launch browser run</h2>
        <p className="mt-1 text-sm text-fg-muted">
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
    </Card>
  );
}

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
      <Card className="p-6">
        <h2 className="text-lg font-semibold">Release readiness</h2>
        <p className="mt-3 text-sm text-fg-muted">Loading persisted gate evidence...</p>
      </Card>
    );
  }

  const domains = Object.entries(data?.domains ?? DEFAULT_DOMAIN_STATUS);

  return (
    <Card className="p-6" data-testid="release-readiness">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Release readiness</h2>
          <p className="mt-1 text-sm text-fg-muted">
            {releaseId ? `Release ${releaseId}` : 'No release selected'}
          </p>
        </div>
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
      </div>
      {error ? (
        <p className="mt-3 text-sm text-danger">Readiness could not be loaded: {error.message}</p>
      ) : null}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {domains.map(([domain, status]) => {
          const reason = data ? undefined : DEFAULT_DOMAIN_REASONS[domain];
          return (
            <div key={domain} className="rounded-md border border-border-default p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium capitalize">{domain}</span>
                <Badge variant={readinessTone(status)}>{status.toUpperCase()}</Badge>
              </div>
              {reason ? <p className="mt-2 text-xs text-fg-muted">{reason}</p> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function RecentRuns({ runs, isLive }: { runs: Run[]; isLive: boolean }) {
  // **Nothing, not an empty state.** This card now sits on the runs page beside the
  // full run table, which renders its own empty state. Two "there is nothing here"
  // panels on one screen is noise that reads as two separate failures, and the older
  // panel said "No canonical runs exist" while the newer one said "No execution
  // evidence" — the same fact in two words.
  if (runs.length === 0) return null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border-default p-4">
        <h2 className="font-semibold">Recent executions</h2>
        <span className="text-xs text-fg-muted">{isLive ? 'LIVE' : 'RECONNECTING'}</span>
      </div>
      <div className="divide-y divide-border-default">
        {runs.slice(0, 5).map((run) => (
          <Link
            key={run.id}
            to="/dashboard/runs/$runId"
            params={{ runId: run.id }}
            data-testid={`run-item-${run.id}`}
            className="flex items-center justify-between gap-4 p-4 no-underline hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-sm">{run.id}</div>
              <div className="mt-1 text-xs text-fg-muted">
                {run.projectId ?? 'UNKNOWN PROJECT'} · {formatRequiredDate(run.createdAt)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={isRunActive(run) ? 'default' : 'outline'}>{run.phase}</Badge>
              {/*
               * `role="status"` is a polite live region, so a screen-reader user
               * hears "run-42 passed" the moment the status flips. Without it the
               * badge silently changes colour and text under a user who is
               * watching something else, and the only sign a run finished is a
               * change they were not told about.
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
    </Card>
  );
}

/**
 * The dashboard layout, and the only component on the `/dashboard` path.
 *
 * ## What it does, and what it deliberately does not
 *
 * `/dashboard` is the cockpit: open the install, see what is blocking you. A home
 * page that asks you to fill in a form before it tells you anything is a form, so
 * the launch form moved to `/dashboard/runs` and this layout either renders the
 * cockpit or renders the child route.
 *
 * **It calls no hook that opens a resource.** That is the whole of ledger W-5, which
 * stayed open here for a year: `useRuns` used to be called here *before* the
 * `if (!isExactDashboard) return <Outlet />` guard, so every child route ran a second
 * copy of it — a second armed five-second poller and a second list fetch that nothing
 * rendered, because a hook cannot be called conditionally and the early return came
 * too late. The shared `EventSource` was fixed separately; the duplicate poller was
 * not, and it was left open because landing the fix without its covering test would
 * have cost a line against `apps/web`'s deliberately raised floor.
 *
 * `useRouterState` is a subscription, not a resource: it holds no socket and arms no
 * timer, so reading the path here costs nothing. The test that says so is
 * `dashboard.test.tsx` ? "arms one run poller on the runs route, not one per level".
 */
function DashboardLayout() {
  const isExactDashboard = useRouterState({
    select: (state) => state.location.pathname === '/dashboard',
  });

  return (
    <div data-testid="dashboard-page" className="space-y-6">
      {isExactDashboard ? <Cockpit qa={createQaClient()} api={defaultApiClient} /> : <Outlet />}
    </div>
  );
}
