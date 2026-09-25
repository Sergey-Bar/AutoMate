import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, Button, Card, EmptyState } from '@automate/ui';
import type { RunPhase } from '@automate/shared-contracts';
import { Route as dashboardRoute } from '../dashboard.js';
import { useRunDetail } from '../../hooks/useDashboard.js';
import { isRunActive } from '../../hooks/useRuns.js';
import { getArtifactUrl, type ApiClient, type Run } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/runs/$runId',
  component: () => {
    const { runId } = Route.useParams();
    return <RunDetailPage id={runId} />;
  },
});

const PHASES: RunPhase[] = [
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
  'complete',
];

const ACTIVE_PHASES = new Set<RunPhase>([
  'queued',
  'assigned',
  'preparing',
  'running',
  'collecting',
  'normalizing',
  'analyzing',
  'gate_evaluation',
]);

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'UNKNOWN';
}

function outcomeTone(outcome: string | null): 'success' | 'danger' | 'warning' | 'secondary' {
  if (outcome === 'passed') return 'success';
  if (outcome === 'failed') return 'danger';
  if (outcome === 'unknown' || outcome === 'partial') return 'warning';
  return 'secondary';
}

function PhaseTimeline({ phase }: { phase: RunPhase }) {
  const active = ACTIVE_PHASES.has(phase);
  const currentIndex = PHASES.indexOf(phase);

  return (
    <ol className="flex flex-wrap gap-2" aria-label="Run phase timeline">
      {PHASES.map((item, index) => {
        const complete = currentIndex >= index && currentIndex >= 0;
        return (
          <li
            key={item}
            data-testid={`phase-${item}`}
            className={`rounded-full border px-3 py-1 text-xs ${
              item === phase
                ? 'border-accent bg-accent text-white'
                : complete
                  ? 'border-success text-success'
                  : 'border-border-default text-fg-muted'
            }`}
          >
            {item.replace('_', ' ')}
          </li>
        );
      })}
      {!active && !PHASES.includes(phase) ? (
        <li
          data-testid={`phase-${phase}`}
          className="rounded-full border border-danger bg-danger px-3 py-1 text-xs text-white"
        >
          {phase.replace('_', ' ')}
        </li>
      ) : null}
    </ol>
  );
}

function TestEvidence({ tests }: { tests: Run['tests'] }) {
  if (tests.length === 0) {
    return <p className="text-sm text-fg-muted">No normalized test attempts have been reported.</p>;
  }

  return (
    <div className="space-y-3">
      {tests.map((test) => (
        <details
          key={test.id}
          data-testid={`test-${test.id}`}
          className="rounded-md border border-border-default p-4"
        >
          <summary className="cursor-pointer">
            <span className="font-medium">{test.title}</span>
            <span className="ml-3 text-xs uppercase text-fg-muted">{test.status}</span>
          </summary>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-fg-muted">File</dt>
              <dd>{test.file ?? 'UNKNOWN'}</dd>
            </div>
            <div>
              <dt className="text-xs text-fg-muted">Duration</dt>
              <dd>{test.durationMs == null ? 'UNKNOWN' : `${test.durationMs}ms`}</dd>
            </div>
          </dl>
          {test.error ? (
            <div
              data-testid={`test-error-${test.id}`}
              className="mt-3 rounded-md border border-danger p-3 text-sm"
            >
              <div className="font-semibold text-danger">{test.error.code}</div>
              <div>{test.error.message}</div>
            </div>
          ) : null}
          <div className="mt-4 space-y-2">
            <h4 className="text-xs font-semibold uppercase text-fg-muted">Attempts</h4>
            {test.attempts.length > 0 ? (
              test.attempts.map((attempt) => (
                <div key={attempt.attempt} className="rounded bg-surface-muted p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span>Attempt {attempt.attempt}</span>
                    <span className="uppercase">{attempt.status}</span>
                  </div>
                  <div className="mt-1 text-xs text-fg-muted">
                    {formatDate(attempt.startedAt)} → {formatDate(attempt.finishedAt)}
                  </div>
                  {attempt.error ? (
                    <div className="mt-2 text-danger">{attempt.error.message}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="text-sm text-fg-muted">No retry attempts were reported.</p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

export function RunDetailPage({ id, api }: { id: string; api?: ApiClient }) {
  const {
    run,
    artifacts,
    gate,
    readiness,
    events,
    evidenceError,
    isLoading,
    error,
    actionError,
    isActing,
    isLive,
    cancel,
    retry,
  } = useRunDetail(id, api);
  const [retryTarget, setRetryTarget] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div data-testid="run-detail-loading" className="p-8">
        Loading canonical run {id}...
      </div>
    );
  }

  if (error) {
    if (error.message.toLowerCase().includes('not found') || error.message.includes('404')) {
      return (
        <EmptyState
          data-testid="run-not-found"
          title="Run not found"
          description={`No canonical run exists for ${id}.`}
        />
      );
    }
    return (
      <EmptyState data-testid="run-error" title="Run unavailable" description={error.message} />
    );
  }

  if (!run) return null;

  const performCancel = async () => {
    try {
      await cancel();
    } catch {
      return;
    }
  };

  const performRetry = async () => {
    try {
      const next = await retry();
      setRetryTarget(next.id);
    } catch {
      return;
    }
  };

  return (
    <div data-testid="run-detail-page" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <a href="/dashboard/runs" className="text-sm text-accent no-underline hover:underline">
            ← Runs
          </a>
          <h1 className="mt-2 text-2xl font-bold">Run detail</h1>
          <div data-testid="run-id" className="mt-1 break-all font-mono text-sm text-fg-muted">
            {run.id}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">{isLive ? 'LIVE' : 'RECONNECTING'}</span>
          <Badge data-testid="run-phase" variant={isRunActive(run) ? 'default' : 'outline'}>
            {run.phase}
          </Badge>
          <Badge data-testid="run-status" variant={outcomeTone(run.outcome)}>
            {(run.outcome ?? 'PENDING').toUpperCase()}
          </Badge>
        </div>
      </div>

      <Card className="p-5">
        <PhaseTimeline phase={run.phase} />
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Execution summary</h2>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <div className="text-xs text-fg-muted">Total</div>
                <div data-testid="run-total">{run.summary.total}</div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Passed</div>
                <div data-testid="run-passed" className="text-success">
                  {run.summary.passed}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Failed</div>
                <div data-testid="run-failed" className="text-danger">
                  {run.summary.failed}
                </div>
              </div>
              <div>
                <div className="text-xs text-fg-muted">Duration</div>
                <div data-testid="run-duration">
                  {run.summary.durationMs == null ? 'UNKNOWN' : `${run.summary.durationMs}ms`}
                </div>
              </div>
            </div>
            {run.error ? (
              <div
                data-testid="run-error-context"
                className="mt-5 rounded-md border border-danger p-4 text-sm"
              >
                <div className="font-semibold text-danger">{run.error.code}</div>
                <div>{run.error.message}</div>
              </div>
            ) : null}
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold">Test attempts</h2>
            <div className="mt-4">
              <TestEvidence tests={run.tests} />
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold">Artifacts</h2>
            {evidenceError ? (
              <p className="mt-3 text-sm text-warning">
                Some artifact metadata could not be refreshed.
              </p>
            ) : null}
            {artifacts.length > 0 ? (
              <ul className="mt-4 divide-y divide-border-default">
                {artifacts.map((artifact) => (
                  <li key={artifact.id} className="py-3">
                    <a
                      href={getArtifactUrl(artifact.id)}
                      className="font-medium text-accent hover:underline"
                    >
                      {artifact.name ?? artifact.kind}
                    </a>
                    <div className="mt-1 text-xs text-fg-muted">
                      {artifact.kind} · {artifact.sizeBytes} bytes · SHA-256{' '}
                      {artifact.checksum.slice(0, 12)}...
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-fg-muted">
                No persisted artifacts have been reported.
              </p>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-lg font-semibold">Live event timeline</h2>
            {events.length > 0 ? (
              <ol className="mt-4 space-y-3">
                {events.map((event) => (
                  <li
                    key={event.eventId}
                    className="rounded-md border border-border-default p-3 text-sm"
                  >
                    <div className="flex justify-between gap-3">
                      <span className="font-medium">{event.type}</span>
                      <span className="text-xs text-fg-muted">#{event.sequence}</span>
                    </div>
                    <div className="mt-1 text-xs text-fg-muted">{formatDate(event.occurredAt)}</div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-sm text-fg-muted">
                No events have been observed in this browser session. Run state above is the
                authoritative API snapshot.
              </p>
            )}
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="p-6">
            <h2 className="text-lg font-semibold">Run context</h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-fg-muted">Project</dt>
                <dd data-testid="run-project">{run.projectId ?? 'UNKNOWN'}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Environment</dt>
                <dd>{run.environmentId ?? 'UNKNOWN'}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Release</dt>
                <dd>{run.releaseId ?? 'UNKNOWN'}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Branch / Commit</dt>
                <dd>
                  {run.branch ?? 'UNKNOWN'} / {run.commit ?? 'UNKNOWN'}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Framework</dt>
                <dd>{run.framework ?? 'UNKNOWN'}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Runner</dt>
                <dd>{run.runner?.name ?? run.runner?.id ?? 'UNASSIGNED'}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Created</dt>
                <dd>{formatDate(run.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Started</dt>
                <dd>{formatDate(run.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-fg-muted">Finished</dt>
                <dd>{formatDate(run.finishedAt)}</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-6" data-testid="run-gate">
            <h2 className="text-lg font-semibold">Quality gate</h2>
            {gate ? (
              <>
                <Badge
                  className="mt-3"
                  variant={
                    gate.status === 'passed'
                      ? 'success'
                      : gate.status === 'failed'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {gate.status.toUpperCase()}
                </Badge>
                <ul className="mt-4 space-y-2 text-sm">
                  {gate.reasons.map((reason, index) => (
                    <li key={`${reason}-${index}`}>{reason}</li>
                  ))}
                </ul>
                {gate.evidenceRefs.length > 0 ? (
                  <p className="mt-4 text-xs text-fg-muted">
                    Evidence: {gate.evidenceRefs.join(', ')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-fg-muted">
                UNKNOWN — no persisted gate evaluation is available.
              </p>
            )}
          </Card>

          {readiness ? (
            <Card className="p-6" data-testid="run-readiness">
              <h2 className="text-lg font-semibold">Release readiness</h2>
              <Badge
                className="mt-3"
                variant={
                  readiness.decision === 'ready'
                    ? 'success'
                    : readiness.decision === 'blocked'
                      ? 'danger'
                      : 'warning'
                }
              >
                {readiness.decision.toUpperCase()}
              </Badge>
              <div className="mt-4 space-y-2 text-sm">
                {Object.entries(readiness.domains).map(([domain, status]) => (
                  <div key={domain} className="flex justify-between gap-3">
                    <span className="capitalize">{domain}</span>
                    <span>{status.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="p-6">
            <h2 className="text-lg font-semibold">Actions</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {isRunActive(run) ? (
                <Button
                  data-testid="cancel-run"
                  variant="destructive"
                  disabled={isActing}
                  onClick={() => void performCancel()}
                >
                  Cancel run
                </Button>
              ) : null}
              {!isRunActive(run) && run.outcome !== 'passed' ? (
                <Button
                  data-testid="retry-run"
                  variant="secondary"
                  disabled={isActing}
                  onClick={() => void performRetry()}
                >
                  Retry run
                </Button>
              ) : null}
            </div>
            {actionError ? (
              <p role="alert" className="mt-3 text-sm text-danger">
                {actionError.message}
              </p>
            ) : null}
            {retryTarget ? (
              <a
                data-testid="retry-run-link"
                href={`/dashboard/runs/${encodeURIComponent(retryTarget)}`}
                className="mt-3 block text-sm text-accent hover:underline"
              >
                Open retried run {retryTarget}
              </a>
            ) : null}
          </Card>
        </aside>
      </div>
    </div>
  );
}
