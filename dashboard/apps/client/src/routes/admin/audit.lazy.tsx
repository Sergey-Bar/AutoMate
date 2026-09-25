import { createLazyFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, Search, Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';

export const Route = createLazyFileRoute('/admin/audit')({
  component: AuditPage,
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface AuditEvent {
  id: string;
  timestamp: string;
  actorId: string;
  actorType: 'user' | 'system' | 'service';
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  details: string | null;
}

// ─── Known action types for filter dropdown ────────────────────────────────────

const ACTION_OPTIONS = [
  { value: '', label: 'All actions' },
  { value: 'auth.login', label: 'auth.login' },
  { value: 'auth.logout', label: 'auth.logout' },
  { value: 'key.create', label: 'key.create' },
  { value: 'key.revoke', label: 'key.revoke' },
  { value: 'quarantine.add', label: 'quarantine.add' },
  { value: 'quarantine.remove', label: 'quarantine.remove' },
  { value: 'gate.update', label: 'gate.update' },
  { value: 'user.create', label: 'user.create' },
  { value: 'user.update', label: 'user.update' },
  { value: 'user.delete', label: 'user.delete' },
  { value: 'settings.update', label: 'settings.update' },
  { value: 'mcp.tool_call', label: 'mcp.tool_call' },
];

const PAGE_SIZE_OPTIONS = [25, 50, 100];

// ─── CSV export ────────────────────────────────────────────────────────────────

function exportToCsv(events: AuditEvent[]): void {
  const headers = ['Timestamp', 'Actor', 'Actor Type', 'Action', 'Resource Type', 'Resource ID', 'IP'];
  const rows = events.map((e) => [
    e.timestamp,
    e.actorId,
    e.actorType,
    e.action,
    e.resourceType ?? '',
    e.resourceId ?? '',
    e.ip ?? '',
  ]);
  const csv = [headers, ...rows]
    .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ─── Data fetching ─────────────────────────────────────────────────────────────

interface AuditFilters {
  actor: string;
  action: string;
  from: string;
  to: string;
  limit: number;
  offset: number;
}

function useAuditEvents(filters: AuditFilters) {
  return useQuery<AuditEvent[]>({
    queryKey: ['audit-events', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.actor) params.set('actor', filters.actor);
      if (filters.action) params.set('action', filters.action);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      params.set('limit', String(filters.limit));
      params.set('offset', String(filters.offset));
      const res = await fetch(`/api/admin/audit?${params}`);
      if (res.status === 403) throw new Error('403');
      if (!res.ok) throw new Error('Failed to load audit log');
      return res.json() as Promise<AuditEvent[]>;
    },
    staleTime: 30_000,
  });
}

// ─── Component ─────────────────────────────────────────────────────────────────

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/admin/audit' });

  const [actor, setActor] = useState(search.actor ?? '');
  const [action, setAction] = useState(search.action ?? '');
  const [from, setFrom] = useState(search.from ?? '');
  const [to, setTo] = useState(search.to ?? '');
  const [limit, setLimit] = useState(search.limit ?? 50);
  const [offset, setOffset] = useState(search.offset ?? 0);

  const filters: AuditFilters = { actor, action, from, to, limit, offset };
  const { data: events, isLoading, isError, error } = useAuditEvents(filters);

  const isForbidden = isError && (error as Error).message === '403';

  function applyFilters() {
    setOffset(0);
    void navigate({ search: () => ({ actor: actor || undefined, action: action || undefined, from: from || undefined, to: to || undefined, limit, offset: 0 }) });
  }

  function prevPage() {
    const next = Math.max(0, offset - limit);
    setOffset(next);
  }

  function nextPage() {
    if (!events || events.length < limit) return;
    setOffset(offset + limit);
  }

  const page = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="mt-1 text-sm text-gray-500">All administrative actions and events</p>
        </div>
        <button
          data-testid="export-csv"
          onClick={() => events && exportToCsv(events)}
          disabled={!events || events.length === 0}
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
            events && events.length > 0
              ? 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              : 'border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed',
          )}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      {/* Forbidden / access denied */}
      {isForbidden && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center" role="alert" data-testid="forbidden-message">
          <p className="text-sm font-medium text-red-700">Access denied. Admin role required to view audit logs.</p>
        </div>
      )}

      {!isForbidden && (
        <>
          {/* Filters */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Search className="inline h-3 w-3 mr-1" />Actor
                </label>
                <input
                  data-testid="filter-actor"
                  type="text"
                  placeholder="Actor ID or name"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  <Filter className="inline h-3 w-3 mr-1" />Action
                </label>
                <select
                  data-testid="filter-action"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {ACTION_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="min-w-[160px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                <input
                  data-testid="filter-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="min-w-[160px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                <input
                  data-testid="filter-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="min-w-[100px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">Per page</label>
                <select
                  data-testid="filter-limit"
                  value={limit}
                  onChange={(e) => { setLimit(Number(e.target.value)); setOffset(0); }}
                  className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {PAGE_SIZE_OPTIONS.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <button
                data-testid="apply-filters"
                onClick={applyFilters}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
              >
                Apply
              </button>
            </div>
          </div>

          {/* Loading */}
          {isLoading && (
            <div className="space-y-2" data-testid="loading-state">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />
              ))}
            </div>
          )}

          {/* Error */}
          {isError && !isForbidden && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
              Failed to load audit log. Please try again.
            </div>
          )}

          {/* Table */}
          {events && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm" data-testid="audit-table">
                  <thead className="border-b border-gray-100 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Timestamp</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Actor</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Resource</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {events.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400" data-testid="empty-state">
                          No audit events found
                        </td>
                      </tr>
                    ) : (
                      events.map((event) => (
                        <tr key={event.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                            {new Date(event.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-700 max-w-[200px] truncate">
                            {event.actorId}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                              {event.action}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-500">
                            {event.resourceType
                              ? <span>{event.resourceType}{event.resourceId ? ` / ${event.resourceId.slice(0, 8)}` : ''}</span>
                              : <span className="text-gray-300">—</span>}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-gray-400">
                            {event.ip ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 bg-gray-50">
                <span className="text-xs text-gray-500">
                  Page {page} · {events.length} rows
                </span>
                <div className="flex gap-2">
                  <button
                    data-testid="prev-page"
                    onClick={prevPage}
                    disabled={offset === 0}
                    className={clsx('flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors', {
                      'text-gray-400 cursor-not-allowed': offset === 0,
                      'text-gray-700 hover:bg-gray-200': offset > 0,
                    })}
                  >
                    <ChevronLeft className="h-3 w-3" /> Prev
                  </button>
                  <button
                    data-testid="next-page"
                    onClick={nextPage}
                    disabled={events.length < limit}
                    className={clsx('flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors', {
                      'text-gray-400 cursor-not-allowed': events.length < limit,
                      'text-gray-700 hover:bg-gray-200': events.length >= limit,
                    })}
                  >
                    Next <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
