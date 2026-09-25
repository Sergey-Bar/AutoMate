import { Link } from '@tanstack/react-router';
import type { Run } from '@/lib/types';
import { RunStatusBadge } from '@/components/shared/StatusBadge';
import { formatDuration, timeAgo, passRate } from '@/lib/formatters';

interface RunCardProps {
  run: Run;
}

export function RunCard({ run }: RunCardProps) {
  return (
    <Link
      to="/runs/$runId"
      params={{ runId: run.id }}
      className="block p-4 rounded-xl border border-border-default bg-bg-surface transition-colors hover:border-border-focus"
    >
      <div className="flex items-center justify-between mb-2">
        <RunStatusBadge status={run.status} />
        <span className="text-[11px] tabular text-text-tertiary">
          {timeAgo(run.startedAt)}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <code className="text-xs text-text-secondary">
          {run.id.slice(0, 8)}
        </code>
        {run.branch && (
          <span className="text-[11px] px-1.5 py-0.5 rounded border border-border-subtle text-text-tertiary">
            {run.branch}
          </span>
        )}
      </div>

      {/* Mini pass bar */}
      <div className="mb-2 h-1 rounded-full overflow-hidden bg-bg-elevated">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: passRate(run.passed, run.total),
            background: run.failed > 0 ? 'var(--color-fail)' : 'var(--color-pass)',
          }}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs tabular text-text-secondary">
        <span className="text-pass">{run.passed} passed</span>
        {run.failed > 0 && <span className="text-fail">{run.failed} failed</span>}
        {run.flaky > 0 && <span className="text-flaky">{run.flaky} flaky</span>}
        <span className="ml-auto">{formatDuration(run.durationMs)}</span>
      </div>
    </Link>
  );
}
