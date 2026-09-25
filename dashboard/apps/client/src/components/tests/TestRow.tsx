import { memo } from 'react';
import { motion } from 'framer-motion';
import type { TestWithResults as Test } from '@/lib/types';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { TagChip } from '@/components/shared/TagChip';
import { formatDuration, shortPath } from '@/lib/formatters';
import { StabilityBadge } from '@/components/tests/StabilityBadge';
import { cn } from '@/lib/utils';

interface TestRowProps {
  test: Test;
  isSelected: boolean;
  onClick: () => void;
  stabilityGrade?: string;
}

export const TestRow = memo(function TestRow({ test, isSelected, onClick, stabilityGrade }: TestRowProps) {
  return (
    <motion.button
      type="button"
      layout="position"
      className={cn(
        'w-full text-left px-3 py-2 rounded-lg flex items-start gap-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
        isSelected
          ? 'bg-bg-surface-active border-l-2 border-l-border-focus'
          : 'bg-transparent border-l-2 border-l-transparent',
      )}
      onClick={onClick}
      animate={{ opacity: 1, x: 0 }}
      initial={{ opacity: 0, x: -6 }}
    >
      {/* Status dot */}
      <div className="mt-1 shrink-0">
        <StatusBadge status={test.status} showLabel={false} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm font-medium truncate text-text-primary">
            {test.title}
          </span>
          {test.retries > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full tabular bg-bg-elevated text-text-tertiary">
              ×{test.retries}
            </span>
          )}
          {stabilityGrade && <StabilityBadge grade={stabilityGrade} />}
        </div>

        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] truncate text-text-tertiary">
            {shortPath(test.file)}:{test.line}
          </span>
          {test.tags?.map((tag) => (
            <TagChip key={tag} tag={tag} as="span" />
          ))}
        </div>
      </div>

      <div className="shrink-0 text-[11px] tabular text-text-tertiary">
        {test.durationMs ? formatDuration(test.durationMs) : '—'}
      </div>
    </motion.button>
  );
});
