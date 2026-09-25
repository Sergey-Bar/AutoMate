import React from 'react';

export interface TrendDataPoint {
  date: string;
  value: number;
}

export interface TrendChartProps {
  data: TrendDataPoint[];
  /** Label for the y-axis value (e.g. "Pass Rate %") */
  label?: string;
  /** Max value for scaling bars (defaults to 100) */
  maxValue?: number;
  /** Color class for bars (Tailwind) */
  barColor?: string;
}

/**
 * CSS-only bar chart for trend data.
 * No external chart library — pure Tailwind + inline styles.
 */
export function TrendChart({
  data,
  label = 'Value',
  maxValue = 100,
  barColor = 'bg-blue-500',
}: TrendChartProps) {
  if (data.length === 0) {
    return (
      <div
        data-testid="trend-chart-empty"
        className="flex items-center justify-center h-32 text-text-secondary text-sm"
      >
        No data available
      </div>
    );
  }

  const effectiveMax = maxValue > 0 ? maxValue : 1;

  return (
    <div data-testid="trend-chart" className="w-full">
      {label && (
        <div className="text-xs text-text-secondary mb-2">{label}</div>
      )}
      <div className="flex items-end gap-1 h-32" role="img" aria-label={`${label} trend chart`}>
        {data.map((point, i) => {
          const heightPct = Math.min(100, Math.max(0, (point.value / effectiveMax) * 100));
          return (
            <div
              key={i}
              className="flex flex-col items-center flex-1 h-full justify-end"
              title={`${point.date}: ${point.value}`}
            >
              <div
                data-testid={`trend-bar-${i}`}
                className={`w-full rounded-t ${barColor} transition-all`}
                style={{ height: `${heightPct}%` }}
                aria-label={`${point.date}: ${point.value}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-text-secondary">{data[0]?.date}</span>
        <span className="text-xs text-text-secondary">{data[data.length - 1]?.date}</span>
      </div>
    </div>
  );
}
