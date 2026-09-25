import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useAnalytics } from '../../hooks/useDashboard.js';
import { EmptyState } from '@automate/ui';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/analytics',
  component: () => <AnalyticsPage />,
});

export function AnalyticsPage({ api }: { api?: ApiClient }) {
  const { data, isLoading, error } = useAnalytics(api);

  if (isLoading) {
    return <div data-testid="analytics-loading" className="p-8">Loading analytics...</div>;
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
      <h2 className="text-xl font-bold mb-4 text-text-primary">Analytics Summary</h2>
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 bg-bg-elevated border border-border-default rounded-lg">
          <div className="text-sm text-text-secondary">Total Runs</div>
          <div data-testid="stat-total-runs" className="text-2xl font-bold">{data.totalRuns}</div>
        </div>
        <div className="p-4 bg-bg-elevated border border-border-default rounded-lg">
          <div className="text-sm text-text-secondary">Pass Rate</div>
          <div data-testid="stat-pass-rate" className="text-2xl font-bold">{data.passRate}%</div>
        </div>
        <div className="p-4 bg-bg-elevated border border-border-default rounded-lg">
          <div className="text-sm text-text-secondary">Avg Duration</div>
          <div data-testid="stat-avg-duration" className="text-2xl font-bold">
            {data.avgDurationMs !== null ? `${data.avgDurationMs}ms` : 'N/A'}
          </div>
        </div>
      </div>
    </div>
  );
}
