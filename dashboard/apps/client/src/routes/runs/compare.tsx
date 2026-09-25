import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { useMemo } from 'react';
import { useRun, useRunCompare } from '@/hooks/useRun';
import { RunComparePicker } from '@/components/runs/RunComparePicker';
import { CompareTable } from '@/components/runs/CompareTable';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { FeatureGate } from '@/components/FeatureGate';
import { FeatureDisabledPage } from '@/components/shared/FeatureDisabledPage';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CompareRow } from '@/lib/types';
import { useTranslation } from 'react-i18next';

export const Route = createFileRoute('/runs/compare')({
  validateSearch: z.object({
    a: z.string().optional(),
    b: z.string().optional(),
    changedOnly: z.boolean().optional().default(false),
  }),
  component: CompareRunsPage,
});

export function CompareRunsPage() {
  const { t, i18n } = useTranslation();
  const hasI18n = Boolean(i18n);
  const tr = (key: string, fallback: string) => (hasI18n ? t(key, { defaultValue: fallback }) : fallback);
  const { a, b, changedOnly } = Route.useSearch();
  const navigate = Route.useNavigate();

  const runIdA = a ?? null;
  const runIdB = b ?? null;

  const { data: rows = [], isLoading } = useRunCompare(runIdA, runIdB);
  const { data: runA } = useRun(runIdA ?? '');
  const { data: runB } = useRun(runIdB ?? '');

  const visibleRows = useMemo(
    () => changedOnly ? rows.filter((r: CompareRow) => r.changeType !== 'unchanged') : rows,
    [rows, changedOnly]
  );

  function exportCsv() {
    const header = 'Test,File,Status A,Status B,Duration A (ms),Duration B (ms),Change\n';
    const csv = rows.map((r: CompareRow) =>
      `"${r.title}","${r.file}",${r.statusA ?? ''},${r.statusB ?? ''},${r.durationA ?? ''},${r.durationB ?? ''},${r.changeType}`
    ).join('\n');
    const blob = new Blob([header + csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'run-comparison.csv'; anchor.click();
    URL.revokeObjectURL(url);
  }

  const newFailures = rows.filter((r: CompareRow) => r.changeType === 'new_failure').length;
  const fixedCount = rows.filter((r: CompareRow) => r.changeType === 'fixed').length;
  const regressions = rows.filter((r: CompareRow) => r.changeType === 'regression').length;
  const unchanged = rows.filter((r: CompareRow) => r.changeType === 'unchanged').length;
  const passRateA = runA && runA.total > 0 ? Math.round((runA.passed / runA.total) * 100) : null;
  const passRateB = runB && runB.total > 0 ? Math.round((runB.passed / runB.total) * 100) : null;

  return (
    <FeatureGate flag="run-comparison" fallback={<FeatureDisabledPage feature="Run Comparison" />}>
      <ErrorBoundary label={tr('comparePage.errorBoundaryLabel', 'Compare Runs')}>
      <div className="p-6 max-w-7xl mx-auto space-y-4">
        <h1 className="text-xl font-semibold text-text-primary">
          {tr('comparePage.title', 'Compare Runs')}
        </h1>

        {/* Pickers */}
        <div className="flex flex-col sm:flex-row items-center gap-4 flex-wrap">
          <RunComparePicker
            label={tr('comparePage.runA', 'Run A')}
            selectedRunId={runIdA}
            onSelect={(id) => navigate({ search: (prev) => ({ ...prev, a: id ?? undefined }) })}
          />
          <span className="text-sm text-text-tertiary">{tr('comparePage.vs', 'vs')}</span>
          <RunComparePicker
            label={tr('comparePage.runB', 'Run B')}
            selectedRunId={runIdB}
            onSelect={(id) => navigate({ search: (prev) => ({ ...prev, b: id ?? undefined }) })}
          />

          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer text-text-secondary">
              <input
                type="checkbox"
                checked={changedOnly}
                onChange={(e) => navigate({ search: (prev) => ({ ...prev, changedOnly: e.target.checked }) })}
                className="accent-running"
              />
              {tr('comparePage.changedOnly', 'Changed only')}
            </label>
            <button
              type="button"
              onClick={exportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary transition-colors"
            >
              <Download size={13} />
              {tr('runs.exportCsv', 'Export CSV')}
            </button>
          </div>
        </div>

        {/* Summary bar */}
        {runIdA && runIdB && rows.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap p-3 rounded-lg bg-surface-2 border border-border-default">
            {passRateA !== null && passRateB !== null && (
              <>
                <span className="text-xs text-text-secondary">
                  {tr('comparePage.passRate', 'Pass rate:')}{' '}
                  <strong className="text-text-primary">{passRateA}%</strong>
                  {' → '}
                  <strong className={cn(passRateB >= passRateA ? 'text-pass' : 'text-fail')}>{passRateB}%</strong>
                </span>
                <span className="text-border-default">|</span>
              </>
            )}
            {newFailures > 0 && (
              <span className="text-xs px-2 py-0.5 rounded font-medium text-fail" style={{ background: 'color-mix(in oklch, var(--color-fail) 15%, transparent)' }}>
                {hasI18n
                  ? t('comparePage.newFailures', { count: newFailures, defaultValue: '{{count}} new failures' })
                  : `${newFailures} new failure${newFailures === 1 ? '' : 's'}`}
              </span>
            )}
            {fixedCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded font-medium text-pass" style={{ background: 'color-mix(in oklch, var(--color-pass) 15%, transparent)' }}>
                {hasI18n ? t('comparePage.fixed', { count: fixedCount, defaultValue: '{{count}} fixed' }) : `${fixedCount} fixed`}
              </span>
            )}
            {regressions > 0 && (
              <span className="text-xs px-2 py-0.5 rounded font-medium text-flaky" style={{ background: 'color-mix(in oklch, var(--color-flaky) 15%, transparent)' }}>
                {hasI18n
                  ? t('comparePage.regressions', { count: regressions, defaultValue: '{{count}} regressions' })
                  : `${regressions} regression${regressions === 1 ? '' : 's'}`}
              </span>
            )}
            <span className="text-xs text-text-tertiary">{hasI18n ? t('comparePage.unchanged', { count: unchanged, defaultValue: '{{count}} unchanged' }) : `${unchanged} unchanged`}</span>
          </div>
        )}

        {/* Loading state */}
        {isLoading && runIdA && runIdB && (
          <div className="text-sm py-4 text-text-tertiary">{tr('comparePage.loadingComparison', 'Loading comparison…')}</div>
        )}

        {/* Comparison table */}
        <CompareTable rows={visibleRows} changedOnly={changedOnly} />
      </div>
      </ErrorBoundary>
    </FeatureGate>
  );
}
