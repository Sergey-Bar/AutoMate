import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { motion } from 'framer-motion';
import { useRuns } from '@/hooks/useRun';
import { RunStatusBadge } from '@/components/shared/StatusBadge';
import { formatDuration, timeAgo, passRate, greeting } from '@/lib/formatters';
import { useRunStore } from '@/store/runStore';
import { RunTrigger } from '@/components/runs/RunTrigger';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { useTranslation } from 'react-i18next';
import { KpiSkeleton, RunListSkeleton } from '@/components/shared/Skeleton';
import { fadeSlideUp, stagger, counterFlip, safeMotion } from '@/lib/motion';
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImpactedTests } from '@/components/tests/ImpactedTests';

export const Route = createFileRoute('/')({
  component: DashboardPage,
});

export function DashboardPage() {
  const { t } = useTranslation();
  const { data: runs, isLoading } = useRuns();
  const [triggerOpen, setTriggerOpen] = useState(false);
  const liveRun = useRunStore((s) => s.run);
  const navigate = useNavigate();

  const latestRun = runs?.[0];
  const runsToday = runs?.filter((r) => {
    const d = new Date(r.startedAt);
    const today = new Date();
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth();
  }).length ?? 0;

  const avgPassRate = runs && runs.length > 0
    ? runs.slice(0, 10).reduce((sum, r) => sum + (r.total ? (r.passed / r.total) * 100 : 0), 0) / Math.min(runs.length, 10)
    : 0;

  // Fetch git changed files for impact analysis
  const { data: gitDiff } = useQuery({
    queryKey: ['git-diff'],
    queryFn: async () => {
      const res = await fetch('/api/tests/git-diff');
      if (!res.ok) return { changedFiles: [] as string[] };
      return res.json() as Promise<{ changedFiles: string[] }>;
    },
    staleTime: 60_000,
  });

  const gitChangedFiles = useMemo(() => gitDiff?.changedFiles ?? [], [gitDiff]);

  return (
    <ErrorBoundary label="Dashboard">
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Hero greeting */}
      <div
        className="p-5 rounded-xl border bg-bg-surface border-border-default"
      >
        <h1 className="text-xl font-semibold text-text-primary">
          {greeting()}.
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          {latestRun
            ? `Last run ${timeAgo(latestRun.startedAt)} — ${passRate(latestRun.passed, latestRun.total)} pass rate`
            : 'No runs yet. Trigger your first run to get started.'}
        </p>
        {liveRun?.status === 'running' && (
          <div className="mt-2 flex items-center gap-2 text-sm text-running">
            <span className="w-2 h-2 rounded-full pulse-ring bg-running" />
            Test run in progress — {liveRun.passed ?? 0} passed, {liveRun.failed ?? 0} failed
          </div>
        )}
      </div>

      {/* KPI cards */}
      {isLoading ? <KpiSkeleton /> : (
      <motion.div
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
        variants={safeMotion(stagger.list) as import('framer-motion').Variants}
        initial="hidden"
        animate="visible"
        aria-live="polite"
        aria-label="Key metrics"
      >
        <KpiCard title={t('dashboard.runsToday')} value={String(runsToday)} />
        <KpiCard title={t('dashboard.passRate')} value={`${avgPassRate.toFixed(1)}%`} />
        <KpiCard title={t('dashboard.avgDuration')} value={formatDuration(
          runs && runs.length > 0
            ? runs.slice(0, 10).reduce((s, r) => s + (r.durationMs ?? 0), 0) / Math.min(runs.length, 10)
            : null
        )} />
        <KpiCard
          title={t('dashboard.flakyTests')}
          value={String(runs?.slice(0, 10).reduce((s, r) => s + r.flaky, 0) ?? 0)}
        />
      </motion.div>
      )}

      {/* Impacted tests banner */}
      {gitChangedFiles.length > 0 && <ImpactedTests changedFiles={gitChangedFiles} />}

      {/* New Run button */}
      <div className="flex justify-end">
        <button
          onClick={() => setTriggerOpen(true)}
          className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-running text-white"
        >
          {t('dashboard.startNewRun')}
        </button>
      </div>

      {/* Recent Runs table */}
      <section>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider mb-3 text-text-tertiary">
          {t('dashboard.recentRuns')}
        </h2>
        {isLoading ? (
          <RunListSkeleton />
        ) : runs && runs.length > 0 ? (
          <div className="rounded-xl border border-border-default overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-bg-surface border-b border-border-subtle">
                  <th className="text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">Status</th>
                  <th className="text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">Run ID</th>
                  <th className="hidden sm:table-cell text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">Branch</th>
                  <th className="text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">Tests</th>
                  <th className="hidden sm:table-cell text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">Pass %</th>
                  <th className="hidden sm:table-cell text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">Duration</th>
                  <th className="text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">Time</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(0, 10).map((run) => (
                  <tr
                    key={run.id}
                    className="border-t border-border-subtle cursor-pointer hover:bg-white/2 transition-colors"
                    onClick={() => navigate({ to: '/runs/$runId', params: { runId: run.id } })}
                  >
                    <td className="px-4 py-2.5">
                      <RunStatusBadge status={run.status} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs tabular text-text-secondary">
                      {run.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-text-secondary hidden sm:table-cell">
                      {run.branch ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular text-xs">{run.total}</td>
                    <td className="px-4 py-2.5 tabular text-xs hidden sm:table-cell">{passRate(run.passed, run.total)}</td>
                    <td className="px-4 py-2.5 tabular text-xs hidden sm:table-cell">{formatDuration(run.durationMs)}</td>
                    <td className="px-4 py-2.5 text-xs tabular text-text-tertiary">
                      {timeAgo(run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={t('dashboard.noRuns')}
            description={t('dashboard.noRunsDesc')}
            cta={t('dashboard.startNewRun')}
            onCta={() => setTriggerOpen(true)}
          />
        )}
      </section>

      {triggerOpen && <RunTrigger onClose={() => setTriggerOpen(false)} />}
    </div>
    </ErrorBoundary>
  );
}

function KpiCard({ title, value }: { title: string; value: string }) {
  return (
    <motion.div
      variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
      className="p-5 rounded-xl border border-border-default bg-bg-surface transition-all duration-75 hover:border-border-focus"
    >
      <p className="text-[11px] font-medium uppercase tracking-wider mb-1 text-text-tertiary">
        {title}
      </p>
      <motion.p
        key={value}
        variants={safeMotion(counterFlip) as import('framer-motion').Variants}
        initial="hidden"
        animate="visible"
        className="text-[40px] font-semibold leading-none tabular text-text-primary"
      >
        {value}
      </motion.p>
    </motion.div>
  );
}


