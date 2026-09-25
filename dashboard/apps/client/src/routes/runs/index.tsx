import { createFileRoute, Link } from '@tanstack/react-router';
import { useRuns } from '@/hooks/useRun';
import { RunStatusBadge } from '@/components/shared/StatusBadge';
import { formatDuration, timeAgo } from '@/lib/formatters';
import { useMemo, useState } from 'react';
import { RunTrigger } from '@/components/runs/RunTrigger';
import { GateBadge } from '@/components/runs/GateBadge';
import { SourceBadge } from '@/components/runs/SourceBadge';
import { Download } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { RunListSkeleton } from '@/components/shared/Skeleton';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { Run } from '@/lib/types';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';

const columnHelper = createColumnHelper<Run>();

export const Route = createFileRoute('/runs/')({
  component: RunsPage,
});

export function RunsPage() {
  const { t } = useTranslation();
  const { data: runs, isLoading } = useRuns();
  const [triggerOpen, setTriggerOpen] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [columnsOpen, setColumnsOpen] = useState(false);

  const columns = useMemo(() => [
    columnHelper.accessor('status', {
      header: 'Status',
      enableSorting: false,
      cell: ({ row }) => <RunStatusBadge status={row.original.status} />,
    }),
    columnHelper.accessor('gateStatus', {
      header: 'Gate',
      cell: ({ row }) => <GateBadge gateStatus={row.original.gateStatus} />,
      sortingFn: 'alphanumeric',
    }),
    columnHelper.accessor('source', {
      header: 'Source',
      cell: ({ row }) => <SourceBadge source={row.original.source} />,
      sortingFn: 'alphanumeric',
    }),
    columnHelper.accessor('id', {
      header: 'Run ID',
      enableSorting: false,
      cell: ({ row }) => (
        <Link
          to="/runs/$runId"
          params={{ runId: row.original.id }}
          className="font-mono text-xs hover:underline text-running"
        >
          {row.original.id.slice(0, 8)}
        </Link>
      ),
    }),
    columnHelper.accessor('branch', {
      header: 'Branch',
      sortingFn: 'alphanumeric',
      cell: ({ row }) => (
        <span className="text-xs text-text-secondary">
          {row.original.branch ?? '—'}
        </span>
      ),
    }),
    columnHelper.accessor('commitSha', {
      header: 'Commit',
      sortingFn: 'alphanumeric',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-text-secondary">
          {row.original.commitSha ? row.original.commitSha.slice(0, 7) : '—'}
        </span>
      ),
    }),
    columnHelper.accessor('total', {
      header: 'Total',
      sortDescFirst: false,
      cell: ({ row }) => <span className="tabular text-xs">{row.original.total}</span>,
    }),
    columnHelper.accessor('passed', {
      header: 'Passed',
      sortDescFirst: false,
      cell: ({ row }) => (
        <span className="tabular text-xs text-pass">
          {row.original.passed}
        </span>
      ),
    }),
    columnHelper.accessor('failed', {
      header: 'Failed',
      sortDescFirst: false,
      cell: ({ row }) => (
        <span className={cn('tabular text-xs', row.original.failed > 0 ? 'text-fail' : '')}>
          {row.original.failed}
        </span>
      ),
    }),
    columnHelper.accessor('flaky', {
      header: 'Flaky',
      sortDescFirst: false,
      cell: ({ row }) => (
        <span className={cn('tabular text-xs', row.original.flaky > 0 ? 'text-flaky' : '')}>
          {row.original.flaky}
        </span>
      ),
    }),
    columnHelper.accessor((row) => row.durationMs ?? -1, {
      id: 'durationMs',
      header: 'Duration',
      sortDescFirst: false,
      cell: ({ row }) => <span className="tabular text-xs">{formatDuration(row.original.durationMs)}</span>,
    }),
    columnHelper.accessor('startedAt', {
      header: 'Started',
      sortDescFirst: false,
      cell: ({ row }) => (
        <span className="text-xs tabular text-text-tertiary">
          {timeAgo(row.original.startedAt)}
        </span>
      ),
    }),
  ], []);

  const table = useReactTable({
    data: runs ?? [],
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 20 },
    },
  });

  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  const pageButtons = Array.from({ length: pageCount }, (_, index) => index);

  return (
    <ErrorBoundary label="Runs">
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text-primary">
          {t('runs.title')}
        </h1>
        <div className="flex items-center gap-2">
          <a
            href="/api/runs/export.csv"
            download
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary transition-colors"
          >
            <Download size={13} />
            {t('runs.exportCsv')}
          </a>
          <Button
            variant="primary"
            size="md"
            onClick={() => setTriggerOpen(true)}
          >
            + {t('runs.newRun')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <RunListSkeleton />
      ) : runs && runs.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-text-tertiary">
              {runs.length} runs
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setColumnsOpen((value) => !value)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium border border-border-default text-text-secondary"
              >
                Columns
              </button>
              {columnsOpen && (
                <div
                  className="absolute right-0 mt-2 w-44 rounded-lg border border-border-default bg-bg-elevated p-2 z-10"
                >
                  {table.getAllLeafColumns().map((column) => (
                    <label key={column.id} className="flex items-center gap-2 px-2 py-1 text-xs text-text-secondary">
                      <input
                        type="checkbox"
                        checked={column.getIsVisible()}
                        onChange={column.getToggleVisibilityHandler()}
                      />
                      {String(column.columnDef.header)}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-border-default overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="bg-bg-surface border-b border-border-subtle">
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sortState = header.column.getIsSorted();
                      const sortIcon = sortState === 'asc' ? ' ▲' : sortState === 'desc' ? ' ▼' : ' ↕';

                      return (
                        <th
                          key={header.id}
                          scope="col"
                          className="text-left px-4 py-2 text-[11px] font-medium text-text-tertiary"
                        >
                          {header.isPlaceholder ? null : (
                            <button
                              type="button"
                              onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                              className="inline-flex items-center gap-1"
                              style={{ cursor: canSort ? 'pointer' : 'default' }}
                            >
                              {flexRender(header.column.columnDef.header, header.getContext())}
                              {canSort ? <span aria-hidden="true">{sortIcon}</span> : null}
                            </button>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-border-subtle hover:bg-white/2 transition-colors"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <div className="text-xs text-text-tertiary">
              Page {pageCount === 0 ? 0 : pageIndex + 1} of {pageCount}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage()}
              >
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {pageButtons.map((page) => (
                  <button
                    key={page}
                    type="button"
                    className={cn(
                      'w-7 h-7 rounded text-xs border border-border-default',
                      page === pageIndex ? 'text-text-primary bg-bg-surface' : 'text-text-secondary bg-transparent',
                    )}
                    onClick={() => table.setPageIndex(page)}
                  >
                    {page + 1}
                  </button>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage()}
              >
                Next
              </Button>
              <select
                aria-label="Rows per page"
                className="px-2 py-1.5 rounded-lg text-xs border border-border-default text-text-secondary bg-transparent"
                value={table.getState().pagination.pageSize}
                onChange={(event) => table.setPageSize(Number(event.target.value))}
              >
                {[10, 20, 50].map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          title={t('runs.noRuns')}
          description={t('runs.noRunsDesc')}
          cta={t('runs.newRun')}
          onCta={() => setTriggerOpen(true)}
        />
      )}

      {triggerOpen && <RunTrigger onClose={() => setTriggerOpen(false)} />}
    </div>
    </ErrorBoundary>
  );
}
