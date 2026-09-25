import React from 'react';
import { createRoute } from '@tanstack/react-router';
import { Route as dashboardRoute } from '../dashboard.js';
import { PerformanceScore } from '../../components/dashboard/PerformanceScore.js';
import { PerformanceBudget } from '../../components/dashboard/PerformanceBudget.js';
import { metricToScore, type PerformanceMetrics } from '../../services/performance-budget.js';

export const Route = createRoute({
  getParentRoute: () => dashboardRoute,
  path: '/performance',
  component: () => <PerformancePage />,
});

// Mock metrics — in a real app these would come from a Lighthouse run or RUM data
const MOCK_METRICS: PerformanceMetrics = {
  lcp: 2100,
  fid: 80,
  cls: 0.08,
  tti: 3200,
  bundleSize: 420,
};

const METRIC_LABELS: Array<{ key: keyof Pick<PerformanceMetrics, 'lcp' | 'fid' | 'cls' | 'tti'>; label: string }> = [
  { key: 'lcp', label: 'LCP' },
  { key: 'fid', label: 'FID' },
  { key: 'cls', label: 'CLS' },
  { key: 'tti', label: 'TTI' },
];

export function PerformancePage() {
  return (
    <main className="max-w-4xl mx-auto p-8" data-testid="performance-page">
      <h1 className="text-2xl font-bold mb-2 text-text-primary">Performance Audit</h1>
      <p className="text-text-secondary mb-8">
        Lighthouse-style metrics and budget enforcement for your application.
      </p>

      <section className="mb-10">
        <h2 className="text-lg font-semibold mb-5 text-text-primary">Core Web Vitals</h2>
        <div className="flex gap-6 flex-wrap">
          {METRIC_LABELS.map(({ key, label }) => (
            <div
              key={key}
              className="flex flex-col items-center p-5 bg-bg-elevated border border-border-default rounded-xl min-w-[140px]"
              data-testid={`metric-card-${key}`}
            >
              <PerformanceScore
                score={metricToScore(label, MOCK_METRICS[key] as number)}
                label={label}
                size={100}
              />
              <span className="mt-2 text-sm text-text-secondary">
                {key === 'cls'
                  ? `${MOCK_METRICS[key]}`
                  : `${MOCK_METRICS[key]}ms`}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-bg-elevated border border-border-default rounded-xl p-6">
        <PerformanceBudget metrics={MOCK_METRICS} />
      </section>
    </main>
  );
}

export default PerformancePage;
