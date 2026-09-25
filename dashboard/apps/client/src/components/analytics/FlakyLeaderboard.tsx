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
import { shortPath } from '@/lib/formatters';

export interface FlakyTest {
  title: string;
  file: string;
  flakyCount: number;
  totalRuns: number;
  flakyRate: number; // 0-100
}

const col = createColumnHelper<FlakyTest>();

const columns = [
  col.accessor('title', {
    header: 'Test',
    cell: (info) => (
      <div>
        <div className="text-xs truncate max-w-[24ch] text-text-primary">
          {info.getValue()}
        </div>
        <div className="text-[10px] text-text-tertiary">
          {shortPath(info.row.original.file)}
        </div>
      </div>
    ),
  }),
  col.accessor('flakyCount', {
    header: 'Flaky',
    cell: (info) => (
      <span className="tabular text-xs text-flaky">
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor('totalRuns', {
    header: 'Runs',
    cell: (info) => (
      <span className="tabular text-xs text-text-secondary">
        {info.getValue()}
      </span>
    ),
  }),
  col.accessor('flakyRate', {
    header: 'Rate',
    cell: (info) => {
      const v = info.getValue();
      return (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-[60px] rounded-full bg-bg-elevated">
            <div
              className="h-full rounded-full bg-flaky"
              style={{
                width: `${v}%`,
              }}
            />
          </div>
          <span className="tabular text-xs text-flaky">
            {v.toFixed(1)}%
          </span>
        </div>
      );
    },
  }),
];

interface FlakyLeaderboardProps {
  data: FlakyTest[];
}

export function FlakyLeaderboard({ data }: FlakyLeaderboardProps) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'flakyRate', desc: true }]);

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
