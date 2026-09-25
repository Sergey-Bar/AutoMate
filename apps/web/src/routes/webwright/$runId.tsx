import React, { useState, useEffect } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as webwrightRoute } from '../webwright.js';
import { Card, CardHeader, CardTitle, Badge, Stack, Skeleton } from '@automate/ui';
import { RunFeed } from '../../components/webwright/RunFeed.js';
import type { AgentStep } from '../../components/webwright/RunFeed.js';

export interface WebwrightRunDetail {
  id: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  steps: AgentStep[];
}

export interface WebwrightRunApi {
  getRun(id: string): Promise<WebwrightRunDetail>;
}

export const Route = createRoute({
  getParentRoute: () => webwrightRoute,
  path: '/$runId',
  component: WebwrightRunDetailPage,
});

function WebwrightRunDetailPage() {
  const { runId } = Route.useParams();
  return <WebwrightRunDetail runId={runId} />;
}

export function WebwrightRunDetail({ runId, api }: { runId: string; api?: WebwrightRunApi }) {
  const [run, setRun] = useState<WebwrightRunDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const resolvedApi = api ?? defaultRunApi;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    resolvedApi.getRun(runId)
      .then((data) => { if (!cancelled) setRun(data); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [runId]);

  if (isLoading) {
    return (
      <div data-testid="run-detail-loading" className="p-6">
        <Stack gap={4}>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </Stack>
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid="run-detail-error" className="p-6 text-danger text-sm">
        {error}
      </div>
    );
  }

  if (!run) return null;

  return (
    <div data-testid="run-detail-page" className="p-6">
      <Stack gap={6}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">Run Detail</h1>
            <p data-testid="run-prompt" className="text-sm text-fg-muted mt-1 truncate">{run.prompt}</p>
          </div>
          <Badge
            data-testid="run-status-badge"
            variant={run.status === 'completed' ? 'default' : run.status === 'failed' ? 'danger' : 'secondary'}
          >
            {run.status}
          </Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Agent Actions</CardTitle>
          </CardHeader>
          <div className="px-6 pb-6">
            <RunFeed steps={run.steps} isLoading={false} />
          </div>
        </Card>
      </Stack>
    </div>
  );
}

const defaultRunApi: WebwrightRunApi = {
  getRun: async (id: string) => {
    const res = await fetch(`/api/webwright/runs/${id}`);
    if (!res.ok) {
      if (res.status === 404) throw new Error('Run not found');
      throw new Error('Failed to fetch run');
    }
    return res.json() as Promise<WebwrightRunDetail>;
  },
};
