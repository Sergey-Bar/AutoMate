import { createFileRoute } from '@tanstack/react-router';
import { useAgentSessions, type AgentSessionListItem } from '@/hooks/useAgentSessions';
import { useAgentConflicts } from '@/hooks/useAgentConflicts';
import { FeatureGate } from '@/components/FeatureGate';
import { FeatureDisabledPage } from '@/components/shared/FeatureDisabledPage';
import { EmptyState } from '@/components/shared/EmptyState';
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';
import { RunListSkeleton } from '@/components/shared/Skeleton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { RefreshCw, Github, Bot, Files, GitPullRequest, AlertTriangle } from 'lucide-react';
import { useMemo, useState, Fragment } from 'react';
import { timeAgo } from '@/lib/formatters';
import { useTranslation } from 'react-i18next';
import { ConflictMap } from './conflict-map';
import { RepairHistory } from '@/components/RepairHistory';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  getExpandedRowModel,
  type SortingState,
  type ExpandedState,
} from '@tanstack/react-table';

export const Route = createFileRoute('/agent-activity/')({
  component: AgentActivityPage,
});

const columnHelper = createColumnHelper<AgentSessionListItem>();

function AgentStatusChip({ status }: { status: AgentSessionListItem['status'] }) {
  const isError = status === 'error';
  const isActive = status === 'active';
  
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium capitalize border',
        isActive 
          ? 'bg-pass/10 text-pass border-pass/20' 
          : isError 
            ? 'bg-fail/10 text-fail border-fail/20'
            : 'bg-text-tertiary/10 text-text-secondary border-text-tertiary/20'
      )}
    >
      {status}
    </span>
  );
}

export function AgentActivityPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'sessions' | 'conflicts'>('sessions');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const { data: sessions, isLoading, error, refetch } = useAgentSessions(statusFilter);
  const { data: conflicts } = useAgentConflicts();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [expanded, setExpanded] = useState<ExpandedState>({});

  const columns = useMemo(() => [
    columnHelper.accessor('agentName', {
      header: 'Agent',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Bot size={14} className="text-text-tertiary" />
          <span className="font-medium text-xs">{row.original.agentName}</span>
        </div>
      ),
    }),
    columnHelper.accessor('repository', {
      header: 'Repository',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-xs text-text-secondary">
          <Github size={13} />
          {row.original.repository}
        </div>
      ),
    }),
    columnHelper.accessor('prNumber', {
      header: 'PR #',
      cell: ({ row }) => (
        <a
          href={`https://github.com/${row.original.repository}/pull/${row.original.prNumber}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-running hover:underline"
        >
          <GitPullRequest size={12} />
          #{row.original.prNumber}
        </a>
      ),
    }),
    columnHelper.accessor('prBranch', {
      header: 'Branch',
      cell: ({ row }) => (
        <span className="text-xs font-mono text-text-secondary bg-text-tertiary/10 px-1.5 py-0.5 rounded">
          {row.original.prBranch}
        </span>
      ),
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: ({ row }) => <AgentStatusChip status={row.original.status} />,
    }),
    columnHelper.accessor('fileCount', {
      header: 'Changed Files',
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5 text-xs text-text-secondary tabular-nums">
          <Files size={12} />
          {row.original.fileCount}
        </div>
      ),
    }),
    columnHelper.accessor('linkedRunCount', {
      header: 'Linked Runs',
      cell: ({ row }) => (
        <span className={cn('text-xs tabular-nums', row.original.linkedRunCount > 0 ? 'text-text-primary font-medium' : 'text-text-tertiary')}>
          {row.original.linkedRunCount}
        </span>
      ),
    }),
    columnHelper.accessor('updatedAt', {
      header: 'Last Updated',
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-text-tertiary">
          {timeAgo(row.original.updatedAt)}
        </span>
      ),
    }),
  ], []);

  const table = useReactTable({
    data: sessions ?? [],
    columns,
    state: { sorting, expanded },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
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
    <FeatureGate flag="agent-tracking" fallback={<FeatureDisabledPage feature="Agent Tracking" />}>
      <ErrorBoundary label="Agent Activity">
        <div className="p-6 max-w-7xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-text-primary">
                Agent Activity
              </h1>
              <p className="text-xs mt-0.5 text-text-tertiary">
                Track autonomous AI agent sessions and their pull requests
              </p>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="flex bg-black/20 p-1 rounded-lg border border-border-default mr-2">
                <button
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors", activeTab === 'sessions' ? "bg-bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}
                  onClick={() => setActiveTab('sessions')}
                >
                  Sessions
                </button>
                <button
                  className={cn("px-3 py-1 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5", activeTab === 'conflicts' ? "bg-bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary")}
                  onClick={() => setActiveTab('conflicts')}
                >
                  Conflicts
                  {conflicts && conflicts.length > 0 && (
                    <span className="bg-warning/20 text-warning px-1.5 py-0.5 rounded-full text-[10px] leading-none">
                      {conflicts.length}
                    </span>
                  )}
                </button>
              </div>

              {activeTab === 'sessions' && (
                <select
                  aria-label="Filter by status"
                  className="px-3 py-1.5 rounded-lg text-xs border border-border-default text-text-secondary bg-transparent outline-none"
                  value={statusFilter ?? ''}
                  onChange={(e) => setStatusFilter(e.target.value === '' ? undefined : e.target.value)}
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                  <option value="error">Error</option>
                </select>
              )}

              <Button
                variant="ghost"
                size="sm"
                onClick={() => refetch()}
                aria-label="Refresh agent sessions"
                className="!p-1.5"
              >
                <RefreshCw size={14} className="text-text-tertiary" />
              </Button>
            </div>
          </div>

          {activeTab === 'conflicts' ? (
            <ConflictMap />
          ) : isLoading ? (
            <RunListSkeleton />
          ) : error ? (
            <div className="p-4 rounded-lg bg-fail/10 border border-fail/20 text-sm text-fail">
              {error instanceof Error ? error.message : 'An error occurred'}
            </div>
          ) : sessions && sessions.length > 0 ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-border-default overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    {table.getHeaderGroups().map((headerGroup) => (
                      <tr key={headerGroup.id} className="bg-bg-surface border-b border-border-subtle">
                        {headerGroup.headers.map((header) => {
                          const canSort = header.column.getCanSort();
                          const sortState = header.column.getIsSorted();
                          const sortIcon = sortState === 'asc' ? ' ↑' : sortState === 'desc' ? ' ↓' : ' ↕';

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
                      <Fragment key={row.id}>
                        <tr
                          className="border-t border-border-subtle hover:bg-white/2 transition-colors cursor-pointer"
                          onClick={row.getToggleExpandedHandler()}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="px-4 py-2.5">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                        {row.getIsExpanded() && (
                          <tr className="border-t border-border-subtle bg-bg-base/50">
                            <td colSpan={row.getVisibleCells().length} className="px-4 py-4">
                              <RepairHistory sessionId={row.original.id} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
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
                </div>
              </div>
            </div>
          ) : (
            <EmptyState
              title="No AI agent PRs are being tracked yet"
              description="Agent sessions will appear here once an autonomous agent creates a pull request."
            />
          )}
        </div>
      </ErrorBoundary>
    </FeatureGate>
  );
}
