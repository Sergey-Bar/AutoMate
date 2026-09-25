import { createLazyFileRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { TtfKpiCards } from '@/components/analytics/TtfKpiCards.js';
import { TtfTrendChart } from '@/components/analytics/TtfTrendChart.js';

export const Route = createLazyFileRoute('/analytics/time-to-fix')({
  component: TimeToFixDashboard,
});

interface TtfTrendPoint {
  week: string;
  avgTtfMs: number;
  resolvedCount: number;
}

interface TtfStats {
  avgTtfMs: number;
  medianTtfMs: number;
  p95TtfMs: number;
  activeCount: number;
  resolvedCount: number;
  byCategory: Record<string, { avgTtfMs: number; count: number }>;
  trend: TtfTrendPoint[];
}

function useTtfStats() {
  return useQuery<TtfStats>({
    queryKey: ['ttf-stats'],
    queryFn: async () => {
      const res = await fetch('/api/analytics/time-to-fix');
      if (!res.ok) throw new Error('Failed to load TTF stats');
      return res.json() as Promise<TtfStats>;
    },
    staleTime: 60_000,
  });
}

export default function TimeToFixDashboard() {
  const { data: stats, isLoading, isError } = useTtfStats();
  const [hourlyRate, setHourlyRate] = useState(100);
  const [hoursPerTest, setHoursPerTest] = useState(2);

  const costEstimate = (stats?.activeCount ?? 0) * hoursPerTest * hourlyRate;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Time-to-Fix Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track how long quarantined tests take to auto-recover
        </p>
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="ttf-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />
          ))}
        </div>
      )}

      {/* Error state */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
          Failed to load time-to-fix metrics. Please try again.
        </div>
      )}

      {/* KPI cards */}
      {stats && (
        <>
          <TtfKpiCards
            avgTtfMs={stats.avgTtfMs}
            medianTtfMs={stats.medianTtfMs}
            p95TtfMs={stats.p95TtfMs}
            activeCount={stats.activeCount}
            resolvedCount={stats.resolvedCount}
          />

          {/* Trend chart */}
          <TtfTrendChart data={stats.trend} />

          {/* Active quarantine note */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold text-gray-700">Active Quarantines</h2>
            <p className="text-sm text-gray-500">
              {stats.activeCount > 0 ? (
                <>
                  <span className="font-medium text-gray-900">{stats.activeCount}</span>{' '}
                  {stats.activeCount === 1 ? 'test is' : 'tests are'} currently quarantined.{' '}
                  <a
                    href="/tests/quarantine"
                    className="text-indigo-600 hover:text-indigo-800 underline"
                  >
                    View quarantine list →
                  </a>
                </>
              ) : (
                'No tests are currently quarantined.'
              )}
            </p>
          </div>

          {/* Cost estimation */}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm" data-testid="cost-estimate">
            <h2 className="mb-4 text-sm font-semibold text-amber-800">Cost Estimate</h2>
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-xs font-medium text-amber-700 mb-1" htmlFor="hourly-rate">
                  Hourly rate ($)
                </label>
                <input
                  id="hourly-rate"
                  type="number"
                  min={1}
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(Number(e.target.value))}
                  className="w-24 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-amber-700 mb-1" htmlFor="hours-per-test">
                  Hours per test fix
                </label>
                <input
                  id="hours-per-test"
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={hoursPerTest}
                  onChange={(e) => setHoursPerTest(Number(e.target.value))}
                  className="w-24 rounded border border-amber-300 bg-white px-2 py-1 text-sm"
                />
              </div>
              <div className="flex-1">
                <p className="text-xs text-amber-700 mb-1">Estimated cost of active quarantines</p>
                <p className="text-3xl font-bold text-amber-900" data-testid="cost-value">
                  ${costEstimate.toLocaleString()}
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {stats.activeCount} tests × {hoursPerTest}h × ${hourlyRate}/hr
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
