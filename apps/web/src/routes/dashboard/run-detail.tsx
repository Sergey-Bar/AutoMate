import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, Button, EmptyState, StatusDot } from '@automate/ui';
import type { RunPhase } from '@automate/shared-contracts';
import { Route as dashboardRoute } from '../dashboard.js';
import { useRunDetail } from '../../hooks/useDashboard.js';
import { isRunActive } from '../../hooks/useRuns.js';
import { ApiError, getArtifactUrl, type ApiClient, type Run } from '../../lib/api.js';
import { formatDate as formatDateWithFallback } from '../../lib/format.js';
import { formatDuration } from '../../lib/insights.js';
import { describeGateReason } from '../../lib/gate-reason.js';
import { PageFrame, PageHeader, Panel } from '../../components/kit.js';
import { Responsive } from '../../components/responsive.js';

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
            <span className="inline-flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{test.title}</span>
              <span className="text-xs uppercase text-fg-muted">{test.status}</span>
            </span>
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

/** Gate reasons as `[sentence, raw]`, one per distinct sentence, in the server's order. */
function uniqueReasons(reasons: readonly string[]): Array<[string, string]> {
  const seen = new Map<string, string>();
  for (const raw of reasons) {
    const sentence = describeGateReason(raw);
    if (!seen.has(sentence)) seen.set(sentence, raw);
  }
  return [...seen.entries()];
}

/** Gate reasons as a dot-separated line of sentences, each with its raw code on hover. */
function GateSentences({ reasons }: { reasons: readonly string[] }): React.ReactElement {
  return (
    <>
      {uniqueReasons(reasons).map(([sentence, raw], index) => (
        <React.Fragment key={raw}>
          {index > 0 ? ' · ' : null}
          <span title={raw}>{sentence}</span>
        </React.Fragment>
      ))}
    </>
  );
}

/** How many failing tests the header names before pointing at the full list. */
const FAILURES_SHOWN = 5;

/** Reasons that name a cause on their own, most decisive first. */
const LEAD_REASONS = [
  'runner_lost:',
  'infra_failed:',
  'config_failed:',
  'cancelled:',
  'timed_out:',
  'evidence:NO_TESTS',
  'threshold:',
  'product_failure:TEST_FAILURE',
];

/** The sentence a failure is headed with when no test failed: the gate's own cause. */
function leadSentence(run: Run, reasons: readonly string[]): string {
  for (const prefix of LEAD_REASONS) {
    const found = reasons.find((reason) => reason.startsWith(prefix));
    if (found !== undefined) return describeGateReason(found);
  }
  if (run.error) return run.error.message;
  const [first] = reasons;
  return first === undefined ? 'The run failed' : describeGateReason(first);
}

/** A run nothing failed in: "all passed" only when every test did and the gate agrees. */
function RunPassed({
  run,
  gate,
}: {
  run: Run;
  gate: { status: string; reasons: readonly string[] } | null;
}): React.ReactElement | null {
  if (run.outcome !== 'passed') return null;
  const { passed, total } = run.summary;
  const cleared = gate === null || gate.status === 'passed';
  if (cleared && total > 0 && passed === total) {
    return (
      <p
        data-testid="run-verdict"
        className="inline-flex shrink-0 items-center gap-2 text-lg font-semibold text-success"
      >
        <StatusDot status="good" />
        {`All ${String(total)} tests passed`}
      </p>
    );
  }
  return (
    <div data-testid="run-verdict" className="shrink-0">
      <p className="inline-flex items-center gap-2 text-lg font-semibold text-fg">
        <StatusDot status={cleared ? 'warn' : 'unknown'} />
        {`${String(passed)} of ${String(total)} tests passed`}
      </p>
      {!cleared && gate !== null ? (
        <p className="mt-1 max-w-measure text-sm text-fg-muted">
          {`Quality gate ${gate.status}: `}
          <GateSentences reasons={gate.reasons} />
        </p>
      ) : null}
    </div>
  );
}

/**
 * The answer first: what failed, or that nothing did — and only "all passed" when that is
 * true of every test *and* the gate agrees.
 *
 * A failed run used to open on a phase timeline and four figures, and the reason it
 * failed was a panel and a click away. Now the cause heads the page: the failing tests and
 * their first error when tests failed, otherwise the gate's decisive reason (no tests ran,
 * a timeout, a missed threshold). A run whose tests passed but whose gate has no verdict, or
 * that skipped tests, says how many passed and why it is not green.
 */
function RunVerdict({
  run,
  gate,
}: {
  run: Run;
  gate: { status: string; reasons: readonly string[] } | null;
}): React.ReactElement | null {
  if (isRunActive(run)) return null;
  const failing = run.tests.filter((test) => test.status === 'failed');
  const gateFailed = gate?.status === 'failed';
  const reasons = gate?.reasons ?? [];
  const failed =
    run.outcome === 'failed' || run.summary.failed > 0 || gateFailed || run.error != null;
  const { total } = run.summary;
  if (!failed) return <RunPassed run={run} gate={gate} />;
  return (
    <section
      aria-label="What failed"
      data-testid="run-what-failed"
      className="shrink-0 rounded-xl border border-border bg-surface px-5 py-4"
    >
      <h2 className="inline-flex items-center gap-2 text-lg font-semibold text-danger">
        <StatusDot status="bad" />
        {run.summary.failed > 0
          ? `${String(run.summary.failed)} of ${String(total)} tests failed`
          : leadSentence(run, reasons)}
      </h2>
      {failing.length > 0 ? (
        <ul className="mt-3 divide-y divide-border">
          {failing.slice(0, FAILURES_SHOWN).map((test) => (
            <li key={test.id} className="min-w-0 py-2">
              <p className="text-sm font-medium text-fg">{test.title}</p>
              {test.error ? <p className="text-sm text-danger">{test.error.message}</p> : null}
              {test.file ? (
                <p className="truncate font-mono text-xs text-fg-muted" title={test.file}>
                  {test.file}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {failing.length > FAILURES_SHOWN ? (
        <p className="mt-1 text-xs text-fg-muted">
          {`and ${String(failing.length - FAILURES_SHOWN)} more under Test attempts`}
        </p>
      ) : null}
      {gateFailed && reasons.length > 0 ? (
        <p className="mt-2 max-w-measure text-sm text-fg">
          <span className="text-fg-muted">Quality gate: </span>
          <GateSentences reasons={reasons} />
        </p>
      ) : null}
      {run.error ? (
        <p className="mt-2 text-sm text-fg">
          <span className="font-mono text-danger">{run.error.code}</span> {run.error.message}
        </p>
      ) : null}
    </section>
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
      <PageFrame>
        <PageHeader title="Run detail" />
        <div data-testid="run-detail-loading" className="text-sm text-fg-muted">
          Loading canonical run {id}...
        </div>
      </PageFrame>
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
        <PageFrame>
          <PageHeader title="Run detail" />
          <EmptyState
            headingLevel={2}
            data-testid="run-not-found"
            title="Run not found"
            description={`No canonical run exists for ${id}.`}
          />
        </PageFrame>
      );
    }
    return (
      <PageFrame>
        <PageHeader title="Run detail" />
        <EmptyState
          headingLevel={2}
          data-testid="run-error"
          title="Run unavailable"
          description={error.message}
        />
      </PageFrame>
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

  const summary = (
    <>
      <div className="shrink-0 rounded-xl border border-border bg-surface-raised px-4 py-3">
        <PhaseTimeline phase={run.phase} />
      </div>

      <section aria-label="Execution summary" className="grid shrink-0 grid-cols-4 gap-2 sm:gap-3">
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
          value={run.summary.durationMs == null ? '—' : formatDuration(run.summary.durationMs)}
          hint={run.summary.durationMs == null ? 'Not reported' : undefined}
        />
      </section>
      <section
        aria-label="Run context"
        className="shrink-0 rounded-xl border border-border bg-surface-raised px-4 py-3"
      >
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3 xl:grid-cols-9">
          {/*
            Project, environment and release are omitted when the run never had them — a
            reporter-sent run has none of the three — rather than drawn as UNKNOWN. Branch,
            runner and the times stay, because their absence is itself the information.
          */}
          {run.projectId ? (
            <ContextItem label="Project" testId="run-project" value={run.projectId} />
          ) : null}
          {run.environmentId ? <ContextItem label="Environment" value={run.environmentId} /> : null}
          {run.releaseId ? <ContextItem label="Release" value={run.releaseId} /> : null}
          <ContextItem
            label="Branch / Commit"
            value={`${run.branch ?? '—'} / ${run.commit ?? '—'}`}
          />
          {run.framework && run.framework !== 'unknown' ? (
            <ContextItem label="Framework" value={run.framework} />
          ) : null}
          <ContextItem label="Runner" value={run.runner?.name ?? run.runner?.id ?? 'UNASSIGNED'} />
          <ContextItem label="Created" value={formatDate(run.createdAt)} />
          <ContextItem label="Started" value={formatDate(run.startedAt)} />
          <ContextItem label="Finished" value={formatDate(run.finishedAt)} />
        </dl>
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
    </>
  );
  const tests = (
    <>
      <Panel title="Test attempts" className="flex-1">
        <div
          tabIndex={0}
          role="region"
          aria-label="Test attempt list"
          className="min-h-0 flex-1 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
        >
          <TestEvidence tests={run.tests} />
        </div>
      </Panel>
    </>
  );
  const artifactPanel = (
    <>
      <Panel title="Artifacts" className="min-h-0 flex-1">
        {evidenceError ? (
          <p className="max-w-measure text-pretty text-sm text-warning">
            Some artifact metadata could not be refreshed.
          </p>
        ) : null}
        {artifacts.length > 0 ? (
          <div
            tabIndex={0}
            role="region"
            aria-label="Artifact list"
            className="min-h-0 flex-1 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <ul className="divide-y divide-border-default">
              {artifacts.map((artifact) => (
                <li key={artifact.id} className="py-2">
                  <a
                    href={getArtifactUrl(artifact.id)}
                    className="rounded-sm font-medium text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
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
          </div>
        ) : (
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            No persisted artifacts have been reported.
          </p>
        )}
      </Panel>
    </>
  );
  const eventPanel = (
    <>
      <Panel title="Live event timeline" className="min-h-0 flex-1">
        {events.length > 0 ? (
          <div
            tabIndex={0}
            role="region"
            aria-label="Event list"
            className="min-h-0 flex-1 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            <ol className="space-y-1.5">
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
          </div>
        ) : (
          <p className="max-w-measure text-pretty text-sm text-fg-muted">
            No events have been observed in this browser session. Run state above is the
            authoritative API snapshot.
          </p>
        )}
      </Panel>
    </>
  );
  const gatePanel = (
    <>
      <Panel title="Quality gate" data-testid="run-gate" className="min-h-0 flex-1">
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
            <div
              tabIndex={0}
              role="region"
              aria-label="Gate reasons"
              className="mt-2 min-h-0 overflow-y-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              <ul className="space-y-1 break-words text-sm">
                {gate.reasons.map((reason, index) => (
                  <li key={`${reason}-${index}`} title={reason}>
                    {describeGateReason(reason)}
                  </li>
                ))}
              </ul>
            </div>
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
    </>
  );

  return (
    <PageFrame data-testid="run-detail-page">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <a
            href="/dashboard/runs"
            className="inline-flex min-h-11 items-center rounded-sm text-sm text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            ← Runs
          </a>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Run detail</h1>
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
              className="rounded-sm text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
            >
              Open retried run {retryTarget}
            </a>
          ) : null}
        </div>
      ) : null}

      <RunVerdict run={run} gate={gate} />

      <Responsive
        label="Run sections"
        desktop={
          <>
            {summary}
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
              {tests}
              <div className="flex min-h-0 flex-col gap-3">
                {artifactPanel}
                {eventPanel}
              </div>
              <div className="flex min-h-0 flex-col gap-3">{gatePanel}</div>
            </div>
          </>
        }
        panels={[
          {
            id: 'summary',
            label: 'Summary',
            node: <div className="flex min-h-0 flex-1 flex-col gap-3">{summary}</div>,
          },
          { id: 'tests', label: 'Tests', node: tests },
          { id: 'artifacts', label: 'Artifacts', node: artifactPanel },
          { id: 'events', label: 'Events', node: eventPanel },
          {
            id: 'gate',
            label: 'Gate',
            node: <div className="flex min-h-0 flex-1 flex-col gap-3">{gatePanel}</div>,
          },
        ]}
      />
    </PageFrame>
  );
}

/** One summary figure, with the test id on the value itself so its text is exactly the number. */
function Figure({
  label,
  value,
  testId,
  tone,
  hint,
}: {
  label: string;
  value: string;
  testId: string;
  tone?: string;
  /** What a dash means, for a reader who hovers it. */
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-surface-raised px-3 py-2 sm:px-4 sm:py-3">
      <div
        className="truncate text-[0.6875rem] font-medium uppercase tracking-widest text-fg-muted sm:text-xs"
        title={label}
      >
        {label}
      </div>
      {/* A word ("UNKNOWN") steps down a size on a phone, so four figures share one row. */}
      <div
        data-testid={testId}
        title={hint ?? value}
        className={`mt-1 truncate tabular-nums font-semibold sm:text-3xl ${value.length > 5 ? 'text-base' : 'text-xl'} ${tone ?? ''}`}
      >
        {value}
      </div>
    </div>
  );
}

function ContextItem({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-fg-muted">{label}</dt>
      <dd data-testid={testId} className="m-0 truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}
