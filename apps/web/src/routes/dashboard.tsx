import React, { useRef, useState } from 'react';
import { createRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Badge, Button, Card, EmptyState } from '@automate/ui';
import { Route as rootRoute } from './__root.js';
import type { CreateRunRequest, DomainReadinessStatus } from '@automate/shared-contracts';
import { useReleaseReadiness } from '../hooks/useDashboard.js';
import { isRunActive, useRuns } from '../hooks/useRuns.js';
import { defaultApiClient, type ApiClient, type Run } from '../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dashboard',
  component: DashboardComponent,
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

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
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

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
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
        onSubmit={submit}
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
            className="font-mono underline"
          >
            {createdRun.id}
          </a>
        </p>
      ) : null}
    </Card>
  );
}

function ReleaseReadinessCard({ releaseId, api }: { releaseId: string | null; api: ApiClient }) {
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

function RecentRuns({ runs, isLive }: { runs: Run[]; isLive: boolean }) {
  if (runs.length === 0) {
    return (
      <EmptyState
        title="No release evidence"
        description="No canonical runs exist. The system will not infer a passing release without browser evidence."
      />
    );
  }

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
            className="flex items-center justify-between gap-4 p-4 no-underline hover:bg-surface-muted"
          >
            <div className="min-w-0">
              <div className="truncate font-mono text-sm">{run.id}</div>
              <div className="mt-1 text-xs text-fg-muted">
                {run.projectId ?? 'UNKNOWN PROJECT'} · {formatDate(run.createdAt)}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant={isRunActive(run) ? 'default' : 'outline'}>{run.phase}</Badge>
              <Badge
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

function DashboardComponent() {
  const routerState = useRouterState();
  const isExactDashboard = routerState.location.pathname === '/dashboard';
  const api = defaultApiClient;
  const { runs, isLoading, error, isLive, refresh } = useRuns(api);
  const latestReleaseId = runs.find((run) => run.releaseId)?.releaseId ?? null;

  if (!isExactDashboard) return <Outlet />;

  return (
    <div data-testid="dashboard-page" className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-accent">
          Browser QA evidence
        </p>
        <h1 className="mt-2 text-3xl font-bold">Release Command Center</h1>
        <p className="mt-2 max-w-3xl text-sm text-fg-muted">
          Launch registered browser runs, inspect canonical phase and outcome, and gate releases
          from persisted evidence. Non-browser domains remain unknown or not configured until
          executable adapters exist.
        </p>
      </header>

      {error ? (
        <div
          data-testid="command-center-error"
          role="alert"
          className="rounded-md border border-danger p-4 text-sm text-danger"
        >
          {error.message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
        <div className="space-y-6">
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
        </div>
        <ReleaseReadinessCard releaseId={latestReleaseId} api={api} />
      </div>
    </div>
  );
}
