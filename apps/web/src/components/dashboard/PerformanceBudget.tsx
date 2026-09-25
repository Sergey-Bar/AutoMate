import { useState } from 'react';
import { checkBudget, DEFAULT_THRESHOLDS, type PerformanceMetrics, type PerformanceThresholds } from '../../services/performance-budget.js';

interface PerformanceBudgetProps {
  metrics: PerformanceMetrics;
}

export function PerformanceBudget({ metrics }: PerformanceBudgetProps) {
  const [thresholds, setThresholds] = useState<PerformanceThresholds>(DEFAULT_THRESHOLDS);
  const results = checkBudget(metrics, thresholds);

  const handleChange = (key: keyof PerformanceThresholds, value: string) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setThresholds(prev => ({ ...prev, [key]: num }));
    }
  };

  return (
    <div data-testid="performance-budget">
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Performance Budget</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        {(Object.keys(DEFAULT_THRESHOLDS) as Array<keyof PerformanceThresholds>).map(key => (
          <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#5f6368' }}>
              Max {key.toUpperCase()} {key === 'cls' ? '' : key === 'bundleSize' ? '(KB)' : '(ms)'}
            </span>
            <input
              type="number"
              value={thresholds[key] ?? ''}
              onChange={e => handleChange(key, e.target.value)}
              style={{ padding: '6px 8px', border: '1px solid #dadce0', borderRadius: 4, fontSize: 14 }}
              data-testid={`threshold-${key}`}
            />
          </label>
        ))}
      </div>

      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>Budget Status</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {results.map(result => (
          <div
            key={result.metric}
            data-testid={`budget-result-${result.metric.replace(' ', '-')}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 12px',
              borderRadius: 6,
              background: result.pass ? '#e6f4ea' : '#fce8e6',
              border: `1px solid ${result.pass ? '#ceead6' : '#f5c6c2'}`,
            }}
          >
            <span style={{ fontWeight: 500 }}>{result.metric}</span>
            <span style={{ fontSize: 13, color: '#5f6368' }}>
              {result.value}{result.unit} / {result.threshold}{result.unit}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: result.pass ? '#137333' : '#c5221f',
              }}
              data-testid={`budget-status-${result.metric.replace(' ', '-')}`}
            >
              {result.pass ? 'PASS' : 'FAIL'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
