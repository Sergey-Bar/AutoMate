import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, RefreshCw, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatePresence } from 'framer-motion';
import { lazy, Suspense, useState } from 'react';
import { BaselineCard } from '@/components/artifacts/BaselineCard';
import { Skeleton } from '@/components/shared/Skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { FeatureGate } from '@/components/FeatureGate';
import { FeatureDisabledPage } from '@/components/shared/FeatureDisabledPage';
import { useTranslation } from 'react-i18next';

const BASELINE_SKELETON_KEYS = [
  'baseline-skeleton-1',
  'baseline-skeleton-2',
  'baseline-skeleton-3',
  'baseline-skeleton-4',
  'baseline-skeleton-5',
  'baseline-skeleton-6',
  'baseline-skeleton-7',
  'baseline-skeleton-8',
] as const;

const BaselineBatchReview = lazy(() =>
  import('@/components/artifacts/BaselineBatchReview').then((m) => ({ default: m.BaselineBatchReview })),
);

export const Route = createFileRoute('/baselines/')({
  component: BaselinesPage,
});

interface BaselineEntry {
  id: string;
  testFile: string;
  snapshotName: string;
  expectedPath: string;
  actualPath: string | null;
  diffPath: string | null;
  hasActual: boolean;
  hasDiff: boolean;
  expectedSizeBytes: number;
}

function BaselinesPage() {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | 'changed'>('all');
  const [search, setSearch] = useState('');
  const [batchReviewOpen, setBatchReviewOpen] = useState(false);

  const { data: baselines, isLoading } = useQuery<BaselineEntry[]>({
    queryKey: ['baselines'],
    queryFn: async () => {
      const res = await fetch('/api/baselines');
      if (!res.ok) throw new Error(tr('baselinesPage.failedToLoad', 'Failed to load baselines'));
      return res.json();
    },
    staleTime: 15_000,
  });

  const acceptAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/baselines/accept-all', { method: 'POST' });
      if (!res.ok) throw new Error(tr('baselinesPage.acceptAllFailed', 'Accept all failed'));
      return res.json();
    },
    onSuccess: (data: { accepted: number }) => {
      qc.invalidateQueries({ queryKey: ['baselines'] });
      toast.success(hasI18n
        ? t('baselinesPage.acceptedCount', { defaultValue: 'Accepted {{count}} baseline(s)', count: data.accepted })
        : `Accepted ${data.accepted} baseline(s)`);
    },
    onError: () => toast.error(tr('baselinesPage.failedToAcceptAll', 'Failed to accept all')),
  });

  const filtered = baselines?.filter((b) => {
    if (filter === 'changed') return b.hasActual || b.hasDiff;
    return true;
  }).filter((b) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return b.snapshotName.toLowerCase().includes(q) || b.testFile.toLowerCase().includes(q);
  }) ?? [];

  const changedBaselines = baselines?.filter((b) => b.hasActual || b.hasDiff) ?? [];
  const changedCount = changedBaselines.length;

  return (
    <FeatureGate flag="baseline-management" fallback={<FeatureDisabledPage feature="Baseline Management" />}>
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">
            {tr('baselinesPage.title', 'Baselines')}
          </h1>
          <p className="text-xs mt-0.5 text-text-tertiary">
            {tr('baselinesPage.subtitle', 'Manage screenshot baselines across all tests')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tr('baselinesPage.searchPlaceholder', 'Search baselines…')}
            className="px-3 py-1.5 text-sm rounded-md border border-border-default text-text-primary bg-transparent outline-none w-48"
          />

          {/* Filter */}
          <div className="flex items-center gap-1 rounded-lg border border-border-subtle p-0.5">
            {(['all', 'changed'] as const).map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors capitalize',
                  filter === f ? 'bg-running text-white' : 'bg-transparent text-text-secondary',
                )}
              >
                {f === 'changed'
                  ? (hasI18n ? t('baselinesPage.changedWithCount', { defaultValue: 'Changed ({{count}})', count: changedCount }) : `Changed (${changedCount})`)
                  : tr('baselinesPage.all', 'All')}
              </button>
            ))}
          </div>

          {/* Batch Review */}
          {changedCount > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setBatchReviewOpen(true)}
              icon={<Layers size={13} />}
              className="bg-running-bg text-running"
            >
              {hasI18n ? t('baselinesPage.batchReviewWithCount', { defaultValue: 'Batch Review ({{count}})', count: changedCount }) : `Batch Review (${changedCount})`}
            </Button>
          )}

          {/* Accept All */}
          {changedCount > 0 && (
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                toast.promise(acceptAllMutation.mutateAsync(), {
                  loading: tr('baselinesPage.acceptingAll', 'Accepting all…'),
                  success: tr('baselinesPage.allAccepted', 'All baselines accepted'),
                  error: tr('baselinesPage.failed', 'Failed'),
                })
              }
              loading={acceptAllMutation.isPending}
              icon={<CheckCheck size={13} />}
              className="!bg-pass"
            >
              {hasI18n ? t('baselinesPage.acceptAllWithCount', { defaultValue: 'Accept All ({{count}})', count: changedCount }) : `Accept All (${changedCount})`}
            </Button>
          )}

          {/* Refresh */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ['baselines'] })}
            aria-label={tr('baselinesPage.refreshAria', 'Refresh baselines')}
            className="!p-1.5"
          >
            <RefreshCw size={14} className="text-text-tertiary" />
          </Button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {BASELINE_SKELETON_KEYS.map((key) => (
            <Skeleton key={key} className="h-56 w-full rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={filter === 'changed'
            ? tr('baselinesPage.noChangedBaselines', 'No changed baselines')
            : tr('baselinesPage.noBaselinesFound', 'No baselines found')}
          description={
            filter === 'changed'
              ? tr('baselinesPage.allScreenshotsMatch', 'All screenshots match their baselines.')
              : tr('baselinesPage.runTestsToPopulate', 'Run tests with visual comparisons to populate this page.')
          }
        />
      ) : (
        <div className="space-y-6">
          {(() => {
            const groups = new Map<string, typeof filtered>();
            for (const b of filtered) {
              const list = groups.get(b.testFile) ?? [];
              list.push(b);
              groups.set(b.testFile, list);
            }
            return [...groups.entries()].map(([file, items]) => (
              <div key={file} className="space-y-3">
                <h3
                  className="text-xs font-mono font-medium px-1 truncate text-text-secondary"
                  title={file}
                >
                  {file}
                  <span className="ml-2 text-[10px] font-sans text-text-tertiary">
                    ({items.length})
                  </span>
                </h3>
                <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {items.map((baseline) => (
                    <BaselineCard key={baseline.id} baseline={baseline} />
                  ))}
                </div>
              </div>
            ));
          })()}
        </div>
      )}


      {/* Batch review modal */}
      <AnimatePresence>
        {batchReviewOpen && changedBaselines.length > 0 && (
          <Suspense fallback={null}>
            <BaselineBatchReview
              baselines={changedBaselines}
              onClose={() => setBatchReviewOpen(false)}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
    </FeatureGate>
  );
}
