import { motion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { formatDate, shortPath } from '@/lib/formatters';
import { fadeSlideUp, safeMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { QuarantineBadge } from './QuarantineButton';

export type FlakinessCategory =
  | 'timing'
  | 'environment'
  | 'data'
  | 'assertion_drift'
  | 'unknown';

export interface QuarantineRow {
  id: string;
  testTitle: string;
  testFile: string;
  reason: string | null;
  quarantinedAt: string;
  quarantinedBy: string | null;
  flakinessCategory?: FlakinessCategory | string;
  categoryConfidence?: number;
  categoryEvidence?: string[];
}

interface QuarantineTableProps {
  rows: QuarantineRow[];
  onRemove: (id: string) => void;
  isRemoving: boolean;
}

const CATEGORY_BADGE_CLASSES: Record<string, string> = {
  timing: 'bg-yellow-100 text-yellow-800',
  environment: 'bg-orange-100 text-orange-800',
  data: 'bg-blue-100 text-blue-800',
  assertion_drift: 'bg-purple-100 text-purple-800',
  unknown: 'bg-gray-100 text-gray-600',
};

const CATEGORY_LABELS: Record<string, string> = {
  timing: 'Timing',
  environment: 'Environment',
  data: 'Data',
  assertion_drift: 'Assertion Drift',
  unknown: 'Unknown',
};

function FlakinessCategoryBadge({ category }: { category: string | undefined }) {
  if (!category || category === 'unknown') {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
          CATEGORY_BADGE_CLASSES['unknown'],
        )}
      >
        Unknown
      </span>
    );
  }
  const classes = CATEGORY_BADGE_CLASSES[category] ?? CATEGORY_BADGE_CLASSES['unknown'];
  const label = CATEGORY_LABELS[category] ?? category;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
        classes,
      )}
    >
      {label}
    </span>
  );
}

export function QuarantineTable({ rows, onRemove, isRemoving }: QuarantineTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle">
      <table className="w-full border-collapse" role="table">
        <thead role="rowgroup">
          <tr role="row" className="border-b border-border-subtle bg-bg-surface">
            {['Test Title', 'Category', 'File', 'Reason', 'Source', 'Quarantined At', 'Actions'].map((h) => (
              <th
                key={h}
                role="columnheader"
                className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-text-tertiary"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map((row) => (
            <motion.tr
              key={row.id}
              role="row"
              variants={safeMotion(fadeSlideUp) as import('framer-motion').Variants}
              initial="hidden"
              animate="visible"
              className="transition-colors border-b border-border-subtle"
            >
              <td
                role="cell"
                className="px-3 py-2 text-xs font-medium text-text-primary"
              >
                {row.testTitle}
              </td>
              <td role="cell" className="px-3 py-2">
                <FlakinessCategoryBadge category={row.flakinessCategory} />
              </td>
              <td
                role="cell"
                className="px-3 py-2 text-xs text-text-secondary"
              >
                {shortPath(row.testFile)}
              </td>
              <td
                role="cell"
                className="px-3 py-2 text-xs text-text-tertiary"
              >
                {row.reason ?? '—'}
              </td>
              <td role="cell" className="px-3 py-2">
                <QuarantineBadge quarantinedBy={row.quarantinedBy} />
              </td>
              <td
                role="cell"
                className="px-3 py-2 text-xs text-text-secondary"
              >
                {formatDate(row.quarantinedAt)}
              </td>
              <td role="cell" className="px-3 py-2">
                <button
                  onClick={() => onRemove(row.id)}
                  disabled={isRemoving}
                  className={cn('flex items-center gap-1 rounded px-2 py-1 text-xs font-medium border transition-colors disabled:opacity-50 text-fail border-fail bg-transparent')}
                  aria-label={`Remove ${row.testTitle} from quarantine`}
                >
                  <Trash2 size={12} />
                  Remove
                </button>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
