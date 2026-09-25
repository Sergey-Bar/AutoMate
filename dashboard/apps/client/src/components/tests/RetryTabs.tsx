import type { ResultParsed } from '@/lib/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatDuration } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface RetryTabsProps {
  results: ResultParsed[];
  activeIndex: number;
  onChange: (index: number) => void;
}

export function RetryTabs({ results, activeIndex, onChange }: RetryTabsProps) {
  if (results.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-4 pt-3 pb-0 flex-wrap">
      {results.map((result, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs border transition-all',
              'text-text-primary',
              isActive
                ? 'ring-2 ring-border-focus bg-bg-surface-active border-border-focus'
                : 'opacity-60 hover:opacity-90 bg-bg-elevated border-border-subtle',
            )}
          >
            {i === 0 ? 'Attempt 1' : `Retry ${i}`}
            <StatusBadge status={result.status} showLabel={false} size={8} />
            {result.durationMs != null && (
              <span className="tabular text-text-tertiary">
                {formatDuration(result.durationMs)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
