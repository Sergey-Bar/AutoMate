import { createLazyFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useRun, useRunTests, abortRun } from '@/hooks/useRun';
import { useLiveRun } from '@/hooks/useLiveRun';
import { useRunStore } from '@/store/runStore';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { ErrorAlert } from '@/components/shared/ErrorAlert';
import { EmptyState } from '@/components/shared/EmptyState';
import { RunStatusBadge } from '@/components/shared/StatusBadge';
import { TestListSkeleton } from '@/components/shared/Skeleton';
import { FilterBar } from '@/components/shared/FilterBar';
import { RunProgress } from '@/components/runs/RunProgress';
import { GateBadge } from '@/components/runs/GateBadge';
import { SourceBadge } from '@/components/runs/SourceBadge';
import { CIStatusBadge } from '@/components/runs/CIStatusBadge';
import { LiveTerminal } from '@/components/runs/LiveTerminal';
import { FailureFingerprints } from '@/components/runs/FailureFingerprints';
import { TestRow } from '@/components/tests/TestRow';
import { TestDetail } from '@/components/tests/TestDetail';
import { formatDuration, timeAgo, passRate, shortSha } from '@/lib/formatters';
import { panelSlideIn, safeMotion } from '@/lib/motion';
import type { TestWithResults, TestStatus } from '@/lib/types';
import { parseResult } from '@/lib/types';
import { useTest } from '@/hooks/useRun';
import { toast } from 'sonner';
import { ArrowLeft, StopCircle, Terminal as TerminalIcon, List, TreePine, Link2, Download, FileText } from 'lucide-react';
import { TestTree } from '@/components/tests/TestTree';
import { useQuery } from '@tanstack/react-query';
import { ErrorClustersSection } from '@/components/analytics/ErrorClusterCard';
import { cn } from '@/lib/utils';

export const Route = createLazyFileRoute('/runs/$runId')({
  component: RunDetailPage,
});

export function RunDetailPage() {
  const { runId } = Route.useParams();
  const { testId: testIdParam, tab: tabParam } = Route.useSearch();
  const navigate = useNavigate({ from: '/runs/$runId' });

  // ─── Data fetching ────────────────────────────────────────────────────
  const { data: run, isLoading: runLoading, error: runError, refetch: refetchRun } = useRun(runId);
  const { data: rawTests, isLoading: testsLoading, refetch: refetchTests } = useRunTests(runId);

  // ─── Error clusters (only when failures > 3) ─────────────────────────
  const { data: errorClusters } = useQuery<Array<{ clusterId: string; sampleError: string; sampleStack: string | null; testIds: string[]; count: number }>>({
    queryKey: ['error-clusters', runId],
    queryFn: () => fetch(`/api/analytics/error-clusters?runId=${runId}`).then(r => r.json()),
    enabled: !!run && (run.failed ?? 0) > 3,
    staleTime: 60_000,
  });

  // ─── Live updates ─────────────────────────────────────────────────────
  const { connectionState } = useLiveRun(runId);
  const liveRun = useRunStore((s) => s.run);
  const liveTests = useRunStore((s) => s.tests);

  // Re-fetch on WS reconnect
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.runId === runId) {
        refetchRun();
        refetchTests();
      }
    };
    window.addEventListener('ws:reconnected', handler);
    return () => window.removeEventListener('ws:reconnected', handler);
  }, [runId, refetchRun, refetchTests]);

  // ─── Merge live + static data ─────────────────────────────────────────
  const activeRun = liveRun?.status === 'running' ? { ...run, ...liveRun } : run;
  const isRunning = activeRun?.status === 'running';

  // Parse raw tests into TestWithResults shape
  const tests = useMemo<TestWithResults[]>(() => {
    const base = (rawTests ?? []).map((t) => {
      const liveUpdate = liveTests[t.id];
      const merged = liveUpdate ? { ...t, ...liveUpdate } : t;
      return {
        ...merged,
        tags: (() => { try { return JSON.parse(merged.tags as unknown as string ?? '[]'); } catch { return []; } })(),
        annotations: (() => { try { return JSON.parse(merged.annotations as unknown as string ?? '[]'); } catch { return []; } })(),
        retries: merged.retryCount ?? 0,
      } as TestWithResults;
    });
    return base;
  }, [rawTests, liveTests]);

  // ─── UI state ─────────────────────────────────────────────────────────
  const [selectedTestId, setSelectedTestId] = useState<string | null>(testIdParam ?? null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TestStatus[]>([]);
  const [tagFilter, setTagFilter] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'tree'>('list');
  const [showTerminal, setShowTerminal] = useState(false);

  const handleSelectTest = useCallback((id: string | null) => {
    setSelectedTestId(id);
    navigate({ search: (prev) => ({ ...prev, testId: id ?? undefined }) });
  }, [navigate]);
  // ─── Selected test detail data ────────────────────────────────────────
  const { data: testDetail } = useTest(runId, selectedTestId ?? '');
  const selectedTest = useMemo<TestWithResults | undefined>(() => {
    if (!testDetail) return tests.find((t) => t.id === selectedTestId);
    return {
      ...testDetail,
      tags: (() => { try { return JSON.parse(testDetail.tags as unknown as string ?? '[]'); } catch { return []; } })(),
      annotations: (() => { try { return JSON.parse(testDetail.annotations as unknown as string ?? '[]'); } catch { return []; } })(),
      retries: testDetail.retryCount ?? 0,
      results: testDetail.results?.map(parseResult),
    } as TestWithResults;
  }, [testDetail, tests, selectedTestId]);

  // ─── Filtered tests ──────────────────────────────────────────────────
  // Extract unique tags from run's tests
  const allRunTags = useMemo(() => {
    const set = new Set<string>();
    tests.forEach((t) => {
      (t.tags as string[]).forEach((tag) => set.add(tag));
    });
    return [...set].sort();
  }, [tests]);

  // ─── Filtered tests ──────────────────────────────────────────────────
  const filteredTests = useMemo(() => {
    let result = tests;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) => t.title.toLowerCase().includes(q) || t.file.toLowerCase().includes(q),
      );
    }
    if (statusFilter.length > 0) {
      result = result.filter((t) => statusFilter.includes(t.status));
    }
    if (tagFilter) {
      result = result.filter((t) => (t.tags as string[]).includes(tagFilter));
    }
    return result;
  }, [tests, search, statusFilter, tagFilter]);

  // ─── J/K/Escape keyboard navigation ──────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.contentEditable === 'true') return;

      const ids = filteredTests.map((t) => t.id);
      if (ids.length === 0) return;
      const currentIdx = selectedTestId ? ids.indexOf(selectedTestId) : -1;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, ids.length - 1);
        handleSelectTest(ids[next] ?? null);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        handleSelectTest(ids[prev] ?? null);
      } else if (e.key === 'Escape' && selectedTestId) {
        handleSelectTest(null);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [filteredTests, selectedTestId, handleSelectTest]);

  // ─── Abort handler ───────────────────────────────────────────────────
  const handleAbort = useCallback(async () => {
    try {
      await abortRun(runId);
      toast.success('Run aborted');
      refetchRun();
    } catch {
      toast.error('Failed to abort run');
    }
  }, [runId, refetchRun]);

  // ─── Loading / error states ──────────────────────────────────────────
  if (runLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <TestListSkeleton />
      </div>
    );
  }

  if (runError || !run) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <ErrorAlert error={runError ?? 'Run not found'} onRetry={() => refetchRun()} />
      </div>
    );
  }

  return (
    <ErrorBoundary label="Run Detail">
      <div className="flex flex-col h-full">
        {/* Progress bar */}
        {isRunning && (
          <RunProgress
            passed={activeRun?.passed ?? 0}
            failed={activeRun?.failed ?? 0}
            total={activeRun?.total ?? 0}
          />
        )}

        {/* Header */}
        <div
          className="px-6 py-4 border-b border-border-subtle shrink-0"
        >
          <div className="flex items-center gap-3 mb-2">
            <Link
              to="/runs"
              className="flex items-center gap-1 text-xs transition-colors text-text-tertiary"
            >
              <ArrowLeft size={14} />
              Runs
            </Link>
            <span className="text-xs text-text-tertiary">/</span>
            <span className="font-mono text-xs text-text-secondary">
              {runId.slice(0, 8)}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RunStatusBadge status={activeRun?.status ?? run.status} />
              <GateBadge gateStatus={run?.gateStatus} />
              <SourceBadge source={run?.source} />
              <CIStatusBadge commitSha={run?.commitSha} />
              <div>
                <h1
                  className="text-lg font-semibold text-text-primary"
                >
                  Run {runId.slice(0, 8)}
                </h1>
                <div className="flex items-center gap-3 mt-0.5 text-xs text-text-tertiary">
                  <span>{timeAgo(run.startedAt)}</span>
                  {run.branch && <span>branch: {run.branch}</span>}
                  {run.commitSha && <span>commit: {shortSha(run.commitSha)}</span>}
                  <span>{formatDuration(activeRun?.durationMs ?? run.durationMs)}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Connection indicator */}
              {isRunning && (
                <span
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-full border',
                    connectionState === 'connected'
                      ? 'text-pass border-pass'
                      : 'text-text-tertiary border-border-subtle',
                  )}
                >
                  {connectionState === 'connected' ? '● Live' : connectionState}
                </span>
              )}

              {/* Export CSV */}
              <a
                href={`/api/runs/${runId}/tests/export.csv`}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary transition-colors"
                title="Export test results as CSV"
              >
                <Download size={13} />
                Export CSV
              </a>

              {/* Export HTML Report */}
              <a
                href={`/api/runs/${runId}/report.html`}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary transition-colors"
                title="Export run as HTML report"
              >
                <FileText size={13} />
                Export HTML
              </a>

              {/* Export PDF Report */}
              <a
                href={`/api/runs/${runId}/report.pdf`}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary transition-colors"
                title="Export run as PDF report"
              >
                <FileText size={13} />
                Export PDF
              </a>

              {/* Copy run permalink */}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/runs/${runId}`);
                  toast.success('Run link copied');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary bg-transparent transition-colors"
                title="Copy permalink"
                aria-label="Copy run permalink"
              >
                <Link2 size={13} />
                Copy link
              </button>

              {/* Terminal toggle */}
              <button
                onClick={() => setShowTerminal(!showTerminal)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border text-text-secondary transition-colors',
                  showTerminal ? 'border-border-focus bg-bg-elevated' : 'border-border-default bg-transparent',
                )}
                aria-label={showTerminal ? 'Hide terminal' : 'Show terminal'}
              >
                <TerminalIcon size={13} />
                Terminal
              </button>

              {/* Abort button */}
              {isRunning && (
                <button
                  onClick={handleAbort}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-opacity hover:opacity-80 bg-fail text-white"
                  aria-label="Abort run"
                >
                  <StopCircle size={13} />
                  Abort
                </button>
              )}
            </div>
          </div>

          {/* KPI row */}
          <div className="flex items-center gap-4 mt-3">
            <KpiPill label="Total" value={String(activeRun?.total ?? run.total)} />
            <KpiPill label="Passed" value={String(activeRun?.passed ?? run.passed)} colorClass="text-pass" />
            <KpiPill label="Failed" value={String(activeRun?.failed ?? run.failed)} colorClass={run.failed > 0 ? 'text-fail' : undefined} />
            <KpiPill label="Flaky" value={String(activeRun?.flaky ?? run.flaky)} colorClass={run.flaky > 0 ? 'text-flaky' : undefined} />
            <KpiPill label="Skipped" value={String(activeRun?.skipped ?? run.skipped)} />
            <KpiPill label="Pass Rate" value={passRate(activeRun?.passed ?? run.passed, activeRun?.total ?? run.total)} />
          </div>
        </div>

        {/* Failure fingerprint grouping — only when there are failures */}
        {(activeRun?.failed ?? run.failed) > 0 && (
          <FailureFingerprints
            runId={runId}
            tests={tests}
            onSelectTest={handleSelectTest}
          />
        )}

        {/* Error clusters — only when there are enough failures */}
        {(activeRun?.failed ?? run.failed) > 3 && (
          <ErrorClustersSection clusters={errorClusters ?? []} />
        )}


        {/* Main content area */}
        <div className="flex-1 flex min-h-0">
          {/* Left panel: test list */}
          <div
            className="flex flex-col border-r border-border-subtle"
            style={{
              width: selectedTest ? '40%' : '100%',
              minWidth: selectedTest ? 320 : undefined,
              transition: 'width 0.2s',
            }}
          >
            {/* Filter bar + view mode toggle */}
            <div className="flex items-center">
              <div className="flex-1">
                <FilterBar
                  search={search}
                  onSearch={setSearch}
                  statusFilter={statusFilter}
                  onStatusFilter={setStatusFilter}
                  tagFilter={tagFilter}
                  onTagFilter={setTagFilter}
                  tags={allRunTags}
                />
              </div>
              <div className="flex items-center gap-1 px-3">
                <button
                  onClick={() => setViewMode('list')}
                  className={cn(
                    'p-1 rounded transition-colors text-text-tertiary',
                    viewMode === 'list' ? 'bg-bg-elevated' : 'bg-transparent',
                  )}
                  title="List view"
                  aria-label="List view"
                >
                  <List size={14} />
                </button>
                <button
                  onClick={() => setViewMode('tree')}
                  className={cn(
                    'p-1 rounded transition-colors text-text-tertiary',
                    viewMode === 'tree' ? 'bg-bg-elevated' : 'bg-transparent',
                  )}
                  title="Tree view"
                  aria-label="Tree view"
                >
                  <TreePine size={14} />
                </button>
              </div>
            </div>

            {/* Test list / tree */}
            <div className="flex-1 overflow-auto">
              {testsLoading ? (
                <TestListSkeleton />
              ) : filteredTests.length === 0 ? (
                <EmptyState
                  illustration={tests.length > 0 ? 'search' : 'inbox'}
                  title="No tests found"
                  description={
                    tests.length > 0
                      ? 'Try adjusting your filters.'
                      : isRunning
                        ? 'Tests will appear as they execute.'
                        : 'No tests were recorded for this run.'
                  }
                />
              ) : viewMode === 'tree' ? (
                <TestTree
                  tests={filteredTests}
                  selectedId={selectedTestId ?? undefined}
                  onSelect={(t) => handleSelectTest(t.id)}
                  height={600}
                />
              ) : (
                <div className="p-2 space-y-0.5">
                  {filteredTests.map((test) => (
                    <TestRow
                      key={test.id}
                      test={test}
                      isSelected={test.id === selectedTestId}
                      onClick={() => handleSelectTest(test.id === selectedTestId ? null : test.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right panel: test detail */}
          <AnimatePresence mode="wait">
            {selectedTest && (
              <motion.div
                key={selectedTest.id}
                className="flex-1 min-w-0"
                variants={safeMotion(panelSlideIn) as import('framer-motion').Variants}
                initial="hidden"
                animate="visible"
                exit="exit"
              >
                <TestDetail
                  test={selectedTest}
                  runId={runId}
                  initialTab={tabParam}
                  onTabChange={(t) => navigate({ search: (prev) => ({ ...prev, tab: t }) })}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Terminal panel */}
        <AnimatePresence>
          {showTerminal && (
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: 260 }}
              exit={{ height: 0 }}
              className="shrink-0 overflow-hidden border-t border-border-subtle"
            >
              <LiveTerminal />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ErrorBoundary>
  );
}

/* ─── Small KPI pill for run header ──────────────────────────────────── */

function KpiPill({ label, value, colorClass }: { label: string; value: string; colorClass?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-text-tertiary">
        {label}
      </span>
      <span
        className={cn('text-sm font-semibold tabular', colorClass ?? 'text-text-primary')}
      >
        {value}
      </span>
    </div>
  );
}
