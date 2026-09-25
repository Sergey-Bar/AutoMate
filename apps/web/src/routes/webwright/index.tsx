import React, { useState, useEffect } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as webwrightRoute } from '../webwright.js';
import { Card, CardHeader, CardTitle, Badge, Stack, Skeleton } from '@automate/ui';
import { PromptInput } from '../../components/webwright/PromptInput.js';

export interface WebwrightRun {
  id: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
}

export interface WebwrightApi {
  listRuns(): Promise<WebwrightRun[]>;
  createRun(prompt: string): Promise<WebwrightRun>;
}

export const Route = createRoute({
  getParentRoute: () => webwrightRoute,
  path: '/',
  component: () => <WebwrightIndexPage />,
});

export function WebwrightIndexPage({ api }: { api?: WebwrightApi }) {
  const [runs, setRuns] = useState<WebwrightRun[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolvedApi = api ?? defaultWebwrightApi;

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    resolvedApi.listRuns()
      .then((data) => { if (!cancelled) setRuns(data); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const handleSubmit = async (prompt: string) => {
    try {
      setIsSubmitting(true);
      setError(null);
      const newRun = await resolvedApi.createRun(prompt);
      setRuns((prev) => [newRun, ...prev]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div data-testid="webwright-index-page" className="p-6">
      <Stack gap={6}>
        <div>
          <h1 className="text-2xl font-bold">Webwright</h1>
          <p className="text-sm text-fg-muted mt-1">AI-powered browser agent</p>
        </div>

        <PromptInput onSubmit={handleSubmit} isLoading={isSubmitting} />

        {error && (
          <div data-testid="webwright-error" className="text-danger text-sm">
            {error}
          </div>
        )}

        {isLoading && (
          <Stack gap={3} data-testid="runs-loading">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </Stack>
        )}

        {!isLoading && !error && runs.length === 0 && (
          <p data-testid="runs-empty" className="text-fg-muted text-sm">
            No runs yet. Enter a prompt above to start the agent.
          </p>
        )}

        {!isLoading && runs.length > 0 && (
          <Stack gap={3} data-testid="runs-list">
            {runs.map((run) => (
              <a key={run.id} href={`/webwright/${run.id}`} data-testid={`run-item-${run.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                      <CardTitle className="text-base truncate">{run.prompt}</CardTitle>
                      <Badge
                        data-testid={`run-status-${run.id}`}
                        variant={run.status === 'completed' ? 'default' : run.status === 'failed' ? 'danger' : 'secondary'}
                      >
                        {run.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-fg-muted mt-1">
                      {new Date(run.createdAt).toLocaleString()}
                    </p>
                  </CardHeader>
                </Card>
              </a>
            ))}
          </Stack>
        )}
      </Stack>
    </div>
  );
}

const defaultWebwrightApi: WebwrightApi = {
  listRuns: async () => {
    const res = await fetch('/api/webwright/runs');
    if (!res.ok) throw new Error('Failed to fetch runs');
    return res.json() as Promise<WebwrightRun[]>;
  },
  createRun: async (prompt: string) => {
    const res = await fetch('/api/webwright/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    });
    if (!res.ok) throw new Error('Failed to create run');
    return res.json() as Promise<WebwrightRun>;
  },
};
