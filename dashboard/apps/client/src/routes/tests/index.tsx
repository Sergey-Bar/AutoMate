import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRunTests, useRuns, useTest } from '@/hooks/useRun';
import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { FilterBar } from '@/components/shared/FilterBar';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { TestListSkeleton } from '@/components/shared/Skeleton';
import { BulkActionBar } from '@/components/tests/BulkActionBar';
import { TestDetail } from '@/components/tests/TestDetail';
import { QuarantineButton } from '@/components/tests/QuarantineButton';
import { KnownFailureBadge } from '@/components/tests/KnownFailureBadge';
import { formatDuration } from '@/lib/formatters';
import { HistoryDotsDisplay } from '@/components/tests/TestHistoryTimeline';
import { parseResult } from '@/lib/types';
import type { TestStatus, TestWithResults } from '@/lib/types';
import { z } from 'zod';
import { useDebounce } from '@/hooks/useDebounce';
import { useTranslation } from 'react-i18next';
import { showToast } from '@/lib/showToast';
import { panelSlideIn, safeMotion } from '@/lib/motion';
import { Search } from 'lucide-react';

const testSearchSchema = z.object({
  search: z.string().optional().catch(''),
  status: z.string().optional().catch(''),
  tag: z.string().optional().catch(''),
});

export const Route = createFileRoute('/tests/')({
  component: TestExplorerPage,
  validateSearch: testSearchSchema,
});

function TestExplorerPage() {
  const { t } = useTranslation();
  const { data: runs } = useRuns();
  const latestRunId = runs?.[0]?.id;
  const { data: tests, isLoading } = useRunTests(latestRunId ?? '');
  const navigate = useNavigate({ from: '/tests/' });
  const { search: searchParam, status: statusParam, tag: tagParam } = Route.useSearch();

  const search = searchParam ?? '';
  const statusFilter: TestStatus[] = useMemo(
    () => (statusParam ? (statusParam.split(',').filter(Boolean) as TestStatus[]) : []),
    [statusParam],
  );
  const tagFilter = tagParam ?? '';

  // Local controlled input value — debounced before writing to URL (VALID-05)
  const [inputValue, setInputValue] = useState(search);
  const debouncedSearch = useDebounce(inputValue, 150);

  // Sync URL → local input (e.g. browser back/forward navigation)
  useEffect(() => {
    setInputValue(search);
  }, [search]);

  // Sync debounced value → URL (avoids keystroke-per-navigate)
  useEffect(() => {
    if (debouncedSearch !== search) {
      navigate({ search: (prev) => ({ ...prev, search: debouncedSearch || undefined }) });
    }
  }, [debouncedSearch, navigate, search]);

  const setStatusFilter = (val: TestStatus[]) => {
    navigate({ search: (prev) => ({ ...prev, status: val.length ? val.join(',') : undefined }) });
  };

  const setTagFilter = (val: string) => {
    navigate({ search: (prev) => ({ ...prev, tag: val || undefined }) });
  };

  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);

  // Fetch full test detail (with results) for the selected test
  const { data: testDetailData } = useTest(latestRunId ?? '', selectedTestId ?? '');
  const selectedTest = useMemo<TestWithResults | undefined>(() => {
    if (!testDetailData) return undefined;
    return {
      ...testDetailData,
      tags: (() => { try { return JSON.parse(testDetailData.tags as unknown as string ?? '[]'); } catch { return []; } })(),
      annotations: (() => { try { return JSON.parse(testDetailData.annotations as unknown as string ?? '[]'); } catch { return []; } })(),
      retries: testDetailData.retryCount ?? 0,
      results: testDetailData.results?.map(parseResult),
    } as TestWithResults;
  }, [testDetailData]);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const toggleCheck = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCheckedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  // Extract unique tags from loaded tests
  const allTags = useMemo(() => {
    const set = new Set<string>();
    (tests ?? []).forEach((t) => {
      const parsed: string[] = (() => { try { return JSON.parse((t.tags as unknown as string) ?? '[]'); } catch { return []; } })();
      parsed.forEach((tag) => {
        set.add(tag);
      });
    });
    return [...set].sort();
  }, [tests]);

  const filtered = useMemo(() => {
    return tests?.filter((t) => {
      if (statusFilter.length > 0 && !statusFilter.includes(t.status)) return false;
      if (tagFilter) {
        const testTags: string[] = (() => { try { return JSON.parse((t.tags as unknown as string) ?? '[]'); } catch { return []; } })();
        if (!testTags.includes(tagFilter)) return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        return t.title.toLowerCase().includes(q) || t.file.toLowerCase().includes(q);
      }
      return true;
    }) ?? [];
  }, [search, statusFilter, tagFilter, tests]);

  // Get selected test basic info for action buttons
  const selectedTestBasic = filtered.find((t) => t.id === selectedTestId);

  // Batch-fetch test history dots (avoids N+1 queries)
  const stableIds = useMemo(
    () => [...new Set(filtered.map((t) => t.stableId).filter((s): s is string => s !== null))].sort(),
    [filtered],
  );
  const { data: historyMap } = useQuery<Record<string, Array<{ status: string }>>>({
    queryKey: ['test-history-batch', stableIds],
    queryFn: async () => {
      const res = await fetch('/api/tests/history/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stableIds }),
      });
      return res.json();
    },
    enabled: stableIds.length > 0,
    staleTime: 60_000,
  });

  const checkedTitles = filtered.filter((t) => checkedIds.has(t.id)).map((t) => t.title);

  // J/K keyboard navigation
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const ids = filtered.map((t) => t.id);
      const currentIdx = selectedTestId ? ids.indexOf(selectedTestId) : -1;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, ids.length - 1);
        setSelectedTestId(ids[next] ?? null);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        setSelectedTestId(ids[prev] ?? null);
      } else if (e.key === 'Enter' && selectedTestId) {
        // placeholder: open detail for selected test
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filtered, selectedTestId]);

  return (
    <ErrorBoundary label="Test Explorer">
    <div className="flex h-full overflow-hidden">
      {/* Left: test list */}
      <div className="flex flex-col flex-1 min-w-0 border-r border-border-subtle overflow-hidden">
        <div
          className="px-4 py-3 border-b border-border-subtle shrink-0 bg-bg-surface"
        >
          <h1 className="text-sm font-semibold mb-3 text-text-primary">
            {t('tests.title')}
          </h1>
          <FilterBar
            search={inputValue}
            onSearch={setInputValue}
            statusFilter={statusFilter}
            onStatusFilter={setStatusFilter}
            tagFilter={tagFilter}
            onTagFilter={setTagFilter}
            tags={allTags}
          />
        </div>

        <div className="flex-1 overflow-y-auto" ref={listRef} role="listbox" aria-label="Test list" aria-busy={isLoading}>
          {isLoading ? (
            <TestListSkeleton />
          ) : filtered.length > 0 ? (
            filtered.map((test) => (
              <button
                type="button"
                key={test.id}
                className="flex items-center gap-3 px-4 py-2.5 border-b border-border-subtle cursor-pointer hover:bg-white/2 transition-colors"
                style={{
                  background: selectedTestId === test.id ? 'oklch(0.68 0.19 250 / 5%)' : checkedIds.has(test.id) ? 'oklch(0.68 0.19 250 / 3%)' : undefined,
                }}
                onClick={() => setSelectedTestId(test.id)}
              >
                <input
                  type="checkbox"
                  checked={checkedIds.has(test.id)}
                  onClick={(e) => toggleCheck(test.id, e)}
                  onChange={() => {}}
                  className="w-3.5 h-3.5 rounded border shrink-0 accent-running"
                  aria-label={`Select ${test.title}`}
                />
                <StatusBadge status={test.status} showLabel={false} size={8} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate text-text-primary">
                    {test.title}
                  </p>
                  <p className="text-[11px] truncate text-text-tertiary">
                    {test.file}
                  </p>
                </div>
                <span className="text-[11px] tabular shrink-0 text-text-tertiary">
                  {formatDuration(test.durationMs)}
                </span>
                {test.stableId && historyMap?.[test.stableId] && (
                  <HistoryDotsDisplay dots={historyMap[test.stableId]!} />
                )}
                {(() => {
                  const testTags: string[] = (() => { try { return JSON.parse((test.tags as unknown as string) ?? '[]'); } catch { return []; } })();
                  return testTags.length > 0 ? (
                    <div className="flex items-center gap-1 shrink-0">
                      {testTags.slice(0, 2).map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded-full border border-border-default text-text-tertiary bg-bg-elevated"
                        >
                          {tag}
                        </span>
                      ))}
                      {testTags.length > 2 && (
                        <span className="text-[10px] text-text-tertiary">
                          +{testTags.length - 2}
                        </span>
                      )}
                    </div>
                  ) : null;
                })()}
              </button>
            ))
          ) : (
            <div className="p-4">
              <EmptyState
                illustration={tests && tests.length > 0 ? 'search' : 'radar'}
                title={tests && tests.length > 0 ? t('tests.noMatchFilters') : t('tests.noTests')}
                description={tests && tests.length > 0 ? t('tests.adjustFilters') : t('tests.runTestsFirst')}
                cta={tests && tests.length > 0 ? t('tests.clearFilters') : undefined}
                onCta={tests && tests.length > 0 ? () => { setInputValue(''); setStatusFilter([]); setTagFilter(''); } : undefined}
              />
            </div>
          )}
        </div>
      </div>

      {/* Right: test detail panel */}
      <div
        className="shrink-0 flex flex-col overflow-hidden border-l border-border-subtle bg-bg-surface"
        style={{
          width: selectedTestId ? 420 : 320,
          transition: 'width 0.2s ease',
        }}
      >
        <AnimatePresence mode="wait">
          {selectedTestId && selectedTest ? (
            <motion.div
              key={selectedTest.id}
              className="flex-1 min-h-0 flex flex-col overflow-hidden"
              variants={safeMotion(panelSlideIn) as import('framer-motion').Variants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >
              {/* Action buttons */}
              <div
                className="flex items-center gap-1.5 px-3 py-2 border-b border-border-subtle shrink-0"
              >
                {selectedTestBasic && (
                  <>
                    <QuarantineButton testTitle={selectedTestBasic.title} testFile={selectedTestBasic.file} />
                    <KnownFailureBadge testTitle={selectedTestBasic.title} testFile={selectedTestBasic.file} />
                  </>
                )}
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <TestDetail
                  test={selectedTest}
                  runId={latestRunId}
                />
              </div>
            </motion.div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-text-tertiary">
              <Search size={32} strokeWidth={1} />
              <p className="text-sm text-center">Select a test to view details</p>
              <p className="text-xs text-center opacity-60">Click a test from the list or use J/K to navigate</p>
            </div>
          )}
        </AnimatePresence>
    </div>
    </div>

    {/* Bulk action bar */}
    <AnimatePresence>
      {checkedIds.size > 0 && (
        <BulkActionBar
          count={checkedIds.size}
          titles={checkedTitles}
          onRerun={() => {
            const grepPattern = checkedTitles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            fetch('/api/runs/trigger', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ grep: grepPattern }),
            }).then(() => showToast(`Re-running ${checkedTitles.length} test(s)`)).catch(() => showToast('Failed to start re-run', 'error'));
          }}
          onCopy={() => {
            navigator.clipboard.writeText(checkedTitles.join('\n'));
            showToast('Copied to clipboard');
          }}
          onExportGrep={() => {
            const pattern = checkedTitles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            navigator.clipboard.writeText(`--grep "${pattern}"`);
            showToast(`Exported grep pattern for ${checkedTitles.length} test(s)`);
          }}
          onClear={() => setCheckedIds(new Set())}
        />
      )}
    </AnimatePresence>
    </ErrorBoundary>
  );
}
