import {
  forwardRef,
  type HTMLAttributes,
  type TdHTMLAttributes,
  type ThHTMLAttributes,
} from 'react';
import { cn } from '../../lib/utils.js';
import { ArrowDown, ArrowUp } from 'lucide-react';

export type TableProps = HTMLAttributes<HTMLTableElement>;

export const Table = forwardRef<HTMLTableElement, TableProps>(({ className, ...props }, ref) => (
  <div className="w-full overflow-auto">
    <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
  </div>
));
Table.displayName = 'Table';

export const TableHeader = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('[&_tr]:border-b border-border-default', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = forwardRef<
  HTMLTableSectionElement,
  HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableRow = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'border-b border-border-default transition-colors hover:bg-bg-muted/50 data-[state=selected]:bg-bg-muted',
        className,
      )}
      {...props}
    />
  ),
);
TableRow.displayName = 'TableRow';

export interface TableHeadProps extends ThHTMLAttributes<HTMLTableCellElement> {
  sortable?: boolean;
  sortDirection?: 'asc' | 'desc' | null;
  onSortChange?: () => void;
}

export const TableHead = forwardRef<HTMLTableCellElement, TableHeadProps>(
  ({ className, sortable, sortDirection, onSortChange, children, ...props }, ref) => {
    /**
     * The sort indicator is decoration. `aria-sort` on the cell is what tells a
     * screen-reader user which column is sorted and in which direction; reading
     * out "▲ ▼" adds nothing and the glyphs are noise for everyone else.
     */
    const ariaSort = !sortable
      ? undefined
      : sortDirection === 'asc'
        ? 'ascending'
        : sortDirection === 'desc'
          ? 'descending'
          : 'none';

    return (
      <th
        ref={ref}
        aria-sort={ariaSort}
        className={cn(
          'h-12 px-4 text-left align-middle font-medium text-text-secondary [&:has([role=checkbox])]:pr-0',
          sortable && 'p-0',
          className,
        )}
        {...props}
      >
        {sortable ? (
          /*
           * A `<button>` inside the cell rather than a click handler on the
           * `<th>`. The previous version sorted on click and could not be
           * reached or operated at all from the keyboard — `tabindex` and
           * `onkeydown` on a table cell also announce as a table cell, not as the
           * control the cell now behaves as. A button carries the role, the focus
           * ring and the Enter/Space behaviour for free, and keeps the cell's
           * table semantics intact.
           */
          <button
            type="button"
            onClick={onSortChange}
            className="flex h-12 w-full items-center gap-1 px-4 text-left font-medium text-inherit hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus"
          >
            {children}
            {/*
              Lucide triangles rather than the `▲`/`▼` they replace.

              `▲` and `▼` are *geometric shapes*, not glyphs: they render in whatever
              font the browser picks for U+25B2 and U+25BC, so the sort indicator
              changed appearance between a Windows machine, a Mac and a Linux
              container, and on a machine with no coverage for them it renders as
              `?`. They also have no `stroke-width` to inherit, so they cannot be
              sized consistently with the rest of the row.

              Still `aria-hidden`, and still only decoration: `aria-sort` on the `<th>`
              is what tells a screen-reader user which column is sorted and in which
              direction, and a name would now contradict it.
            */}
            <span aria-hidden="true" className="flex flex-col leading-none opacity-50">
              <ArrowUp
                size={10}
                strokeWidth={2.5}
                className={cn(sortDirection === 'asc' && 'opacity-100 text-accent')}
              />
              <ArrowDown
                size={10}
                strokeWidth={2.5}
                className={cn(sortDirection === 'desc' && 'opacity-100 text-accent')}
              />
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-1">{children}</div>
        )}
      </th>
    );
  },
);
TableHead.displayName = 'TableHead';

export const TableCell = forwardRef<HTMLTableCellElement, TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td
      ref={ref}
      className={cn('p-4 align-middle [&:has([role=checkbox])]:pr-0', className)}
      {...props}
    />
  ),
);
TableCell.displayName = 'TableCell';
