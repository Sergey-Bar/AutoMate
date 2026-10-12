import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useAnalytics, useKpis } from '../../hooks/useDashboard.js';
import { Alert, AlertDescription, AlertTitle, EmptyState, StatCard } from '@automate/ui';
import { formatKpiDenominator, formatKpiValue } from '../../lib/kpi-format.js';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/analytics',
  component: () => <AnalyticsPage />,
});

export function AnalyticsPage({ api }: { api?: ApiClient }) {
  const { data, isLoading, error } = useAnalytics(api);
  const kpis = useKpis(api);

  if (isLoading) {
    return (
      <div data-testid="analytics-loading" className="p-8">
        Loading analytics...
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        data-testid="analytics-error"
        title="Error Loading Analytics"
        description={error.message}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        data-testid="analytics-empty"
        title="No Data"
        description="No analytics data available."
      />
    );
  }

  return (
    <div data-testid="analytics-page" className="p-8">
      <h1 className="mb-4 text-balance text-3xl font-bold text-text-primary">Analytics Summary</h1>
      {/*
        `StatCard`, which is what these three were by hand — a title and a figure — and which
        the screen was not using. The cost of hand-rolling it was that these figures carried
        **no `tabular-nums`**: three numbers on the one screen whose entire content is three
        numbers, none of them in the face the design language sets for a value a person
        compares. That is the DESIGN-4 defect, and using the primitive is the whole fix.
      */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard title="Total Runs" value={data.totalRuns} data-testid="stat-total-runs" />
        <StatCard title="Pass Rate" value={`${data.passRate}%`} data-testid="stat-pass-rate" />
        <StatCard
          title="Avg Duration"
          /*
            `not measured`, not `N/A`.
            *
            A missing measurement is a state rather than a value, and `N/A` is a value-shaped
            placeholder: two capitals and a slash, indistinguishable from an abbreviation a
            reader has to decode. `PERF-1` is an open row precisely because some of this
            repository's numbers have never been recorded, and the one screen that reports a
            recorded average is the wrong place to imply one. The word is the same one the
            MAIN's unmeasured cells and the documentation site's evidence chain use, so one
            phrase means one thing across the product — which is the rule the primitive's own
            `unmeasured` prop exists to enforce.
            */
          value={data.avgDurationMs === null ? 'not measured' : `${data.avgDurationMs}ms`}
          data-testid="stat-avg-duration"
        />
      </div>

      {/*
        The KPI grid, formatted from the unit each number arrived with.
        *
        **The percent sign is no longer decided here.** It used to be: the pass rate above
        hard-codes `%` and the third card hard-codes `ms`, and every future KPI would have
        brought a fifth spelling. The endpoint sends `unit` on every KPI, `kpi-format.ts`
        maps a unit to a string in one place, and this screen has no opinion — which is what
        makes GLASS-3 unable to recur without a failing formatter test.
        */}
      {kpis.data !== null && (
        <section data-testid="kpi-grid" aria-label="KPIs" className="mt-8">
          <h2 className="mb-4 text-balance text-xl font-semibold text-text-primary">KPIs</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kpis.data.kpis.map((kpi) => (
              <StatCard
                key={kpi.id}
                title={kpi.label}
                value={formatKpiValue(kpi)}
                description={kpi.qualifier ?? formatKpiDenominator(kpi) ?? undefined}
                data-testid={`kpi-${kpi.id}`}
              />
            ))}
          </div>
        </section>
      )}

      {/*
        A dead KPI endpoint is a **partial** failure and says so. The summary above is still
        true — those three numbers came from their own endpoint — so blanking the screen
        would report a loss of information nobody suffered. The `variant="destructive"` alert
        is the primitive's own spelling of "this is broken", not a colour picked here.
        */}
      {kpis.error !== null && (
        <Alert variant="danger" data-testid="kpi-error" className="mt-8">
          <AlertTitle>KPIs unavailable</AlertTitle>
          <AlertDescription>
            The summary above still stands. The KPI endpoint did not answer, so the numbers that
            carry their units are not shown.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
