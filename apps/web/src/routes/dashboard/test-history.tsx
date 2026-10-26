import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Badge, Button, EmptyState, Sparkline, type BadgeProps } from '@automate/ui';
import type { TestHistory, TestHistoryEntry } from '@automate/shared-contracts';
import { Route as dashboardRoute } from '../dashboard.js';
import { PageFrame, PageHeader, Panel, Quiet } from '../../components/kit.js';
import { defaultApiClient, type ApiClient } from '../../lib/api.js';
import { formatDate } from '../../lib/format.js';

/**
 * One test across runs: a strip of its outcomes, its duration, and the distinct causes of its
 * failures. Linked from the flaky leaderboard, the quarantine and a run's tests by identity
 * (`?key=`), which is why the identity is a search parameter: it is a file path.
 */
export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/test',
  validateSearch: (search: Record<string, unknown>): { key: string } => ({
    key: typeof search['key'] === 'string' ? search['key'].slice(0, 2_000) : '',
  }),
  component: () => {
    const { key } = Route.useSearch();
    return <TestHistoryPage testKey={key} api={defaultApiClient} />;
  },
});

const TONE: Record<string, BadgeProps['variant']> = {
  passed: 'success',
  failed: 'danger',
  timed_out: 'danger',
  flaky: 'warning',
};

function strip(entries: readonly TestHistoryEntry[]): React.ReactElement {
  // Oldest on the left, as every other timeline in the product reads.
  return (
    <ol
      aria-label="Outcomes, oldest first"
      className="flex flex-wrap gap-1"
      data-testid="test-strip"
    >
      {[...entries].reverse().map((entry) => (
        <li key={entry.runId}>
          <a
            href={`/dashboard/runs/${encodeURIComponent(entry.runId)}`}
            title={`${entry.status} · ${formatDate(entry.startedAt, '')}`}
            aria-label={`${entry.status} on ${formatDate(entry.startedAt, '')}`}
            className={`block h-6 w-3 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus ${
              entry.status === 'passed'
                ? 'bg-success'
                : entry.status === 'flaky'
                  ? 'bg-warning'
                  : entry.status === 'failed' || entry.status === 'timed_out'
                    ? 'bg-danger'
                    : 'bg-surface-muted'
            }`}
          />
        </li>
      ))}
    </ol>
  );
}

export function TestHistoryPage({
  testKey,
  api,
}: {
  testKey: string;
  api: ApiClient;
}): React.ReactElement {
  const [pages, setPages] = React.useState<TestHistory[]>([]);
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = React.useState('');

  const load = React.useCallback(
    (before?: string) => {
      setState('loading');
      api
        .getTestHistory(testKey, before === undefined ? {} : { before })
        .then((page) => {
          setPages((current) => (before === undefined ? [page] : [...current, page]));
          setState('ready');
        })
        .catch((caught: unknown) => {
          setMessage(caught instanceof Error ? caught.message : String(caught));
          setState('error');
        });
    },
    [api, testKey],
  );
  React.useEffect(() => {
    if (testKey !== '') load();
  }, [load, testKey]);

  if (testKey === '') {
    return (
      <PageFrame>
        <PageHeader title="Test history" />
        <EmptyState
          headingLevel={2}
          title="No test named"
          description="Open a test from Insights or a run."
        />
      </PageFrame>
    );
  }
  const entries = pages.flatMap((page) => page.entries);
  const first = pages[0];
  const last = pages.at(-1);
  const durations = [...entries]
    .reverse()
    .map((entry) => entry.durationMs)
    .filter((value): value is number => value !== null);
  const signatures = new Map<string, { count: number; example: string }>();
  for (const page of pages) {
    for (const item of page.signatures) {
      const seen = signatures.get(item.signature);
      signatures.set(item.signature, {
        count: (seen?.count ?? 0) + item.count,
        example: seen?.example ?? item.example,
      });
    }
  }

  return (
    <PageFrame data-testid="test-history-page" className="h-auto gap-4">
      <PageHeader
        title={first?.title ?? 'Test history'}
        subtitle={<span className="font-mono text-xs">{testKey}</span>}
      />
      {state === 'error' ? (
        <EmptyState
          headingLevel={2}
          data-testid="test-history-error"
          title="Could not read this test"
          description={message}
        />
      ) : null}
      {state === 'loading' && entries.length === 0 ? <Quiet>Reading the history…</Quiet> : null}
      {first !== undefined && entries.length === 0 ? (
        <Quiet data-testid="test-history-empty">{`No result in the last ${String(first.days)} days.`}</Quiet>
      ) : null}
      {entries.length > 0 ? (
        <>
          <Panel title={`${String(entries.length)} runs`}>
            {strip(entries)}
            {durations.length > 1 ? (
              <div className="mt-3" data-testid="test-durations">
                <Sparkline points={durations} label="Duration, oldest first" />
              </div>
            ) : null}
          </Panel>
          <Panel title="Why it failed" data-testid="test-signatures">
            {signatures.size === 0 ? (
              <Quiet>It has not failed in this window.</Quiet>
            ) : (
              <ul className="space-y-2">
                {[...signatures.entries()]
                  .sort((left, right) => right[1].count - left[1].count)
                  .map(([signature, value]) => (
                    <li key={signature} className="text-sm">
                      <span className="font-medium">{`${String(value.count)}×`}</span>{' '}
                      <span className="text-fg-muted">{value.example}</span>
                    </li>
                  ))}
              </ul>
            )}
          </Panel>
          <Panel title="Runs">
            <ul className="divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.runId} className="flex flex-wrap items-baseline gap-3 py-2 text-sm">
                  <Badge variant={TONE[entry.status] ?? 'default'}>{entry.status}</Badge>
                  <span>{formatDate(entry.startedAt, 'not recorded')}</span>
                  <span className="font-mono text-xs text-fg-muted">
                    {`${entry.branch ?? '—'} @ ${entry.commitSha?.slice(0, 12) ?? '—'}`}
                  </span>
                  {entry.durationMs === null ? null : (
                    <span className="text-fg-muted">{`${String(entry.durationMs)} ms`}</span>
                  )}
                  {entry.error === null ? null : (
                    <span className="w-full text-danger">{entry.error}</span>
                  )}
                </li>
              ))}
            </ul>
            {last?.nextBefore ? (
              <Button
                variant="outline"
                className="mt-3 min-h-11"
                data-testid="test-history-more"
                disabled={state === 'loading'}
                onClick={() => load(last.nextBefore ?? undefined)}
              >
                Older runs
              </Button>
            ) : null}
          </Panel>
        </>
      ) : null}
    </PageFrame>
  );
}
