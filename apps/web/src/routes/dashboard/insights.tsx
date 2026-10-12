import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, EmptyState, GLASS_SURFACE_CLASSES, Skeleton } from '@automate/ui';
import { Route as dashboardRoute } from '../dashboard.js';
import { useResource } from '../../hooks/useResource.js';
import { readFindings, type Finding } from '../../lib/findings.js';
import { formatKpiValue } from '../../lib/kpi-format.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import { useKpis } from '../../hooks/useDashboard.js';
import { defaultApiClient, type ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/insights',
  component: () => <InsightsPage />,
});

/**
 * The full insight list — one screen, the shared engine, no duplication.
 *
 * ## What this is
 *
 * The verdict card on the cockpit shows the top of the derived list; this screen
 * shows all of it, with the source and the citation a reader needs to act. The
 * derivation is `lib/findings.ts`, the same one the cockpit renders — there is no
 * second copy of a rule in this product, and there were two screens' worth before.
 *
 * ## Why it reads seven endpoints here
 *
 * **A screen that reads one of them and titles itself "insights" is a half-truth.**
 * The rules are about the *combination*: a zero row that caps the mean, a flaky
 * cell that also has a quarantine entry pending. So the page hands the seven to
 * `readFindings` — the same reader the cockpit and the today screen use, which is
 * why no two screens can disagree about what the suite is, and why a dead endpoint
 * is a failure on every one of them rather than an empty answer on whichever one
 * happened to forget to catch it.
 */
export function InsightsPage({
  api = defaultApiClient,
  qa,
  projectId,
}: {
  api?: ApiClient;
  qa?: QaClient;
  projectId?: string;
}) {
  const kpis = useKpis(api);
  const findings = useResource<readonly Finding[]>(
    async (signal) => (await readFindings(api, qa ?? createQaClient(), projectId, signal)).findings,
    [api, qa, projectId],
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8" data-testid="insights-page">
      {/*
        One h1, and only one. Both states render inside this shell — the empty
        state is not a second title — which is the rule `Composition.test.tsx`
        fails on and the reason the tools screen was rewritten the same way.
      */}
      <h1 className="mb-1 text-balance text-3xl font-bold tracking-tight text-text-primary">
        Insights
      </h1>
      <p className="mb-8 max-w-measure text-pretty text-sm text-fg-muted">
        Every rule the engine derives, ranked by what a decision costs. Each one names the endpoint
        it read and the values that decided it, because a finding you cannot trace is a finding you
        have to trust.
      </p>

      {projectId === undefined ? (
        <EmptyState
          data-testid="insights-no-project"
          title="No project selected"
          description="Pick a project on the cockpit first — the insights are about one stack at a time."
          action={
            <a
              href="/dashboard"
              className="rounded-md border border-border px-3 py-2 text-sm text-fg transition-colors hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-border-focus focus-visible:outline-offset-2"
            >
              Choose a project on the cockpit
            </a>
          }
        />
      ) : (
        <>
          {findings.status === 'loading' && (
            <Skeleton className="h-24 w-full" data-testid="insights-loading" />
          )}
          {findings.status === 'error' && (
            <EmptyState
              data-testid="insights-error"
              title="Insights unavailable"
              description={findings.message}
            />
          )}
          {findings.status === 'ready' && findings.value.length === 0 && (
            <EmptyState
              data-testid="insights-empty"
              title="Nothing to report"
              description="No rule fired: no zero row, no flaky cell, no hollow test, no pending verdict."
            />
          )}
          {findings.status === 'ready' && findings.value.length > 0 && (
            <ol className="flex flex-col gap-4" data-testid="insights-list">
              {findings.value.map((finding) => (
                <li key={finding.id}>
                  <FindingCard finding={finding} />
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      {/*
        The KPIs beside them, because the two answer different questions: a finding
        is a judgement, a KPI is a measurement, and a reader with only one of them
        cannot check the other. `formatKpiValue` decides the unit — the client no
        longer has to remember which fields are percentages (GLASS-3).
      */}
      {kpis.data !== null && kpis.data.kpis.length > 0 && (
        <section className="mt-10" data-testid="insights-kpis" aria-label="KPIs">
          <h2 className="mb-4 text-xl font-semibold tracking-tight text-text-primary">
            The measurements
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kpis.data.kpis.map((kpi) => (
              <div
                key={kpi.id}
                data-testid={`insights-kpi-${kpi.id}`}
                className={`p-4 ${GLASS_SURFACE_CLASSES}`}
              >
                <p className="max-w-measure text-xs uppercase tracking-wide text-fg-muted">
                  {kpi.label}
                </p>
                <p className="mt-1 text-2xl font-semibold tabular-nums text-text-primary">
                  {formatKpiValue(kpi)}
                </p>
                {kpi.qualifier !== null && (
                  <p className="mt-1 max-w-measure text-pretty text-xs text-fg-muted">
                    {kpi.qualifier}
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * One finding, as a card.
 *
 * **The badge is the severity and the two lines are the claim and the evidence.**
 * No icons, no colour beyond the badge: the list is read top to bottom, and a
 * reader who understands the first three understands all of them, which is the
 * whole point of one component for one shape.
 */
function FindingCard({ finding }: { finding: Finding }): React.ReactElement {
  const variant =
    finding.severity === 'critical'
      ? 'danger'
      : finding.severity === 'warning'
        ? 'warning'
        : 'secondary';
  return (
    <article className={`p-5 ${GLASS_SURFACE_CLASSES}`} data-testid={`insight-${finding.id}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={variant}>{finding.severity}</Badge>
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">{finding.title}</h2>
      </div>
      <p className="mt-3 max-w-measure text-pretty text-sm text-fg">{finding.statement}</p>
      <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-fg-muted">Source</dt>
          <dd className="font-mono text-fg">{finding.source}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">Citation</dt>
          <dd className="font-mono text-fg">{finding.citation}</dd>
        </div>
      </dl>
      <p className="mt-4 max-w-measure border-t border-border pt-3 text-pretty text-sm text-fg-muted">
        {finding.action}
      </p>
    </article>
  );
}
