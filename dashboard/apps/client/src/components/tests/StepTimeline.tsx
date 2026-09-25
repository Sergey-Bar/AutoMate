import type { Step } from '@/lib/types';
import { formatDuration } from '@/lib/formatters';

interface StepTimelineProps {
  steps: Step[];
  totalDurationMs: number;
}

const STEP_COLORS: Record<string, string> = {
  action: 'var(--color-pass)',
  expect: '#6366f1',
  navigate: '#f59e0b',
  wait: '#94a3b8',
  attach: '#06b6d4',
  unknown: 'var(--color-border-default)',
};

function stepColor(type: string) {
  return STEP_COLORS[type] ?? STEP_COLORS.unknown;
}

export function StepTimeline({ steps, totalDurationMs }: StepTimelineProps) {
  if (!steps.length || !totalDurationMs) return null;

  const height = 32;
  const labelH = 16;
  const barY = labelH + 4;
  const barH = height - barY;

  return (
    <div className="px-4 py-3">
      <p className="text-[11px] mb-2 uppercase tracking-wider text-text-tertiary">
        Step Timeline
      </p>
      <svg
        className="w-full"
        height={height}
        preserveAspectRatio="none"
        viewBox={`0 0 1000 ${height}`}
        style={{ display: 'block' }}
      >
        {steps.map((step, i) => {
          const xStart = ((step.startTime ?? 0) / totalDurationMs) * 1000;
          const xEnd = ((step.endTime ?? step.startTime ?? 0) / totalDurationMs) * 1000;
          const w = Math.max(xEnd - xStart, 4);
          const color = stepColor(step.category ?? 'unknown');

          return (
            <g key={i}>
              <rect
                x={xStart}
                y={barY}
                width={w}
                height={barH}
                rx={2}
                fill={color}
                opacity={0.8}
              >
                <title>{`${step.title}\n${formatDuration(step.durationMs ?? 0)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>

      {/* Legend row */}
      <div className="flex flex-wrap gap-3 mt-2">
        {Object.entries(STEP_COLORS)
          .filter(([k]) => k !== 'unknown')
          .map(([type, color]) => (
            <div key={type} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-[10px] text-text-tertiary">
                {type}
              </span>
            </div>
          ))}
      </div>
    </div>
  );
}
