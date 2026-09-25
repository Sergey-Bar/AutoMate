import { useEffect } from 'react';
import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { ErrorAlert } from '@/components/shared/ErrorAlert';
import { ChartGridSkeleton } from '@/components/shared/Skeleton';
import { DateRangePicker } from '@/components/analytics/DateRangePicker';
import { PassRateChart, type PassRatePoint } from '@/components/analytics/PassRateChart';
import { DurationChart, type DurationPoint } from '@/components/analytics/DurationChart';
import { FlakyLeaderboard, type FlakyTest } from '@/components/analytics/FlakyLeaderboard';
import { SlowestTests, type SlowTest } from '@/components/analytics/SlowestTests';
import { FailureHeatmap, type HeatmapSerie } from '@/components/analytics/FailureHeatmap';
import { WorkerGantt } from '@/components/analytics/WorkerGantt';
import { useRuns } from '@/hooks/useRun';
import { useCategories, useFingerprintCategories } from '@/hooks/useCategories';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { ANALYTICS_PRESETS, type AnalyticsPreset } from '@/lib/analytics-presets';
import { PresetSwitcher } from '@/components/analytics/PresetSwitcher';

export const Route = createLazyFileRoute('/analytics/')({
  component: AnalyticsPage,
});

function usePassRate(days: number) {
  const wsId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery<PassRatePoint[]>({
    queryKey: ['analytics-pass-rate', days, wsId],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) });
      if (wsId) params.set('workspaceId', wsId);
      const res = await fetch(`/api/analytics/pass-rate?${params}`);
      if (!res.ok) throw new Error('Failed to load pass-rate data');
      return res.json();
    },
    staleTime: 60_000,
  });
}

function useDuration(days: number) {
  const wsId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery<DurationPoint[]>({
    queryKey: ['analytics-duration', days, wsId],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) });
      if (wsId) params.set('workspaceId', wsId);
      const res = await fetch(`/api/analytics/duration?${params}`);
      if (!res.ok) throw new Error('Failed to load duration data');
      return res.json();
    },
    staleTime: 60_000,
  });
}

function useFlaky() {
  const wsId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery<FlakyTest[]>({
    queryKey: ['analytics-flaky', wsId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '50' });
      if (wsId) params.set('workspaceId', wsId);
      const res = await fetch(`/api/analytics/flaky?${params}`);
      if (!res.ok) throw new Error('Failed to load flaky data');
      return res.json();
    },
    staleTime: 60_000,
  });
}

function useSlow() {
  const wsId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery<SlowTest[]>({
    queryKey: ['analytics-slow', wsId],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '20' });
      if (wsId) params.set('workspaceId', wsId);
      const res = await fetch(`/api/analytics/slow?${params}`);
      if (!res.ok) throw new Error('Failed to load slowest tests');
      return res.json();
    },
    staleTime: 60_000,
  });
}

function useHeatmap(days: number) {
  const wsId = useWorkspaceStore((s) => s.activeWorkspaceId);
  return useQuery<HeatmapSerie[]>({
    queryKey: ['analytics-heatmap', days, wsId],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days) });
      if (wsId) params.set('workspaceId', wsId);
      const res = await fetch(`/api/analytics/heatmap?${params}`);
      if (!res.ok) throw new Error('Failed to load heatmap data');
      return res.json();
    },
    staleTime: 60_000,
  });
}

function AnalyticsPage() {
  const { days: daysParam, preset: presetParam } = Route.useSearch();
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/analytics/' });

  const { data: features } = useQuery<{ 'role-based-views': boolean }>({
    queryKey: ['features'],
    queryFn: async () => fetch('/api/features').then((res) => res.json()),
  });
  const presetsEnabled = features?.['role-based-views'] ?? false;

  // Handle preset from URL or localStorage fallback
  useEffect(() => {
    if (presetsEnabled && !presetParam) {
      const savedPreset = localStorage.getItem('analytics-preset') as AnalyticsPreset | null;
      if (savedPreset && ANALYTICS_PRESETS[savedPreset]) {
        navigate({ search: (prev) => ({ ...prev, preset: savedPreset }), replace: true });
      }
    }
  }, [navigate, presetParam, presetsEnabled]);

  const preset: AnalyticsPreset = (presetsEnabled && presetParam && presetParam in ANALYTICS_PRESETS ? presetParam : 'all') as AnalyticsPreset;
  const days = daysParam ?? 30;
  const setDays = (d: number) => navigate({ search: (prev) => ({ ...prev, days: d }) });

  const passRate = usePassRate(days);
  const duration = useDuration(days);
  const flaky = useFlaky();
  const slow = useSlow();
  const heatmap = useHeatmap(days);
  const { data: runs } = useRuns();

  const latestRunId = runs?.[0]?.id;

  const isLoading =
    passRate.isLoading || duration.isLoading || flaky.isLoading || slow.isLoading || heatmap.isLoading;

  const error =
    passRate.error || duration.error || flaky.error || slow.error || heatmap.error;

  // Derive project list from pass-rate data (all keys except 'date')
  const projects =
    passRate.data && passRate.data.length > 0
      ? Object.keys(passRate.data[0] ?? {}).filter((k) => k !== 'date')
      : ['all'];

  const WIDGETS: Record<string, React.ReactNode> = {
    'pass-rate': (
      <ChartCard title={t('analytics.passRateTrend')} subtitle="Test pass rate over time">
        {passRate.data && passRate.data.length > 0 ? (
          <PassRateChart data={passRate.data} projects={projects} />
        ) : (
          <EmptyChart label={t('analytics.noPassRateData')} />
        )}
      </ChartCard>
    ),
    duration: (
      <ChartCard title={t('analytics.suiteDuration')} subtitle="Suite execution time trend">
        {duration.data && duration.data.length > 0 ? (
          <DurationChart data={duration.data} />
        ) : (
          <EmptyChart label={t('analytics.noDurationData')} />
        )}
      </ChartCard>
    ),
    heatmap: (
      <div className="lg:col-span-2">
        <ChartCard title={t('analytics.failureHeatmap')} subtitle="Failure frequency by test and day">
          {heatmap.data && heatmap.data.length > 0 ? (
            <FailureHeatmap data={heatmap.data} />
          ) : (
            <EmptyChart label={t('analytics.noFailureData')} />
          )}
        </ChartCard>
      </div>
    ),
    flaky: (
      <div data-testid="flaky-leaderboard">
        <ChartCard title={t('analytics.flakyLeaderboard')} subtitle="Tests with highest flake rate">
          {flaky.data && flaky.data.length > 0 ? (
            <FlakyLeaderboard data={flaky.data} />
          ) : (
            <EmptyChart label={t('analytics.noFlakyTests')} />
          )}
        </ChartCard>
      </div>
    ),
    slowest: (
      <ChartCard title={t('analytics.slowestTests')} subtitle="Longest-running test cases">
        {slow.data && slow.data.length > 0 ? <SlowestTests data={slow.data} /> : <EmptyChart label={t('analytics.noSlowTests')} />}
      </ChartCard>
    ),
    gantt: latestRunId ? (
      <div className="lg:col-span-2">
        <WorkerGanttCard runId={latestRunId} />
      </div>
    ) : null,
    category: (
      <div className="lg:col-span-2">
        <ChartCard title={t('analytics.failuresByCategory')} subtitle="Distribution of failures across categories">
          <FailuresByCategoryChart />
        </ChartCard>
      </div>
    ),
    // ── T14: Stakeholder-specific widgets ──────────────────────────────────
    'quarantine-queue': (
      <div data-testid="quarantine-queue">
        <ChartCard title="Quarantine Queue" subtitle="Pending quarantine entries awaiting approval">
          <QuarantineQueueWidget />
        </ChartCard>
      </div>
    ),
    'stability-trends': (
      <div data-testid="stability-trends">
        <ChartCard title={t('analytics.passRateTrend')} subtitle="Test suite stability over time">
          {passRate.data && passRate.data.length > 0 ? (
            <PassRateChart data={passRate.data} projects={projects} />
          ) : (
            <EmptyChart label={t('analytics.noPassRateData')} />
          )}
        </ChartCard>
      </div>
    ),
    'exec-roi-metrics': (
      <div className="lg:col-span-2" data-testid="exec-roi-metrics">
        <ChartCard title="ROI Metrics" subtitle="Engineering efficiency and quality investment return">
          <ExecRoiPlaceholder />
        </ChartCard>
      </div>
    ),
  };

  const activeWidgets = ANALYTICS_PRESETS[preset]?.widgets ?? ANALYTICS_PRESETS.all.widgets;

  return (
    <ErrorBoundary label="Analytics">
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold text-text-primary">{t('analytics.title')}</h1>
            <PresetSwitcher currentPreset={preset} />
          </div>
          <DateRangePicker days={days} onChange={setDays} />
        </div>

        {error && (
          <ErrorAlert
            error={error}
            onRetry={() => {
              passRate.refetch();
              duration.refetch();
              flaky.refetch();
              slow.refetch();
              heatmap.refetch();
            }}
          />
        )}

        {isLoading ? (
          <ChartGridSkeleton />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {activeWidgets.map((widgetId) => {
              const widget = WIDGETS[widgetId];
              return widget ? <div key={widgetId}>{widget}</div> : null;
            })}
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

/* ─── Worker Gantt card (fetches its own data) ─────────────────────────── */

function WorkerGanttCard({ runId }: { runId: string }) {
  const { data, isLoading } = useQuery<
    Array<{ title: string; file: string; status: string; workerIndex?: number | null; durationMs?: number | null; startTime?: number | null }>
  >({
    queryKey: ['analytics-gantt', runId],
    queryFn: async () => {
      const res = await fetch(`/api/analytics/gantt?runId=${runId}`);
      if (!res.ok) throw new Error('Failed to load gantt data');
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: runs } = useRuns();
  const run = runs?.find((r) => r.id === runId);
  const totalDurationMs = run?.durationMs ?? 0;

  if (isLoading || !data) return null;

  return (
    <ChartCard title={`Worker Gantt — Run ${runId.slice(0, 8)}`}>
      <WorkerGantt tests={data} totalDurationMs={totalDurationMs} />
    </ChartCard>
  );
}

/* ─── Shared chart card wrapper ────────────────────────────────────────── */

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl border border-border-default bg-bg-elevated overflow-hidden"
      role="img"
      aria-label={title}
    >
      <div
        className="px-4 py-2.5 border-b border-border-subtle"
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
          {title}
        </h2>
        {subtitle && (
          <p className="text-[10px] mt-0.5 text-text-tertiary" style={{ opacity: 0.7 }}>
            {subtitle}
          </p>
        )}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-40 text-xs text-text-tertiary">
      {label}
    </div>
  );
}

/* ─── Failures By Category Card ──────────────────────────────────── */

function FailuresByCategoryChart() {
  const { data: categories } = useCategories();
  const { data: fpCats } = useFingerprintCategories();
  const { t } = useTranslation();

  if (!categories?.length) {
    return (
      <div className="text-sm text-center py-8 text-text-tertiary">
        {t('analytics.noCategories')}
      </div>
    );
  }

  const counts = new Map<string, number>();
  for (const fc of fpCats ?? []) {
    counts.set(fc.categoryId, (counts.get(fc.categoryId) ?? 0) + 1);
  }

  const chartData = categories
    .map((cat) => ({ name: cat.name, count: counts.get(cat.id) ?? 0, color: cat.color }))
    .filter((d) => d.count > 0);

  if (!chartData.length) {
    return (
      <div className="text-sm text-center py-8 text-text-tertiary">
        {t('analytics.noFingerprints')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
        <XAxis className="text-text-secondary" dataKey="name" tick={{ fontSize: 11, fill: 'currentColor' }} />
        <YAxis className="text-text-secondary" tick={{ fontSize: 11, fill: 'currentColor' }} allowDecimals={false} />
        <Tooltip
          wrapperClassName="rounded-lg border border-border-default bg-surface-2 text-text-secondary"
          contentStyle={{ borderRadius: 8 }}
          labelClassName="text-text-primary text-xs"
          itemStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="count" name="Fingerprints" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ─── T14: QuarantineQueueWidget ───────────────────────────────────────── */

interface QuarantineEntry {
  id: string;
  testTitle: string;
  testFile: string;
  quarantinedAt: string;
  quarantinedBy: string;
  status: string;
}

function QuarantineQueueWidget() {
  const { data, isLoading, isError } = useQuery<QuarantineEntry[]>({
    queryKey: ['quarantine-pending'],
    queryFn: async () => {
      const res = await fetch('/api/quarantine/pending');
      // Flag off → 404, just return empty list
      if (res.status === 404) return [];
      if (!res.ok) throw new Error('Failed to load quarantine queue');
      return res.json();
    },
    staleTime: 60_000,
  });

  if (isLoading) return <div className="flex justify-center py-6 text-xs text-text-tertiary">Loading…</div>;
  if (isError) return <div className="text-xs text-center py-6 text-text-tertiary">Unable to load queue</div>;

  const entries = data ?? [];

  if (entries.length === 0) {
    return <div className="text-xs text-center py-6 text-text-tertiary">No pending approvals</div>;
  }

  return (
    <ul className="space-y-1.5 max-h-56 overflow-y-auto">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-xs rounded-md bg-bg-hover px-2.5 py-1.5">
          <span className="mt-0.5 size-1.5 rounded-full bg-warning-500 shrink-0" />
          <div className="min-w-0">
            <p className="truncate font-medium text-text-primary">{e.testTitle}</p>
            <p className="truncate text-text-tertiary">{e.testFile}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ─── T14: ExecRoiPlaceholder ──────────────────────────────────────────── */

function ExecRoiPlaceholder() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
      <p className="text-sm font-medium text-text-primary">ROI Metrics — Coming in v3.1</p>
      <p className="text-xs text-text-tertiary max-w-xs">
        Executive ROI dashboard will display test coverage cost savings, defect escape rate, and MTTR trends.
      </p>
    </div>
  );
}
