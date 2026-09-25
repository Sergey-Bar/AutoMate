import React from 'react';
import { Badge } from '@automate/ui';

export interface TimelineStep {
  name: string;
  startMs: number;
  durationMs: number;
  status: 'passed' | 'failed' | 'skipped' | 'running' | string;
}

interface RunTimelineProps {
  steps: TimelineStep[];
}

function statusVariant(status: string): 'success' | 'danger' | 'warning' | 'default' | 'secondary' {
  switch (status) {
    case 'passed': return 'success';
    case 'failed': return 'danger';
    case 'skipped': return 'warning';
    case 'running': return 'default';
    default: return 'secondary';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'passed': return '#22c55e';
    case 'failed': return '#ef4444';
    case 'skipped': return '#f59e0b';
    case 'running': return '#3b82f6';
    default: return '#6b7280';
  }
}

export function RunTimeline({ steps }: RunTimelineProps) {
  if (steps.length === 0) {
    return (
      <div data-testid="run-timeline-empty" className="text-text-secondary text-sm py-4 text-center">
        No timeline steps available.
      </div>
    );
  }

  const totalMs = Math.max(...steps.map((s) => s.startMs + s.durationMs));

  return (
    <div data-testid="run-timeline" className="space-y-2">
      {steps.map((step, idx) => {
        const leftPct = totalMs > 0 ? (step.startMs / totalMs) * 100 : 0;
        const widthPct = totalMs > 0 ? Math.max((step.durationMs / totalMs) * 100, 0.5) : 0.5;

        return (
          <div key={idx} data-testid={`timeline-step-${idx}`} className="flex items-center gap-3">
            <div className="w-40 shrink-0 truncate text-sm text-right" title={step.name}>
              {step.name}
            </div>
            <div className="flex-1 relative h-6 bg-surface-secondary rounded overflow-hidden">
              <div
                data-testid={`timeline-bar-${idx}`}
                style={{
                  position: 'absolute',
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  height: '100%',
                  backgroundColor: statusColor(step.status),
                  borderRadius: '2px',
                }}
                title={`${step.name}: ${step.durationMs}ms`}
              />
            </div>
            <div className="shrink-0">
              <Badge variant={statusVariant(step.status)} data-testid={`timeline-badge-${idx}`}>
                {step.status}
              </Badge>
            </div>
            <div className="w-20 shrink-0 text-xs text-text-secondary text-right" data-testid={`timeline-duration-${idx}`}>
              {step.durationMs}ms
            </div>
          </div>
        );
      })}
    </div>
  );
}
