import React, { useState } from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { TrendChart } from '../../components/dashboard/TrendChart.js';
import { Card, StatCard, Button } from '@automate/ui';
import { calculateMTTR, formatMttr } from '../../services/mttr.js';
import type { RunRecord } from '../../services/mttr.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/trends',
  component: () => <TrendsPage />,
});

type DateRange = 7 | 30 | 90;

interface TrendPoint {
  date: string;
  value: number;
}

function generateMockTrends(days: DateRange): TrendPoint[] {
  const points: TrendPoint[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    // Simulated pass rate between 70–100%
    const value = Math.round(70 + Math.random() * 30);
    points.push({ date: label, value });
  }
  return points;
}

function generateMockRuns(days: DateRange): RunRecord[] {
  const runs: RunRecord[] = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const ts = now - i * 86400000;
    const status: 'passed' | 'failed' = Math.random() > 0.2 ? 'passed' : 'failed';
    runs.push({ timestamp: ts, status });
  }
  return runs;
}

export function TrendsPage({
  getTrends = generateMockTrends,
  getRuns = generateMockRuns,
}: {
  getTrends?: (days: DateRange) => TrendPoint[];
  getRuns?: (days: DateRange) => RunRecord[];
}) {
  const [range, setRange] = useState<DateRange>(30);

  const trendData = getTrends(range);
  const runs = getRuns(range);
  const mttr = calculateMTTR(runs);

  const passCount = trendData.filter((p) => p.value >= 80).length;
  const avgPassRate =
    trendData.length > 0
      ? Math.round(trendData.reduce((s, p) => s + p.value, 0) / trendData.length)
      : 0;

  return (
    <div data-testid="trends-page" className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-text-primary">Pass-Rate Trends</h2>
        <div className="flex gap-2" data-testid="date-range-selector">
          {([7, 30, 90] as DateRange[]).map((d) => (
            <Button
              key={d}
              variant={range === d ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setRange(d)}
              data-testid={`range-btn-${d}`}
            >
              Last {d}d
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <StatCard
          title="Avg Pass Rate"
          value={`${avgPassRate}%`}
          data-testid="stat-avg-pass-rate"
        />
        <StatCard
          title="Days ≥ 80%"
          value={String(passCount)}
          data-testid="stat-good-days"
        />
        <StatCard
          title="MTTR"
          value={formatMttr(mttr.avgRecoveryMs)}
          data-testid="stat-mttr"
        />
      </div>

      <Card data-testid="trend-chart-card">
        <div className="p-4">
          <h3 className="text-sm font-semibold text-text-secondary mb-4">
            Pass Rate (%) — Last {range} days
          </h3>
          <TrendChart data={trendData} label="Pass Rate %" maxValue={100} />
        </div>
      </Card>
    </div>
  );
}
