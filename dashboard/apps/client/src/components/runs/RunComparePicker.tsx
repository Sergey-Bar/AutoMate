import { useState, useMemo, useRef } from 'react';
import { useRuns } from '@/hooks/useRun';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RunComparePicker {
  label: string;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}

export function RunComparePicker({ label, selectedRunId, onSelect }: RunComparePicker) {
  const { data: runs } = useRuns();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(value: string) {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 200);
  }

  const filtered = useMemo(() => {
    if (!debouncedSearch.trim()) return runs ?? [];
    const q = debouncedSearch.toLowerCase();
    return (runs ?? []).filter((r) =>
      r.id.toLowerCase().includes(q) || r.branch?.toLowerCase().includes(q) || r.commitSha?.toLowerCase().includes(q),
    );
  }, [runs, debouncedSearch]);

  const selected = runs?.find((r) => r.id === selectedRunId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border-default text-text-primary bg-bg-surface text-sm min-w-50"
      >
        <span className="text-[11px] font-medium text-text-tertiary">{label}:</span>
        <span className="font-mono text-xs">{selected ? selected.id.slice(0, 8) : 'Select run…'}</span>
        <ChevronDown size={12} className="ml-auto text-text-tertiary" />
      </button>

      {open && (
        <div
          className="absolute top-full mt-1 left-0 w-72 max-h-60 overflow-y-auto rounded-lg border border-border-default bg-bg-elevated z-50 shadow-lg"
        >
          <div className="p-2">
            <input
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search runs…"
              className="w-full px-2 py-1.5 text-xs rounded border border-border-subtle text-text-primary bg-transparent outline-none"
              autoFocus
            />
          </div>
          {filtered.map((run) => (
            <button
              key={run.id}
              onClick={() => { onSelect(run.id); setOpen(false); }}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-2 text-xs hover:bg-white/4 transition-colors',
                run.id === selectedRunId ? 'text-running' : 'text-text-secondary',
              )}
            >
              {run.id === selectedRunId && <Check size={12} />}
              <span className="font-mono">{run.id.slice(0, 8)}</span>
              <span className="text-[11px] text-text-tertiary">{run.branch ?? '—'}</span>
              <span className="ml-auto text-[11px] text-text-tertiary">
                {run.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
