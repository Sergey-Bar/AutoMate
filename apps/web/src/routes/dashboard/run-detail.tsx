import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, Button, EmptyState } from '@automate/ui';
import type { RunPhase } from '@automate/shared-contracts';
import { Route as dashboardRoute } from '../dashboard.js';
import { useRunDetail } from '../../hooks/useDashboard.js';
import { isRunActive } from '../../hooks/useRuns.js';
import { ApiError, getArtifactUrl, type ApiClient, type Run } from '../../lib/api.js';
import { formatDate as formatDateWithFallback } from '../../lib/format.js';
import { formatDuration } from '../../lib/insights.js';
import { PageFrame, Panel } from '../../components/kit.js';

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

/**
 * Run detail says `UNKNOWN` where the runs list says `Not started`: here the
 * field is unknown, not the run unstarted. The shared helper takes the fallback
 * as a parameter precisely so the two screens keep making different claims.
 */
function formatDate(value: string | null | undefined): string {
  return formatDateWithFallback(value, 'UNKNOWN');
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
                ? 'border-accent bg-accent text-on-fill'
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
          className="rounded-full border border-danger bg-danger px-3 py-1 text-xs text-on-fill"
        >
          {phase.replace('_', ' ')}
        </li>
      ) : null}
    </ol>
  );
}

function TestEvidence({ tests }: { tests: Run['tests'] }) {
  if (tests.length === 0) {
    return (
      <p className="text-sm text-fg-muted max-w-measure text-pretty">
        No normalized test attempts have been reported.
      </p>
    );
  }

  return (
    /*
     * The evidence surfaces sit one step *below* the panels, not on them.
     *
     * `--automate-surface-sunken` is the plane step for content that is being
     * inspected rather than acted on: the test block and each timeline entry are
     * both things a reader is reading closely, and painting them on the same step as
     * the `Card` around them makes the page a field of identical rectangles with no
     * distinction between the chrome and the claim.
     *
     * `border-border-default` rather than `border-border-strong`, and the
     * distinction is not cosmetic: the strong border is the edge that is the only
     * thing delineating a *control*, which these are not.
     */
    <div className="space-y-3">
      {tests.map((test) => (
        <details
          key={test.id}
          data-testid={`test-${test.id}`}
          className="rounded-md border border-border-default bg-surface-sunken p-4"
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
            {/*
              `h3`, not `h4`, and the eyebrow idiom the rest of the product uses.
              *
              * It was an `<h4>`, which in a file whose screen heading is an `<h1>` and whose
              * section is an `<h2>` skipped a level — and it was the *first* heading in the
              * file, so the screen's heading list began at `h4` and the `h1` came third. The
              * `Composition` sweep found it, and it found it only because that sweep starts
              * from zero and checks the first heading rather than checking that each level
              * follows the one before it: an `h4` first satisfies "no level is skipped"
              * vacuously.
              */}
            <h3 className="font-semibold uppercase tracking-widest text-fg-muted text-xs">
              Attempts
            </h3>
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
              <p className="text-sm text-fg-muted max-w-measure text-pretty">
                No retry attempts were reported.
              </p>
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
    // On the status, not on the message. The API already sends a distinct code and
    // status for this — `DomainError('RUN_NOT_FOUND')` renders as
    // `{ error: { code, message, requestId } }` with a 404 — and the old check read
    // `error.message` looking for the words "not found". It worked only because the
    // server's English prose happened to contain them: translate the string, or
    // reword it, and the run silently becomes a generic error (ledger W-6).
    //
    // The hook types this as `Error` while the value it stores is an `ApiError`, so
    // the status is read through an `instanceof` check rather than a cast. An error
    // that is not an `ApiError` carries no status to read, and falls through to the
    // generic state, which is the honest answer for an error of unknown provenance.
    if (error instanceof ApiError && error.status === 404) {
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

  // A type guard, and nothing more: every line below narrows `run`, so this
  // cannot be deleted without a typecheck error. It is also currently `unreachable` —
  // `useRunDetail` dereferences `run.releaseId` straight after the fetch
  // (`hooks/useDashboard.ts:131`), so a null run raises a TypeError inside the hook
  // and arrives here as an error, not as an empty run. Ledger W-6's other claim is
  // therefore half wrong, and the half that is right — matching a 404 on the status
  // instead of on the server's English prose — is fixed above. Making this state
  // reachable means optional-chaining the hook first; that is not done here, so this
  // guard keeps its original shape rather than gaining a branch no test can reach.
  if (run === null) return null;

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
    <PageFrame data-testid="run-detail-page">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <a
            href="/dashboard/runs"
            className="rounded-sm text-sm text-accent no-underline hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            ← Runs
          </a>
          <h1 className="mt-1 text-3xl font-light tracking-tight">Run detail</h1>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-sm text-fg-muted">
            {run.suite ? <span className="truncate font-mono text-fg">{run.suite}</span> : null}
            <span data-testid="run-id" className="truncate font-mono">
              {run.id}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">{isLive ? 'LIVE' : 'RECONNECTING'}</span>
          <Badge data-testid="run-phase" variant={isRunActive(run) ? 'default' : 'outline'}>
            {run.phase}
          </Badge>
          <Badge data-testid="run-status" variant={outcomeTone(run.outcome)}>
            {(run.outcome ?? 'PENDING').toUpperCase()}
          </Badge>
          {isRunActive(run) ? (
            <Button
              data-testid="cancel-run"
              variant="destructive"
              disabled={isActing}
              onClick={() => void performCancel()}
              className="min-h-11"
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
              className="min-h-11"
            >
              Retry run
            </Button>
          ) : null}
        </div>
      </header>
      {actionError || retryTarget ? (
        <div className="flex shrink-0 flex-wrap items-center gap-3 text-sm">
          {actionError ? (
            <p role="alert" className="max-w-measure text-danger">
              {actionError.message}
            </p>
          ) : null}
          {retryTarget ? (
            <a
              data-testid="retry-run-link"
              href={`/dashboard/runs/${encodeURIComponent(retryTarget)}`}
              className="rounded-sm text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Open retried run {retryTarget}
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="shrink-0 rounded-2xl border border-border bg-surface-raised px-4 py-3">
        <PhaseTimeline phase={run.phase} />
      </div>

      <section
        aria-label="Execution summary"
        className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4"
      >
        <Figure label="Total" testId="run-total" value={String(run.summary.total)} />
        <Figure
          label="Passed"
          testId="run-passed"
          value={String(run.summary.passed)}
          tone="text-success"
        />
        <Figure
          label="Failed"
          testId="run-failed"
          value={String(run.summary.failed)}
          tone="text-danger"
        />
        <Figure
          label="Duration"
          testId="run-duration"
          value={
            run.summary.durationMs == null ? 'UNKNOWN' : formatDuration(run.summary.durationMs)
          }
        />
      </section>
      {run.error ? (
        <div
          data-testid="run-error-context"
          className="shrink-0 rounded-xl border border-danger px-4 py-2 text-sm"
        >
          <span className="font-semibold text-danger">{run.error.code}</span>{' '}
          <span>{run.error.message}</span>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Panel title="Test attempts">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TestEvidence tests={run.tests} />
          </div>
        </Panel>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="Artifacts" className="min-h-0 flex-1">
            {evidenceError ? (
              <p className="max-w-measure text-pretty text-sm text-warning">
                Some artifact metadata could not be refreshed.
              </p>
            ) : null}
            {artifacts.length > 0 ? (
              <ul className="min-h-0 flex-1 divide-y divide-border-default overflow-y-auto">
                {artifacts.map((artifact) => (
                  <li key={artifact.id} className="py-2">
                    <a
                      href={getArtifactUrl(artifact.id)}
                      className="rounded-sm font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
                    >
                      {artifact.name ?? artifact.kind}
                    </a>
                    <div className="mt-0.5 truncate text-xs text-fg-muted">
                      {artifact.kind} · {artifact.sizeBytes} bytes · SHA-256{' '}
                      {artifact.checksum.slice(0, 12)}...
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="max-w-measure text-pretty text-sm text-fg-muted">
                No persisted artifacts have been reported.
              </p>
            )}
          </Panel>
          <Panel title="Live event timeline" className="min-h-0 flex-1">
            {events.length > 0 ? (
              <ol className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
                {events.map((event) => (
                  <li
                    key={event.eventId}
                    className="flex justify-between gap-3 rounded-md bg-surface-sunken px-3 py-1.5 text-sm"
                  >
                    <span className="truncate font-medium">{event.type}</span>
                    <span className="shrink-0 text-xs text-fg-muted">
                      #{event.sequence} · {formatDate(event.occurredAt)}
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="max-w-measure text-pretty text-sm text-fg-muted">
                No events have been observed in this browser session. Run state above is the
                authoritative API snapshot.
              </p>
            )}
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel title="Run context" className="min-h-0 flex-1">
            <dl className="grid min-h-0 grid-cols-2 gap-x-3 gap-y-2 overflow-y-auto text-sm">
              <ContextItem
                label="Project"
                testId="run-project"
                value={run.projectId ?? 'UNKNOWN'}
              />
              <ContextItem label="Environment" value={run.environmentId ?? 'UNKNOWN'} />
              <ContextItem label="Release" value={run.releaseId ?? 'UNKNOWN'} />
              <ContextItem
                label="Branch / Commit"
                value={`${run.branch ?? 'UNKNOWN'} / ${run.commit ?? 'UNKNOWN'}`}
              />
              <ContextItem label="Framework" value={run.framework ?? 'UNKNOWN'} />
              <ContextItem
                label="Runner"
                value={run.runner?.name ?? run.runner?.id ?? 'UNASSIGNED'}
              />
              <ContextItem label="Created" value={formatDate(run.createdAt)} />
              <ContextItem label="Started" value={formatDate(run.startedAt)} />
              <ContextItem label="Finished" value={formatDate(run.finishedAt)} />
            </dl>
          </Panel>
          <Panel title="Quality gate" data-testid="run-gate">
            {gate ? (
              <>
                <Badge
                  className="self-start"
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
                <ul className="mt-2 space-y-1 text-sm">
                  {gate.reasons.map((reason, index) => (
                    <li key={`${reason}-${index}`}>{reason}</li>
                  ))}
                </ul>
                {gate.evidenceRefs.length > 0 ? (
                  <p className="mt-2 max-w-measure truncate text-xs text-fg-muted">
                    Evidence: {gate.evidenceRefs.join(', ')}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="max-w-measure text-pretty text-sm text-fg-muted">
                UNKNOWN — no persisted gate evaluation is available.
              </p>
            )}
          </Panel>
          {readiness ? (
            <Panel
              title="Release readiness"
              data-testid="run-readiness"
              action={
                <Badge
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
              }
            >
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {Object.entries(readiness.domains).map(([domain, status]) => (
                  <div key={domain} className="flex justify-between gap-2">
                    <span className="capitalize">{domain}</span>
                    <span>{status.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </PageFrame>
  );
}

/** One summary figure, with the test id on the value itself so its text is exactly the number. */
function Figure({
  label,
  value,
  testId,
  tone,
}: {
  label: string;
  value: string;
  testId: string;
  tone?: string;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-widest text-fg-muted">{label}</div>
      <div data-testid={testId} className={`mt-1 tabular-nums text-3xl font-light ${tone ?? ''}`}>
        {value}
      </div>
    </div>
  );
}

function ContextItem({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd data-testid={testId} className="m-0 truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}
