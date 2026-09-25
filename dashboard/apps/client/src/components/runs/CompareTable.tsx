import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatDuration } from '@/lib/formatters';
import type { CompareRow, TestStatus } from '@/lib/types';
import { cn } from '@/lib/utils';

function getBorderClass(changeType: CompareRow['changeType']): string {
  switch (changeType) {
    case 'new_failure': return 'border-l-fail';
    case 'fixed': return 'border-l-pass';
    case 'regression': return 'border-l-flaky';
    case 'added': return 'border-l-running';
    case 'removed': return 'border-l-text-tertiary';
    case 'unchanged': return 'border-l-transparent';
  }
}

function getChangeBadge(changeType: CompareRow['changeType']): { text: string; textClass: string; bg: string } | null {
  switch (changeType) {
    case 'new_failure': return { text: 'New Failure', textClass: 'text-fail', bg: 'color-mix(in oklch, var(--color-fail) 15%, transparent)' };
    case 'fixed': return { text: 'Fixed', textClass: 'text-pass', bg: 'color-mix(in oklch, var(--color-pass) 15%, transparent)' };
    case 'regression': return { text: 'Regression', textClass: 'text-flaky', bg: 'color-mix(in oklch, var(--color-flaky) 15%, transparent)' };
    case 'added': return { text: 'Added', textClass: 'text-running', bg: 'color-mix(in oklch, var(--color-running) 15%, transparent)' };
    case 'removed': return { text: 'Removed', textClass: 'text-text-tertiary', bg: 'color-mix(in oklch, var(--color-text-tertiary) 15%, transparent)' };
    case 'unchanged': return null;
  }
}

interface CompareTableProps {
  rows: CompareRow[];
  changedOnly: boolean;
}



export function CompareTable({ rows, changedOnly }: CompareTableProps) {
  const display = changedOnly ? rows.filter((r) => r.changeType !== 'unchanged') : rows;

  return (
    <div className="rounded-xl border border-border-default overflow-hidden">
      <table className="w-full text-sm" role="table">
        <thead role="rowgroup">
          <tr role="row" className="bg-bg-surface border-b border-border-subtle">
            {['Test', 'Run A', 'Run B', 'Change', 'Duration A', 'Duration B'].map((col) => (
              <th key={col} role="columnheader" className="text-left px-4 py-2 text-[11px] font-medium text-text-tertiary">
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup">
          {display.map((row) => {
            const badge = getChangeBadge(row.changeType);
            return (
              <tr
                key={row.title}
                role="row"
                className={cn('border-t border-l-[3px] border-border-subtle hover:bg-white/2 transition-colors', getBorderClass(row.changeType))}
              >
                <td role="cell" className="px-4 py-2.5">
                  <p className="text-sm truncate max-w-75 text-text-primary">{row.title}</p>
                  <p className="text-[11px] truncate text-text-tertiary">{row.file}</p>
                </td>
                <td role="cell" className="px-4 py-2.5">
                  {row.statusA ? <StatusBadge status={row.statusA as TestStatus} size={6} /> : <span className="text-text-tertiary">—</span>}
                </td>
                <td role="cell" className="px-4 py-2.5">
                  {row.statusB ? <StatusBadge status={row.statusB as TestStatus} size={6} /> : <span className="text-text-tertiary">—</span>}
                </td>
                <td role="cell" className="px-4 py-2.5">
                  {badge ? (
                    <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded', badge.textClass)} style={{ background: badge.bg }}>
                      {badge.text}
                    </span>
                  ) : (
                    <span className="text-[11px] text-text-tertiary">—</span>
                  )}
                </td>
                <td role="cell" className="px-4 py-2.5 tabular text-xs">{formatDuration(row.durationA)}</td>
                <td role="cell" className="px-4 py-2.5 tabular text-xs">{formatDuration(row.durationB)}</td>
              </tr>
              );
          })}
          {display.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-8 text-center text-sm text-text-tertiary">
                {changedOnly ? 'No differences between these runs.' : 'Select two runs to compare.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
