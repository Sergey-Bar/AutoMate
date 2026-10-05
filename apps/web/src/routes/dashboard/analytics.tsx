import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useAnalytics } from '../../hooks/useDashboard.js';
import { EmptyState, StatCard } from '@automate/ui';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/analytics',
  component: () => <AnalyticsPage />,
});

export function AnalyticsPage({ api }: { api?: ApiClient }) {
  const { data, isLoading, error } = useAnalytics(api);

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
            Cockpit's unmeasured cells and the documentation site's evidence chain use, so one
            phrase means one thing across the product — which is the rule the primitive's own
            `unmeasured` prop exists to enforce.
            */
          value={data.avgDurationMs === null ? 'not measured' : `${data.avgDurationMs}ms`}
          data-testid="stat-avg-duration"
        />
      </div>
    </div>
  );
}
