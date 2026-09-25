import React, { useState } from 'react';
import { Badge } from '@automate/ui';
import { checkBudget, DEFAULT_THRESHOLDS, type PerformanceMetrics, type PerformanceThresholds } from '../../services/performance-budget.js';

interface PerformanceBudgetProps {
  metrics: PerformanceMetrics;
}

function passVariant(pass: boolean): 'success' | 'danger' {
  return pass ? 'success' : 'danger';
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
      <h2 className="text-lg font-semibold mb-4 text-text-primary">Performance Budget</h2>

      <div className="grid grid-cols-2 gap-3 mb-6">
        {(Object.keys(DEFAULT_THRESHOLDS) as Array<keyof PerformanceThresholds>).map(key => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-text-secondary">
              Max {key.toUpperCase()} {key === 'cls' ? '' : key === 'bundleSize' ? '(KB)' : '(ms)'}
            </span>
            <input
              type="number"
              value={thresholds[key] ?? ''}
              onChange={e => handleChange(key, e.target.value)}
              className="px-2 py-1.5 border border-border-default rounded text-sm bg-bg-elevated text-text-primary"
              data-testid={`threshold-${key}`}
            />
          </label>
        ))}
      </div>

      <h3 className="text-sm font-semibold mb-3 text-text-primary">Budget Status</h3>
      <div className="flex flex-col gap-2">
        {results.map(result => (
          <div
            key={result.metric}
            data-testid={`budget-result-${result.metric.replace(' ', '-')}`}
            className="flex items-center justify-between px-3 py-2 rounded-md border border-border-default bg-bg-elevated"
          >
            <span className="font-medium text-text-primary">{result.metric}</span>
            <span className="text-sm text-text-secondary">
              {result.value}{result.unit} / {result.threshold}{result.unit}
            </span>
            <Badge
              variant={passVariant(result.pass)}
              data-testid={`budget-status-${result.metric.replace(' ', '-')}`}
            >
              {result.pass ? 'PASS' : 'FAIL'}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
