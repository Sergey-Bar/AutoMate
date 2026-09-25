import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useRun } from '../../hooks/useDashboardPages.js';
import {
  Badge,
  Card,
  EmptyState,
  Skeleton,
  StatCard,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@automate/ui';
import type { ApiClient } from '../../lib/api.js';
import { RunTimeline } from '../../components/dashboard/RunTimeline.js';
import { NetworkWaterfall } from '../../components/dashboard/NetworkWaterfall.js';
import type { TimelineStep } from '../../components/dashboard/RunTimeline.js';
import type { NetworkRequest } from '../../components/dashboard/NetworkWaterfall.js';
import { VideoPlayer } from '../../components/dashboard/VideoPlayer.js';
import { ScreenshotDiff } from '../../components/dashboard/ScreenshotDiff.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/$runId',
  component: () => {
    const { runId } = Route.useParams();
    return <RunDetailPage runId={runId} />;
  },
});

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'default' | 'secondary' {
  switch (status) {
    case 'passed': return 'success';
    case 'failed': return 'danger';
    case 'flaky': return 'warning';
    case 'running': return 'default';
    default: return 'secondary';
  }
}

const DEMO_STEPS: TimelineStep[] = [
  { name: 'Setup', startMs: 0, durationMs: 120, status: 'passed' },
  { name: 'Login', startMs: 120, durationMs: 340, status: 'passed' },
  { name: 'Navigate', startMs: 460, durationMs: 200, status: 'passed' },
  { name: 'Assert title', startMs: 660, durationMs: 80, status: 'passed' },
  { name: 'Teardown', startMs: 740, durationMs: 60, status: 'passed' },
];

const DEMO_REQUESTS: NetworkRequest[] = [
  { url: '/api/auth/login', method: 'POST', startMs: 130, durationMs: 210, status: 200 },
  { url: '/api/users/me', method: 'GET', startMs: 350, durationMs: 90, status: 200 },
  { url: '/api/dashboard', method: 'GET', startMs: 465, durationMs: 150, status: 200 },
];

export function RunDetailPage({ runId, api }: { runId: string; api?: ApiClient }) {
  const { data, isLoading, error } = useRun(runId, api);
  const [tab, setTab] = useState('results');

  if (isLoading) {
    return (
      <div data-testid="run-detail-loading" className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error) {
    if (error.message.includes('not found') || error.message.includes('404')) {
      return (
        <EmptyState
          data-testid="run-not-found"
          title="Run Not Found"
          description={`Could not find run with ID ${runId}.`}
        />
      );
    }
    return (
      <EmptyState
        data-testid="run-detail-error"
        title="Error Loading Run"
        description={error.message}
      />
    );
  }

  if (!data) return null;

  return (
    <div data-testid="run-detail-page" className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-bold text-text-primary">Run Details</h2>
        <Badge variant={statusVariant(data.status)} data-testid="run-status">
          {data.status}
        </Badge>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard data-testid="stat-total" title="Total Tests" value={data.total ?? '—'} />
        <StatCard data-testid="stat-passed" title="Passed" value={data.passed ?? '—'} trend="up" />
        <StatCard data-testid="stat-failed" title="Failed" value={data.failed ?? '—'} trend={data.failed ? 'down' : 'neutral'} />
        <StatCard
          data-testid="stat-duration"
          title="Duration"
          value={data.durationMs != null ? `${data.durationMs}ms` : '—'}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          <Card className="p-6" data-testid="tab-results">
            <div className="text-text-secondary text-sm">
              Test results for run <span className="font-mono" data-testid="run-id">{data.id}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <div className="text-sm text-text-secondary">Project</div>
                <div data-testid="run-project">{data.projectName ?? 'Unknown'}</div>
              </div>
              <div>
                <div className="text-sm text-text-secondary">Started At</div>
                <div data-testid="run-started-at">{new Date(data.startedAt).toLocaleString()}</div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card className="p-6" data-testid="tab-timeline">
            <div className="text-text-secondary text-sm mb-4">
              Timeline view — run started at{' '}
              <span data-testid="timeline-started">{new Date(data.startedAt).toLocaleString()}</span>
              {data.durationMs != null && (
                <span> and completed in <span data-testid="timeline-duration">{data.durationMs}ms</span></span>
              )}
            </div>
            <RunTimeline steps={DEMO_STEPS} />
          </Card>
        </TabsContent>

        <TabsContent value="network">
          <Card className="p-6" data-testid="tab-network">
            <div className="text-text-secondary text-sm mb-4">
              Network requests captured during this run.
            </div>
            <NetworkWaterfall requests={DEMO_REQUESTS} />
          </Card>
        </TabsContent>

        <TabsContent value="metadata">
          <Card className="p-6" data-testid="tab-metadata">
            <dl className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <dt className="text-text-secondary">Run ID</dt>
                <dd className="font-mono" data-testid="metadata-run-id">{data.id}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Status</dt>
                <dd data-testid="metadata-status">{data.status}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Project</dt>
                <dd data-testid="metadata-project">{data.projectName ?? 'Unknown'}</dd>
              </div>
              <div>
                <dt className="text-text-secondary">Started At</dt>
                <dd data-testid="metadata-started-at">{data.startedAt}</dd>
              </div>
            </dl>
          </Card>
        </TabsContent>

        <TabsContent value="video">
          <div data-testid="tab-video">
            <VideoPlayer />
          </div>
        </TabsContent>

        <TabsContent value="screenshots">
          <div data-testid="tab-screenshots">
            <ScreenshotDiff
              expected="https://via.placeholder.com/800x600?text=Expected"
              actual="https://via.placeholder.com/800x600?text=Actual"
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
