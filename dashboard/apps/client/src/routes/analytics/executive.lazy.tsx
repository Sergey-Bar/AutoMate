import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { clsx } from 'clsx';

export const Route = createLazyFileRoute('/analytics/executive')({
  component: ExecutiveDashboard,
});

type Period = '30d' | '60d' | '90d';

interface RoiMetrics {
  qualityTrend: {
    currentPassRate: number;
    previousPassRate: number;
    changePct: number;
    dataPoints: Array<{ date: string; passRate: number }>;
  };
  flakyTestCost: {
    flakyReruns: number;
    estimatedMinutesWasted: number;
    changeVsPrevious: number;
  };
  quarantineEffectiveness: {
    quarantinedCount: number;
    passRateBeforeQuarantine: number;
    passRateAfterQuarantine: number;
    improvementPct: number;
  };
  escapedDefectRate: {
    totalRuns: number;
    runsWithFailures: number;
    rate: number;
    changeVsPrevious: number;
  };
  mttd: {
    avgDetectionMinutes: number;
    changeVsPrevious: number;
  };
  releaseFrequency: {
    runsPerWeek: number;
    totalRuns: number;
    changeVsPrevious: number;
  };
}

function useRoiMetrics(period: Period) {
  return useQuery<RoiMetrics>({
    queryKey: ['roi-metrics', period],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/roi-metrics?period=${period}`);
      if (!res.ok) throw new Error('Failed to load ROI metrics');
      return res.json() as Promise<RoiMetrics>;
    },
    staleTime: 60_000,
  });
}

function TrendIcon({ change, invertGood = false }: { change: number; invertGood?: boolean }) {
  const isPositive = invertGood ? change < 0 : change > 0;
  const isNeutral = change === 0;
  if (isNeutral) return <Minus className="h-4 w-4 text-gray-400" aria-label="no change" />;
  if (isPositive) return <ArrowUpRight className="h-4 w-4 text-emerald-500" aria-label="improvement" />;
  return <ArrowDownRight className="h-4 w-4 text-red-500" aria-label="decline" />;
}

function formatChange(change: number, unit = ''): string {
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}${unit}`;
}

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  change: number;
  changeLabel?: string;
  invertGood?: boolean;
  'data-testid'?: string;
}

function MetricCard({ title, value, subtitle, change, changeLabel, invertGood, 'data-testid': testId }: MetricCardProps) {
  const isGood = invertGood ? change <= 0 : change >= 0;
  const isNeutral = change === 0;

  return (
    <div
      data-testid={testId}
      className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
    >
      <p className="text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
      {subtitle && <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>}
      <div className={clsx('mt-3 flex items-center gap-1 text-xs font-medium', {
        'text-emerald-600': !isNeutral && isGood,
        'text-red-500': !isNeutral && !isGood,
        'text-gray-400': isNeutral,
      })}>
        <TrendIcon change={change} invertGood={invertGood} />
        <span>{changeLabel ?? formatChange(change)} vs previous period</span>
      </div>
    </div>
  );
}

function ExecutiveDashboard() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/analytics/executive' });
  const period: Period = (search.period as Period | undefined) ?? '30d';

  const { data: metrics, isLoading, isError } = useRoiMetrics(period);

  function setPeriod(p: Period) {
    void navigate({ search: (prev) => ({ ...prev, period: p }) });
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Executive Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500">Quality ROI metrics — {period} rolling window</p>
        </div>

        {/* Period selector */}
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1 bg-gray-50" role="group" aria-label="Period selector">
          {(['30d', '60d', '90d'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx('rounded-md px-3 py-1.5 text-sm font-medium transition-colors', {
                'bg-white text-gray-900 shadow-sm': period === p,
                'text-gray-500 hover:text-gray-700': period !== p,
              })}
              aria-pressed={period === p}
              data-testid={`period-${p}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="metrics-loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          Failed to load executive metrics. Please try again.
        </div>
      )}

      {/* Metrics grid */}
      {metrics && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="metrics-grid">
          <MetricCard
            data-testid="metric-quality-trend"
            title="Quality Trend"
            value={`${metrics.qualityTrend.currentPassRate.toFixed(1)}%`}
            subtitle={`Pass rate (${period})`}
            change={metrics.qualityTrend.changePct}
            changeLabel={formatChange(metrics.qualityTrend.changePct, '%')}
          />

          <MetricCard
            data-testid="metric-flaky-cost"
            title="Flaky Test Cost"
            value={`${metrics.flakyTestCost.estimatedMinutesWasted} min`}
            subtitle={`${metrics.flakyTestCost.flakyReruns} extra reruns`}
            change={metrics.flakyTestCost.changeVsPrevious}
            changeLabel={`${formatChange(metrics.flakyTestCost.changeVsPrevious)} min`}
            invertGood
          />

          <MetricCard
            data-testid="metric-quarantine"
            title="Quarantine Effectiveness"
            value={`${metrics.quarantineEffectiveness.improvementPct >= 0 ? '+' : ''}${metrics.quarantineEffectiveness.improvementPct.toFixed(1)}%`}
            subtitle={`${metrics.quarantineEffectiveness.quarantinedCount} tests quarantined`}
            change={metrics.quarantineEffectiveness.improvementPct}
            changeLabel={`${metrics.quarantineEffectiveness.passRateBeforeQuarantine.toFixed(1)}% → ${metrics.quarantineEffectiveness.passRateAfterQuarantine.toFixed(1)}%`}
          />

          <MetricCard
            data-testid="metric-escaped-defects"
            title="Escaped Defect Rate"
            value={`${metrics.escapedDefectRate.rate.toFixed(1)}%`}
            subtitle={`${metrics.escapedDefectRate.runsWithFailures} / ${metrics.escapedDefectRate.totalRuns} runs had failures`}
            change={metrics.escapedDefectRate.changeVsPrevious}
            invertGood
          />

          <MetricCard
            data-testid="metric-mttd"
            title="Mean Time to Detect"
            value={metrics.mttd.avgDetectionMinutes < 1
              ? `${(metrics.mttd.avgDetectionMinutes * 60).toFixed(0)}s`
              : `${metrics.mttd.avgDetectionMinutes.toFixed(1)} min`}
            subtitle="Avg run duration (proxy)"
            change={metrics.mttd.changeVsPrevious}
            changeLabel={`${formatChange(metrics.mttd.changeVsPrevious)} min`}
          />

          <MetricCard
            data-testid="metric-release-frequency"
            title="Release Frequency"
            value={`${metrics.releaseFrequency.runsPerWeek.toFixed(1)}/wk`}
            subtitle={`${metrics.releaseFrequency.totalRuns} total runs`}
            change={metrics.releaseFrequency.changeVsPrevious}
            changeLabel={formatChange(metrics.releaseFrequency.changeVsPrevious)}
          />
        </div>
      )}

      {/* Trend sparkline table */}
      {metrics && metrics.qualityTrend.dataPoints.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Pass Rate Trend</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" data-testid="trend-table">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pb-2 text-left font-medium text-gray-500">Date</th>
                  <th className="pb-2 text-right font-medium text-gray-500">Pass Rate</th>
                </tr>
              </thead>
              <tbody>
                {metrics.qualityTrend.dataPoints.map((pt) => (
                  <tr key={pt.date} className="border-b border-gray-50">
                    <td className="py-1 text-gray-600">{pt.date}</td>
                    <td className={clsx('py-1 text-right tabular-nums font-medium', {
                      'text-emerald-600': pt.passRate >= 95,
                      'text-amber-600': pt.passRate >= 80 && pt.passRate < 95,
                      'text-red-600': pt.passRate < 80,
                    })}>
                      {pt.passRate.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
