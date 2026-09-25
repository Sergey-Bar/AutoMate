import React from 'react';
import { useRuns } from '../hooks/useRuns.js';
import { EmptyState } from '@automate/ui';
import type { ApiClient } from '../lib/api.js';

export function RunList({ api }: { api?: ApiClient }) {
  const { runs, isLoading, error } = useRuns(api);

  if (isLoading) {
    return <div data-testid="runs-loading">Loading runs...</div>;
  }

  if (error) {
    return <div data-testid="runs-error">Error: {error.message}</div>;
  }

  if (runs.length === 0) {
    return (
      <EmptyState
        data-testid="runs-empty"
        title="No runs found"
        description="There are no runs available in this workspace yet."
      />
    );
  }

  return (
    <div data-testid="run-list" className="space-y-4">
      {runs.map((run) => (
        <a
          key={run.id}
          href={`/dashboard/runs/${run.id}`}
          data-testid={`run-item-${run.id}`}
          className="block p-4 rounded-lg border border-border-default bg-bg-elevated flex items-center justify-between hover:bg-bg-secondary transition-colors no-underline"
          aria-label={`View run ${run.id}`}
        >
          <div>
            <div className="font-medium text-text-primary">{run.projectName}</div>
            <div className="text-sm text-text-secondary">{run.id}</div>
          </div>
          <div className="flex items-center space-x-4">
            <span
              data-testid={`run-status-${run.id}`}
              className="px-2 py-1 text-xs font-medium rounded-full bg-bg-secondary text-text-primary"
            >
              {run.status}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
