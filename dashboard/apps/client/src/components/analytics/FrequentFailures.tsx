import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { ArrowUpDown } from 'lucide-react';

export interface FrequentFailure {
  errorMessage: string;
  count: number;
  lastSeen: string;
  affectedTests: string[];
}

const col = createColumnHelper<FrequentFailure>();

const columns = [
  col.accessor('errorMessage', {
    header: 'Error',
    cell: (info) => (
      <div
        className="text-xs truncate max-w-[32ch] text-text-primary"
        title={info.getValue()}
      >
        {info.getValue().length > 60
          ? `${info.getValue().slice(0, 60)}…`
          : info.getValue()}
      </div>
    ),
  }),
  col.accessor('count', {
    header: 'Count',
    cell: (info) => (
      <span className="tabular text-xs text-failed font-semibold">
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor('lastSeen', {
    header: 'Last Seen',
    cell: (info) => {
      const date = new Date(info.getValue());
      const now = Date.now();
      const diffMs = now - date.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const label =
        diffDays === 0
          ? 'today'
          : diffDays === 1
          ? '1 day ago'
          : `${diffDays} days ago`;
      return (
        <span className="text-xs text-text-tertiary" title={date.toLocaleString()}>
          {label}
        </span>
      );
    },
  }),
  col.accessor('affectedTests', {
    header: 'Tests',
    cell: (info) => (
      <span className="tabular text-xs text-text-secondary">
        {info.getValue().length}
      </span>
    ),
  }),
];

interface FrequentFailuresProps {
  data: FrequentFailure[];
}

export function FrequentFailures({ data }: FrequentFailuresProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'count', desc: true }]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-auto rounded-lg border border-border-subtle">
      <table className="w-full text-left">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id} className="border-b border-border-subtle bg-bg-elevated">
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  className="px-3 py-2 text-[11px] uppercase tracking-wider font-medium cursor-pointer select-none text-text-tertiary"
                  onClick={h.column.getToggleSortingHandler()}
                >
                  <div className="flex items-center gap-1">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <ArrowUpDown size={10} />
                  </div>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border-subtle transition-colors hover:bg-bg-elevated"
            >
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
