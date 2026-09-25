import { Link } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { statusColor } from '@/lib/formatters';
import { formatDuration, formatDate } from '@/lib/formatters';
import { safeMotion, spring, stagger } from '@/lib/motion';

interface HistoryRow {
  id: string;
  runId: string;
  status: string;
  durationMs: number | null;
  retryCount: number | null;
  runStartedAt: string;
  runBranch: string | null;
  runCommitSha: string | null;
}

interface TestHistoryTimelineProps {
  rows: HistoryRow[];
}

const dotVariant = {
  hidden: { opacity: 0, scale: 0.4 },
  visible: { opacity: 1, scale: 1, transition: spring.snappy },
};

const containerVariant = {
  hidden: {},
  visible: stagger.list,
};

/**
 * Visual timeline replacing the plain history table.
 * Shows color-coded dots per run (green/red/amber) with a duration bar below.
 * Newest run on the right.
 */
export function TestHistoryTimeline({ rows }: TestHistoryTimelineProps) {
  // Reverse so oldest is left, newest is right
  const sorted = [...rows].reverse();

  // Find max duration for relative bar sizing
  const maxDuration = Math.max(...sorted.map((r) => r.durationMs ?? 0), 1);

  return (
    <div className="p-4 flex flex-col gap-4">
      {/* Timeline dots row */}
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-medium text-text-tertiary">
          Status — last {sorted.length} runs (oldest → newest)
        </p>
        <motion.div
          className="flex items-center gap-1.5 overflow-x-auto py-1"
          variants={safeMotion(containerVariant) as import('framer-motion').Variants}
          initial="hidden"
          animate="visible"
        >
          {sorted.map((row) => (
            <motion.div key={row.id + row.runId} variants={safeMotion(dotVariant) as import('framer-motion').Variants}>
              <Link
                to="/runs/$runId"
                params={{ runId: row.runId }}
                search={{ testId: row.id }}
                className="group relative flex flex-col items-center"
              >
                {/* Status dot */}
                <div
                  className="w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-transform group-hover:scale-125"
                  style={{
                    background: statusColor(row.status === 'passed' ? 'passed' : row.status === 'failed' || row.status === 'timedOut' ? 'failed' : row.status === 'flaky' ? 'flaky' : 'skipped'),
                    borderColor: `color-mix(in oklch, ${statusColor(row.status === 'passed' ? 'passed' : row.status === 'failed' || row.status === 'timedOut' ? 'failed' : row.status === 'flaky' ? 'flaky' : 'skipped')} 60%, transparent)`,
                  }}
                  aria-label={`${row.status} — ${formatDate(row.runStartedAt)}`}
                />

                {/* Tooltip on hover */}
                <div
                  className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2 py-1 rounded text-[10px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 bg-bg-elevated text-text-primary border border-border-subtle"
                  style={{
                    boxShadow: '0 4px 12px oklch(0 0 0 / 20%)',
                  }}
                >
                  <span className="font-semibold uppercase" style={{ color: statusColor(row.status === 'passed' ? 'passed' : row.status === 'failed' || row.status === 'timedOut' ? 'failed' : row.status === 'flaky' ? 'flaky' : 'skipped') }}>
                    {row.status}
                  </span>
                  {' · '}
                  {formatDuration(row.durationMs)}
                  {' · '}
                  {formatDate(row.runStartedAt)}
                </div>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>

      {/* Duration bars */}
      <div className="flex flex-col gap-1">
        <p className="text-[11px] font-medium text-text-tertiary">
          Duration
        </p>
        <div className="flex items-end gap-1 h-16 overflow-x-auto">
          {sorted.map((row) => {
            const pct = ((row.durationMs ?? 0) / maxDuration) * 100;
            const color = statusColor(
              row.status === 'passed' ? 'passed'
                : row.status === 'failed' || row.status === 'timedOut' ? 'failed'
                : row.status === 'flaky' ? 'flaky' : 'skipped',
            );
            return (
              <Link
                key={row.id + row.runId + '-bar'}
                to="/runs/$runId"
                params={{ runId: row.runId }}
                search={{ testId: row.id }}
                className="group relative flex flex-col items-center justify-end flex-1 min-w-[14px] max-w-[20px] h-full"
              >
                <div
                  className="w-full rounded-t transition-all group-hover:opacity-80"
                  style={{
                    height: `${Math.max(pct, 4)}%`,
                    background: `color-mix(in oklch, ${color} 60%, transparent)`,
                    borderTop: `2px solid ${color}`,
                  }}
                />
                {/* Duration tooltip */}
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[9px] whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 bg-bg-elevated text-text-primary border border-border-subtle">
                  {formatDuration(row.durationMs)}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Legend / summary */}
      <div className="flex items-center gap-4 text-[11px] text-text-tertiary">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block bg-pass" /> Passed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block bg-fail" /> Failed
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block bg-flaky" /> Flaky
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block bg-skip" /> Skipped
        </span>
      </div>
    </div>
  );
}


// ─── Inline sparkline dots for test list rows ──────────────────────────────

interface HistoryDotsProps {
  stableId: string | null;
}

/**
 * Compact 7-dot sparkline showing last 7 results for a test.
 * Used inline in the Test Explorer list rows.
 */
export function HistoryDots({ stableId }: HistoryDotsProps) {
  if (!stableId) return null;

  // We intentionally do NOT useQuery here to avoid N+1 queries.
  // This component is populated via prefetched data passed from the parent.
  // For now, we export just the rendering piece and let the parent pass data.
  return null;
}

/**
 * Pure rendering component for history dots — receives data directly.
 * Avoids N+1 query problem by having parent batch-fetch.
 */
export function HistoryDotsDisplay({ dots }: { dots: Array<{ status: string }> }) {
  return (
    <div className="flex items-center gap-0.5 shrink-0" aria-label="Recent test history">
      {dots.slice(-7).map((d, i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full inline-block"
          style={{
            background: statusColor(
              d.status === 'passed' ? 'passed'
                : d.status === 'failed' || d.status === 'timedOut' ? 'failed'
                : d.status === 'flaky' ? 'flaky' : 'skipped',
            ),
          }}
          aria-label={d.status}
        />
      ))}
    </div>
  );
}
