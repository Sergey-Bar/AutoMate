import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { useAnalytics } from '../../hooks/useDashboard.js';
import { useResource } from '../../hooks/useResource.js';
import {
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@automate/ui';
import type { AnalyticsSummary, ApiClient } from '../../lib/api.js';
import { createQaClient, type QaClient } from '../../lib/qa-client.js';
import type { AnalyticsTrend } from '../../lib/qa.js';
import { formatDuration, formatPercent, orDash, shortDate } from '../../lib/insights.js';
import {
  Kpi,
  PageFrame,
  PageHeader,
  Paged,
  Panel,
  Quiet,
  Segmented,
} from '../../components/kit.js';
import { TrendChart } from '../../components/TrendChart.js';
import { Responsive } from '../../components/responsive.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/analytics',
  component: () => <AnalyticsPage />,
});

const WINDOWS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
] as const;
type WindowValue = (typeof WINDOWS)[number]['value'];

/**
 * Analytics: the install's all-time figures, then the chosen window day by day.
 *
 * Two sources, and they are kept apart on screen because they answer different
 * questions. `analytics/summary` is every run the reporter recorded since the install
 * began; the trend is the execution store over a window. Mixing them in one row would
 * put an all-time pass rate beside a seven-day one with nothing to say which is which.
 */
export function AnalyticsPage({ api, qa }: { api?: ApiClient; qa?: QaClient }) {
  const { data, isLoading, error } = useAnalytics(api);
  const client = React.useMemo(() => qa ?? createQaClient(), [qa]);
  const [days, setDays] = React.useState<WindowValue>('30');
  const trend = useResource<AnalyticsTrend>(() => client.getTrend(Number(days)), [client, days]);

  if (isLoading) {
    return (
      <PageFrame data-testid="analytics-loading">
        <PageHeader title="Trends" />
        <Quiet>Loading analytics...</Quiet>
      </PageFrame>
    );
  }

  if (error) {
    return (
      <PageFrame>
        <PageHeader title="Trends" />
        <EmptyState
          headingLevel={2}
          data-testid="analytics-error"
          title="Error Loading Analytics"
          description={error.message}
        />
      </PageFrame>
    );
  }

  if (!data) {
    return (
      <PageFrame>
        <PageHeader title="Trends" />
        <EmptyState
          headingLevel={2}
          data-testid="analytics-empty"
          title="No Data"
          description="No analytics data available."
        />
      </PageFrame>
    );
  }

  const chart = (
    <>
      <Panel title={`Pass rate and volume · ${days} days`} className="flex-1">
        {trend.status === 'ready' ? (
          <TrendChart buckets={trend.value.buckets} data-testid="analytics-trend" />
        ) : (
          <Quiet data-testid="analytics-trend-state">
            {trend.status === 'error' ? trend.message : 'Reading run history…'}
          </Quiet>
        )}
      </Panel>
    </>
  );
  const byDay = (
    <>
      <Panel title="By day" data-testid="analytics-days" className="flex-1">
        {trend.status === 'ready' ? (
          <Paged items={trend.value.buckets.slice().reverse()} reservedPx={460} label="day">
            {(page) => (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Pass rate</TableHead>
                    <TableHead className="text-right">Failed tests</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.map((bucket) => (
                    <TableRow key={bucket.date}>
                      <TableCell>{shortDate(bucket.date)}</TableCell>
                      <TableCell numeric>{bucket.runs}</TableCell>
                      <TableCell numeric>{orDash(bucket.passRate, formatPercent)}</TableCell>
                      <TableCell numeric>{bucket.testsFailed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Paged>
        ) : (
          <Quiet>Waiting for run history…</Quiet>
        )}
      </Panel>
    </>
  );
  return (
    <PageFrame data-testid="analytics-page">
      <PageHeader
        title="Trends"
        subtitle="All-time figures, then the chosen window day by day"
        actions={<Segmented label="Window" options={WINDOWS} value={days} onChange={setDays} />}
      />
      <RunFigures
        summary={data}
        window={trend.status === 'ready' ? trend.value.current : null}
        days={days}
      />
      <Responsive
        label="Analytics sections"
        desktop={
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3">
            {chart}
            {byDay}
          </div>
        }
        panels={[
          { id: 'trend', label: 'Trend', node: chart },
          { id: 'days', label: 'By day', node: byDay },
        ]}
      />
    </PageFrame>
  );
}

/** The all-time pass rate, or `not measured` when no run exists to compute it from. */
export function allTimePassRate(summary: { totalRuns: number; passRate: number | null }): string {
  if (summary.totalRuns === 0 || summary.passRate === null) return 'not measured';
  return String(summary.passRate);
}

/** `%` beside a measured percentage, and no unit beside a dash or a sentence. */
function percentUnit(measured: boolean): { unit?: string } {
  return measured ? { unit: '%' } : {};
}

function RunFigures({
  summary,
  window,
  days,
}: {
  summary: AnalyticsSummary;
  window: AnalyticsTrend['current'] | null;
  days: string;
}): React.ReactElement {
  const allTime = allTimePassRate(summary);
  return (
    <section
      aria-label="Run figures"
      className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:grid-cols-6"
    >
      <Kpi
        data-testid="stat-total-runs"
        label="Runs · all time"
        value={String(summary.totalRuns)}
        footer="reporter-uploaded runs"
      />
      {/*
        The summary answers 0 for a pass rate it has no completed run to compute from, and
        0% reads as "every run failed". With no run there is no rate.
      */}
      <Kpi
        data-testid="stat-pass-rate"
        label="Pass rate · all time"
        value={allTime}
        {...percentUnit(allTime !== 'not measured')}
        footer="reporter-uploaded runs"
      />
      <Kpi
        data-testid="stat-avg-duration"
        label="Avg duration"
        /*
          `not measured`, not `N/A`: a missing measurement is a state rather than a value,
          and the word is the one the dashboard's unmeasured cells use, so one phrase means
          one thing across the product.
        */
        value={
          summary.avgDurationMs === null ? 'not measured' : formatDuration(summary.avgDurationMs)
        }
      />
      <WindowFigures window={window} days={days} />
    </section>
  );
}

function WindowFigures({
  window,
  days,
}: {
  window: AnalyticsTrend['current'] | null;
  days: string;
}): React.ReactElement {
  const passRate = window?.passRate ?? null;
  return (
    <>
      <Kpi
        data-testid="stat-window-runs"
        label={`Runs, ${days} days`}
        value={window === null ? '—' : String(window.runs)}
      />
      <Kpi
        data-testid="stat-window-pass-rate"
        label={`Pass rate, ${days} days`}
        value={orDash(passRate, (value) => value.toFixed(1))}
        {...percentUnit(passRate !== null)}
      />
      <Kpi
        data-testid="stat-window-failed"
        label={`Failed tests, ${days} days`}
        value={window === null ? '—' : String(window.testsFailed)}
        footer={window === null ? undefined : `of ${String(window.tests)} executed`}
      />
    </>
  );
}
