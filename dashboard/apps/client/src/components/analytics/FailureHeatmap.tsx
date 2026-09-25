import { ResponsiveHeatMap } from '@nivo/heatmap';

export interface HeatmapCell {
  x: string; // date
  y: number; // failure count
}

export interface HeatmapSerie {
  id: string; // file path (short)
  data: HeatmapCell[];
}

interface FailureHeatmapProps {
  data: HeatmapSerie[];
}

export function FailureHeatmap({ data }: FailureHeatmapProps) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center h-40 text-xs text-text-tertiary"
      >
        No failure data yet
      </div>
    );
  }

  return (
    <div style={{ height: Math.max(180, data.length * 28 + 40) }}>
      <ResponsiveHeatMap
        data={data}
        margin={{ top: 20, right: 16, bottom: 30, left: 120 }}
        valueFormat=">-.0d"
        axisTop={null}
        axisBottom={{
          tickSize: 0,
          tickPadding: 6,
          tickRotation: -45,
          legendOffset: 40,
        }}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          tickRotation: 0,
        }}
        colors={{
          type: 'sequential',
          scheme: 'reds',
          minValue: 0,
        }}
        emptyColor="var(--color-bg-elevated)"
        borderColor="var(--color-border-subtle)"
        borderWidth={1}
        borderRadius={3}
        cellComponent="rect"
        labelTextColor={{ from: 'color', modifiers: [['brighter', 3]] }}
        theme={{
          axis: {
            ticks: {
              text: {
                fill: 'var(--color-text-tertiary)',
                fontSize: 10,
              },
            },
          },
          tooltip: {
            container: {
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-border-subtle)',
              borderRadius: 8,
              fontSize: 11,
              color: 'var(--color-text-primary)',
            },
          },
        }}
      />
    </div>
  );
}
