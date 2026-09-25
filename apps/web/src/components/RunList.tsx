import React from 'react';
import { EmptyState } from '@automate/ui';
import { useRuns } from '../hooks/useRuns.js';
import type { ApiClient } from '../lib/api.js';
import { runDetailPath } from '../route-manifest.js';

export function RunList({ api }: { api?: ApiClient }) {
  const { runs, isLoading, error } = useRuns(api);

  if (isLoading) return <div data-testid="runs-loading">Loading canonical runs...</div>;
  if (error) return <div data-testid="runs-error">Error: {error.message}</div>;
  if (runs.length === 0) {
    return (
      <EmptyState
        data-testid="runs-empty"
        title="No execution evidence"
        description="No canonical runs are available in this workspace."
      />
    );
  }

  return (
    <div data-testid="run-list" className="space-y-4">
      {runs.map((run) => (
        <a
          key={run.id}
          href={runDetailPath(run.id)}
          data-testid={`run-item-${run.id}`}
          className="flex items-center justify-between rounded-lg border border-border-default bg-surface-muted p-4 no-underline transition-colors hover:bg-surface"
          aria-label={`View run ${run.id}`}
        >
          <div>
            <div className="font-medium">{run.projectId ?? 'UNKNOWN PROJECT'}</div>
            <div className="font-mono text-sm text-fg-muted">{run.id}</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-surface px-2 py-1 text-xs font-medium uppercase">
              {run.phase}
            </span>
            <span data-testid={`run-status-${run.id}`} className="text-xs uppercase">
              {run.outcome ?? 'PENDING'}
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
