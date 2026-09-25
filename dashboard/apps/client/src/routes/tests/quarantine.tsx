import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { EmptyState } from '@/components/shared/EmptyState';
import { QuarantineTable, type QuarantineRow } from '@/components/tests/QuarantineTable';
import { FeatureGate } from '@/components/FeatureGate';
import { FeatureDisabledPage } from '@/components/shared/FeatureDisabledPage';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/tests/quarantine')({
  component: QuarantinePageWrapper,
});

function QuarantinePageWrapper() {
  const { t } = useTranslation();

  return (
    <FeatureGate flag="auto-quarantine" fallback={<FeatureDisabledPage feature="Quarantine" />}>
    <ErrorBoundary label={t('quarantinePage.errorBoundaryLabel', { defaultValue: 'Quarantine' })}>
      <QuarantinePage />
    </ErrorBoundary>
    </FeatureGate>
  );
}

type FlakinessBreakdown = {
  timing: number;
  environment: number;
  data: number;
  assertion_drift: number;
  unknown: number;
  total: number;
};

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'timing', label: 'Timing' },
  { value: 'environment', label: 'Environment' },
  { value: 'data', label: 'Data' },
  { value: 'assertion_drift', label: 'Assertion Drift' },
  { value: 'unknown', label: 'Unknown' },
];

const CHART_COLORS = {
  Timing: '#fbbf24',
  Environment: '#f97316',
  Data: '#3b82f6',
  'Assertion Drift': '#a855f7',
  Unknown: '#9ca3af',
} as const;

type ChartEntryName = keyof typeof CHART_COLORS;

function FlakinessByCategoryChart({ breakdown }: { breakdown: FlakinessBreakdown }) {
  const allEntries: Array<{ name: ChartEntryName; value: number }> = [
    { name: 'Timing', value: breakdown.timing },
    { name: 'Environment', value: breakdown.environment },
    { name: 'Data', value: breakdown.data },
    { name: 'Assertion Drift', value: breakdown.assertion_drift },
    { name: 'Unknown', value: breakdown.unknown },
  ];
  const chartData = allEntries.filter((d) => d.value > 0);

  if (chartData.length === 0 || breakdown.total === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-text-tertiary">
        No classified data yet
      </div>
    );
  }

  return (
    <div className="w-full" style={{ height: 200 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={70}
            paddingAngle={2}
            dataKey="value"
          >
            {chartData.map((entry) => (
              <Cell key={entry.name} fill={CHART_COLORS[entry.name]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [`${value}`, 'Count']}
            contentStyle={{ fontSize: '11px' }}
          />
          <Legend
            iconSize={10}
            iconType="circle"
            wrapperStyle={{ fontSize: '11px' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function QuarantinePage() {
  const { t } = useTranslation();
  const tr = (key: string, fallback: string) => t(key, { defaultValue: fallback });
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [formTitle, setFormTitle] = useState('');
  const [formFile, setFormFile] = useState('');
  const [formReason, setFormReason] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const { data: rows, isLoading } = useQuery<QuarantineRow[]>({
    queryKey: ['quarantine'],
    queryFn: () => fetch('/api/quarantine').then((r) => r.json()),
  });

  const { data: breakdown } = useQuery<FlakinessBreakdown>({
    queryKey: ['flakiness-breakdown'],
    queryFn: () => fetch('/api/analytics/flakiness-breakdown').then((r) => r.json()),
  });

  const filteredRows = rows?.filter((row) =>
    categoryFilter === 'all' || (row.flakinessCategory ?? 'unknown') === categoryFilter,
  );

  const addMutation = useMutation({
    mutationFn: () =>
      fetch('/api/quarantine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          testTitle: formTitle,
          testFile: formFile,
          reason: formReason || undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quarantine'] });
      queryClient.invalidateQueries({ queryKey: ['flakiness-breakdown'] });
      toast.success(tr('quarantinePage.testQuarantined', 'Test quarantined'));
      setShowForm(false);
      setFormTitle('');
      setFormFile('');
      setFormReason('');
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/quarantine/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quarantine'] });
      queryClient.invalidateQueries({ queryKey: ['flakiness-breakdown'] });
      toast.success(tr('quarantinePage.removedFromQuarantine', 'Removed from quarantine'));
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formFile.trim()) return;
    addMutation.mutate();
  };

  return (
    <div
      className="flex flex-col gap-6 p-6 h-full overflow-y-auto bg-bg-surface"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldAlert size={18} className="text-text-tertiary" />
            <h1 className="text-lg font-semibold text-text-primary">
              {tr('quarantinePage.title', 'Quarantine')}
            </h1>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {tr('quarantinePage.subtitle', 'Quarantined tests are auto-skipped via --grep-invert during runs')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 bg-running text-white"
        >
          {showForm ? tr('common.cancel', 'Cancel') : tr('quarantinePage.addToQuarantine', 'Add to Quarantine')}
        </button>
      </div>

      {/* Flakiness category breakdown chart */}
      {breakdown && breakdown.total > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-surface p-4">
          <h2 className="text-xs font-semibold uppercase tracking-[0.07em] text-text-tertiary mb-2">
            Flakiness Breakdown
          </h2>
          <FlakinessByCategoryChart breakdown={breakdown} />
        </div>
      )}

      {/* Inline add form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle bg-bg-surface p-4"
        >
          <label className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-tertiary">
              {tr('quarantinePage.testTitle', 'Test Title *')}
            </span>
            <input
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              required
              className="rounded border border-border-subtle bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none"
              placeholder={tr('quarantinePage.testTitlePlaceholder', 'e.g. should display login form')}
            />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[180px]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-tertiary">
              {tr('quarantinePage.testFile', 'Test File *')}
            </span>
            <input
              value={formFile}
              onChange={(e) => setFormFile(e.target.value)}
              required
              className="rounded border border-border-subtle bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none"
              placeholder={tr('quarantinePage.testFilePlaceholder', 'e.g. tests/auth/login.spec.ts')}
            />
          </label>
          <label className="flex flex-col gap-1 flex-1 min-w-0 sm:min-w-[140px]">
            <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-tertiary">
              {tr('quarantinePage.reason', 'Reason')}
            </span>
            <input
              value={formReason}
              onChange={(e) => setFormReason(e.target.value)}
              className="rounded border border-border-subtle bg-transparent px-2 py-1.5 text-xs text-text-primary outline-none"
              placeholder={tr('quarantinePage.optionalReason', 'Optional reason')}
            />
          </label>
          <button
            type="submit"
            disabled={addMutation.isPending}
            className="shrink-0 rounded-lg px-4 py-1.5 text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50 bg-running text-white"
          >
            {addMutation.isPending ? tr('quarantinePage.saving', 'Saving…') : tr('quarantinePage.quarantine', 'Quarantine')}
          </button>
        </form>
      )}

      {/* Category filter */}
      {!isLoading && rows && rows.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.07em] text-text-tertiary">
            Filter by category:
          </span>
          <div className="flex flex-wrap gap-1">
            {CATEGORY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setCategoryFilter(opt.value)}
                className={`rounded px-2 py-0.5 text-xs font-medium border transition-colors ${
                  categoryFilter === opt.value
                    ? 'bg-running text-white border-running'
                    : 'bg-transparent text-text-secondary border-border-subtle hover:border-running'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-10 rounded-lg animate-pulse bg-border-subtle"
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && rows && rows.length === 0 && (
        <EmptyState
          illustration="shield"
          title={tr('quarantinePage.noQuarantinedTests', 'No quarantined tests')}
          description={tr('quarantinePage.allTestsActive', 'All tests are active. Quarantined tests will be automatically excluded from test runs via --grep-invert.')}
          cta={tr('quarantinePage.addToQuarantine', 'Add to Quarantine')}
          onCta={() => setShowForm(true)}
        />
      )}

      {/* Table */}
      {!isLoading && filteredRows && filteredRows.length > 0 && (
        <QuarantineTable
          rows={filteredRows}
          onRemove={(id) => removeMutation.mutate(id)}
          isRemoving={removeMutation.isPending}
        />
      )}

      {/* Empty filter result */}
      {!isLoading && rows && rows.length > 0 && filteredRows && filteredRows.length === 0 && (
        <div className="flex items-center justify-center rounded-lg border border-border-subtle p-8 text-xs text-text-tertiary">
          No quarantined tests match the selected category filter.
        </div>
      )}
    </div>
  );
}
