import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useTrace } from '../../hooks/useTrace.js';
import type { FetchFn } from '../../hooks/useTrace.js';
import {
  Badge,
  Card,
  EmptyState,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@automate/ui';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/traces/$traceId',
  component: () => {
    const { traceId } = Route.useParams();
    return <TraceViewerPage traceId={traceId} />;
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

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function TraceViewerPage({ traceId, fetchFn }: { traceId: string; fetchFn?: FetchFn }) {
  const { data, isLoading, error } = useTrace(traceId, fetchFn);
  const [tab, setTab] = useState('actions');

  if (isLoading) {
    return (
      <div data-testid="trace-loading" className="space-y-4">
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
          data-testid="trace-not-found"
          title="Trace Not Found"
          description={`Could not find trace with ID ${traceId}.`}
        />
      );
    }
    return (
      <EmptyState
        data-testid="trace-error"
        title="Error Loading Trace"
        description={error.message}
      />
    );
  }

  if (!data) return null;

  const viewerUrl = data.traceUrl
    ? `https://trace.playwright.dev/?trace=${encodeURIComponent(data.traceUrl)}`
    : null;

  return (
    <div data-testid="trace-viewer-page" className="space-y-6">
      <div className="flex items-center gap-4">
        <h2 className="text-2xl font-bold text-text-primary">Trace Viewer</h2>
        <Badge variant={statusVariant(data.status)} data-testid="trace-status">
          {data.status}
        </Badge>
      </div>

      <Card data-testid="trace-metadata" className="p-4 space-y-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">Test Name</span>
          <span data-testid="trace-test-name" className="font-medium">{data.testName}</span>
        </div>
        <div className="flex gap-6">
          <div className="flex flex-col gap-1">
            <span className="text-sm text-text-secondary">Duration</span>
            <span data-testid="trace-duration">{formatDuration(data.durationMs)}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-text-secondary">Started At</span>
            <span data-testid="trace-started-at">{new Date(data.startedAt).toLocaleString()}</span>
          </div>
        </div>
      </Card>

      {viewerUrl && (
        <Card className="p-0 overflow-hidden">
          <iframe
            data-testid="trace-iframe"
            src={viewerUrl}
            title="Playwright Trace Viewer"
            className="w-full h-[600px] border-0"
          />
        </Card>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="actions">Actions</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="console">Console</TabsTrigger>
        </TabsList>

        <TabsContent value="actions">
          <div data-testid="tab-actions" className="space-y-2 mt-4">
            {data.actions && data.actions.length > 0 ? (
              data.actions.map((action, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded bg-surface-secondary">
                  <span className="text-sm font-medium">{action.title}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{action.type}</Badge>
                    <span className="text-xs text-text-secondary">{formatDuration(action.durationMs)}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-secondary">No actions recorded.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="network">
          <div data-testid="tab-network" className="space-y-2 mt-4">
            {data.networkRequests && data.networkRequests.length > 0 ? (
              data.networkRequests.map((req, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded bg-surface-secondary">
                  <span className="text-sm font-mono truncate max-w-md">{req.url}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{req.method}</Badge>
                    {req.status != null && (
                      <Badge variant={req.status >= 400 ? 'danger' : 'success'}>{req.status}</Badge>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-secondary">No network requests recorded.</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="console">
          <div data-testid="tab-console" className="space-y-2 mt-4">
            {data.consoleLogs && data.consoleLogs.length > 0 ? (
              data.consoleLogs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded bg-surface-secondary">
                  <Badge variant={log.level === 'error' ? 'danger' : log.level === 'warn' ? 'warning' : 'secondary'}>
                    {log.level}
                  </Badge>
                  <span className="text-sm font-mono">{log.message}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-text-secondary">No console logs recorded.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
