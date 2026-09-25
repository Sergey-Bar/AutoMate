import { PerformanceScore } from '../../components/dashboard/PerformanceScore.js';
import { PerformanceBudget } from '../../components/dashboard/PerformanceBudget.js';
import { metricToScore, type PerformanceMetrics } from '../../services/performance-budget.js';

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
    <main style={{ maxWidth: 900, margin: '0 auto', padding: 32 }} data-testid="performance-page">
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Performance Audit</h1>
      <p style={{ color: '#5f6368', marginBottom: 32 }}>
        Lighthouse-style metrics and budget enforcement for your application.
      </p>

      {/* Score cards */}
      <section style={{ marginBottom: 40 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 20 }}>Core Web Vitals</h2>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap' }}>
          {METRIC_LABELS.map(({ key, label }) => (
            <div
              key={key}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: 20,
                background: '#fff',
                border: '1px solid #e8eaed',
                borderRadius: 12,
                minWidth: 140,
              }}
              data-testid={`metric-card-${key}`}
            >
              <PerformanceScore
                score={metricToScore(label, MOCK_METRICS[key] as number)}
                label={label}
                size={100}
              />
              <span style={{ marginTop: 8, fontSize: 13, color: '#5f6368' }}>
                {key === 'cls'
                  ? `${MOCK_METRICS[key]}`
                  : `${MOCK_METRICS[key]}ms`}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Budget config + status */}
      <section
        style={{
          background: '#fff',
          border: '1px solid #e8eaed',
          borderRadius: 12,
          padding: 24,
        }}
      >
        <PerformanceBudget metrics={MOCK_METRICS} />
      </section>
    </main>
  );
}

export default PerformancePage;
