import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useRunDetail } from '../../hooks/useDashboard.js';
import { EmptyState } from '@automate/ui';
import type { ApiClient } from '../../lib/api.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/runs/$id',
  component: () => {
    const { id } = Route.useParams();
    return <RunDetailPage id={id} />;
  },
});

export function RunDetailPage({ id, api }: { id: string; api?: ApiClient }) {
  const { data, isLoading, error } = useRunDetail(id, api);

  if (isLoading) {
    return <div data-testid="run-detail-loading" className="p-8">Loading run {id}...</div>;
  }

  if (error) {
    if (error.message.includes('not found') || error.message.includes('404')) {
      return (
        <EmptyState
          data-testid="run-not-found"
          title="Run Not Found"
          description={`Could not find run with ID ${id}.`}
        />
      );
    }
    return (
      <EmptyState
        data-testid="run-error"
        title="Error Loading Run"
        description={error.message}
      />
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div data-testid="run-detail-page" className="p-8 space-y-6">
      <h2 className="text-2xl font-bold text-text-primary">Run Details</h2>
      <div className="bg-bg-elevated border border-border-default rounded-lg p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div>
            <div className="text-sm text-text-secondary">Run ID</div>
            <div data-testid="run-id" className="font-mono">{data.id}</div>
          </div>
          <div>
            <span data-testid="run-status" className="px-3 py-1 rounded-full bg-bg-secondary text-sm font-medium">
              {data.status}
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border-default">
          <div>
            <div className="text-sm text-text-secondary">Project</div>
            <div data-testid="run-project">{data.projectName || 'Unknown'}</div>
          </div>
          <div>
            <div className="text-sm text-text-secondary">Started At</div>
            <div data-testid="run-started-at">{new Date(data.startedAt).toLocaleString()}</div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 pt-4 border-t border-border-default">
          <div>
            <div className="text-sm text-text-secondary">Total Tests</div>
            <div data-testid="run-total">{data.total ?? 0}</div>
          </div>
          <div>
            <div className="text-sm text-text-secondary">Passed</div>
            <div data-testid="run-passed" className="text-green-600">{data.passed ?? 0}</div>
          </div>
          <div>
            <div className="text-sm text-text-secondary">Failed</div>
            <div data-testid="run-failed" className="text-red-600">{data.failed ?? 0}</div>
          </div>
          <div>
            <div className="text-sm text-text-secondary">Duration</div>
            <div data-testid="run-duration">{data.durationMs != null ? `${data.durationMs}ms` : 'N/A'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
