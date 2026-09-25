import { useMemo } from 'react';
import { statusColor, formatDuration } from '@/lib/formatters';

interface WorkerGanttTest {
  title: string;
  file: string;
  status: string;
  workerIndex?: number | null;
  durationMs?: number | null;
  startTime?: number | null;
}

interface WorkerGanttProps {
  tests: WorkerGanttTest[];
  totalDurationMs: number;
}

interface GanttWorker {
  index: number;
  items: { test: WorkerGanttTest; x: number; w: number }[];
}

const ROW_H = 20;
const GAP = 4;
const LABEL_W = 64;

export function WorkerGantt({ tests, totalDurationMs }: WorkerGanttProps) {
  const workers = useMemo<GanttWorker[]>(() => {
    const map = new Map<number, WorkerGanttTest[]>();
    for (const t of tests) {
      const wi = t.workerIndex ?? 0;
      if (!map.has(wi)) map.set(wi, []);
      map.get(wi)!.push(t);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, wTests]) => ({
        index,
        items: wTests
          .filter((t) => t.startTime != null && t.durationMs != null)
          .map((t) => ({
            test: t,
            x: ((t.startTime! / totalDurationMs) * 100),
            w: Math.max((t.durationMs! / totalDurationMs) * 100, 0.5),
          })),
      }));
  }, [tests, totalDurationMs]);

  if (!workers.length || !totalDurationMs) {
    return (
      <div className="flex items-center justify-center h-24 text-xs text-text-tertiary">
        No worker data — requires startTime on tests
      </div>
    );
  }

  const svgH = workers.length * (ROW_H + GAP) + 24;

  return (
    <div className="overflow-x-auto">
      <svg
        width="100%"
        height={svgH}
        viewBox={`0 0 1000 ${svgH}`}
        preserveAspectRatio="none"
        style={{ display: 'block' }}
      >
        {/* Time axis ticks */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const x = LABEL_W + (pct / 100) * (1000 - LABEL_W);
          const tMs = (pct / 100) * totalDurationMs;
          return (
            <g key={pct}>
              <line x1={x} y1={0} x2={x} y2={svgH - 20} stroke="var(--color-border-subtle)" strokeDasharray="3 3" />
              <text
                x={x}
                y={svgH - 6}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-text-tertiary)"
              >
                {formatDuration(tMs)}
              </text>
            </g>
          );
        })}

        {workers.map(({ index, items }, rowIdx) => {
          const y = rowIdx * (ROW_H + GAP);
          return (
            <g key={index}>
              {/* Worker label */}
              <text
                x={0}
                y={y + ROW_H / 2 + 4}
                fontSize={10}
                fill="var(--color-text-tertiary)"
              >
                W{index}
              </text>

              {/* Background row */}
              <rect
                x={LABEL_W}
                y={y}
                width={1000 - LABEL_W}
                height={ROW_H}
                rx={3}
                fill="var(--color-bg-elevated)"
              />

              {/* Test blocks */}
              {items.map(({ test, x, w }, i) => {
                const px = LABEL_W + (x / 100) * (1000 - LABEL_W);
                const pw = Math.max((w / 100) * (1000 - LABEL_W), 3);
                return (
                  <rect
                    key={i}
                    x={px}
                    y={y + 2}
                    width={pw}
                    height={ROW_H - 4}
                    rx={2}
                    fill={statusColor(test.status)}
                    opacity={0.85}
                  >
                    <title>{`${test.title}\n${formatDuration(test.durationMs ?? 0)}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 px-2">
        {(['passed', 'failed', 'skipped', 'flaky'] as const).map((s) => (
          <div key={s} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ background: statusColor(s) }} />
            <span className="text-[10px] text-text-tertiary">{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
