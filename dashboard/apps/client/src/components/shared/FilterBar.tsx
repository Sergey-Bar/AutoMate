import { Search, X } from 'lucide-react';
import type { TestStatus } from '@/lib/types';
import { StatusBadge } from './StatusBadge';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface FilterBarProps {
  search: string;
  onSearch: (v: string) => void;
  statusFilter: TestStatus[];
  onStatusFilter: (statuses: TestStatus[]) => void;
  projectFilter?: string;
  onProjectFilter?: (p: string) => void;
  projects?: string[];
  tagFilter?: string;
  onTagFilter?: (tag: string) => void;
  tags?: string[];
}

const STATUS_OPTIONS: TestStatus[] = ['passed', 'failed', 'flaky', 'skipped', 'running'];

export function FilterBar({
  search, onSearch,
  statusFilter, onStatusFilter,
  projectFilter, onProjectFilter,
  projects = [],
  tagFilter, onTagFilter,
  tags = [],
}: FilterBarProps) {
  function toggleStatus(s: TestStatus) {
    if (statusFilter.includes(s)) {
      onStatusFilter(statusFilter.filter((x) => x !== s));
    } else {
      onStatusFilter([...statusFilter, s]);
    }
  }

  const hasFilters = search.trim() !== '' || statusFilter.length > 0 || !!projectFilter || !!tagFilter;

  return (
    <div className={cn('flex flex-wrap items-center gap-2 p-3 border-b', 'border-border-subtle')}>
      {/* Search */}
      <div
        className={cn('flex items-center gap-2 px-3 py-1.5 rounded-md border flex-1 min-w-40 max-w-xs', 'bg-bg-elevated border-border-default')}
      >
        <Search size={13} className="text-text-tertiary shrink-0" />
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search tests…"
          className={cn('flex-1 bg-transparent text-sm outline-none placeholder:text-text-tertiary', 'text-text-primary')}
        />
        {search && (
          <Button variant="ghost" size="sm" onClick={() => onSearch('')} className="opacity-60 hover:opacity-100 !p-0.5 !h-auto" aria-label="Clear search">
            <X size={12} />
          </Button>
        )}
      </div>

      {/* Status toggles */}
      <div className="flex items-center gap-1">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s}
            onClick={() => toggleStatus(s)}
            className={cn('px-2 py-1 rounded-md border text-[11px] transition-colors', statusFilter.includes(s) ? 'border-border-focus' : 'border-border-default')}
            style={{
              background: statusFilter.includes(s) ? 'oklch(0.68 0.19 250 / 8%)' : 'transparent',
            }}
            aria-pressed={statusFilter.includes(s)}
            aria-label={`Status: ${s.charAt(0).toUpperCase() + s.slice(1)}`}
          >
            <StatusBadge status={s} size={6} />
          </button>
        ))}
      </div>

      {/* Project filter */}
      {projects.length > 0 && onProjectFilter && (
        <select
          value={projectFilter ?? ''}
          onChange={(e) => onProjectFilter(e.target.value)}
          className={cn('text-sm rounded-md border px-2 py-1.5 bg-transparent outline-none', 'border-border-default text-text-secondary')}
        >
          <option value="">All projects</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      )}

      {/* Tag filter */}
      {tags.length > 0 && onTagFilter && (
        <select
          value={tagFilter ?? ''}
          onChange={(e) => onTagFilter(e.target.value)}
          className={cn('text-[11px] rounded-md border px-2 py-1.5 bg-transparent outline-none', 'border-border-default text-text-secondary')}
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>{tag}</option>
          ))}
        </select>
      )}

      {/* Clear filters */}
      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { onSearch(''); onStatusFilter([]); onProjectFilter?.(''); onTagFilter?.(''); }}
          className={cn('!text-xs !px-2 !py-1', 'text-text-tertiary')}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
