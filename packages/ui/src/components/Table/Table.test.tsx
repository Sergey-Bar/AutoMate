import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './Table.js';

test('renders a basic table', () => {
  render(
    <Table data-testid="my-table">
      <TableHeader>
        <TableRow>
          <TableHead>Header 1</TableHead>
          <TableHead>Header 2</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Cell 1</TableCell>
          <TableCell>Cell 2</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );

  const table = screen.getByTestId('my-table');
  expect(table).toBeInTheDocument();
  expect(table.tagName).toBe('TABLE');

  expect(screen.getByText('Header 1')).toBeInTheDocument();
  expect(screen.getByText('Cell 1')).toBeInTheDocument();
});

test('handles sortable headers', () => {
  const onSort = vi.fn();
  render(
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead sortable onSortChange={onSort} sortDirection="asc" data-testid="sort-head">
            Sortable Header
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Content</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );

  // The control is a button inside the cell, not the cell itself. Clicking the
  // button is the only thing that sorts; the `<th>` is a cell and stays one.
  fireEvent.click(within(screen.getByTestId('sort-head')).getByRole('button'));
  expect(onSort).toHaveBeenCalledTimes(1);
});

describe('Table keyboard operation', () => {
  function renderSortableTable(onSort: () => void, sortDirection: 'asc' | 'desc' | null = 'asc') {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run</TableHead>
            <TableHead sortable onSortChange={onSort} sortDirection={sortDirection}>
              Status
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>run-1</TableCell>
            <TableCell>passed</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
  }

  it('exposes the sort control as a button a keyboard can reach and operate', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderSortableTable(onSort);

    const sortButton = screen.getByRole('button', { name: /status/i });
    await user.tab();
    expect(sortButton).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('sorts with Space as well as Enter', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    renderSortableTable(onSort);

    screen.getByRole('button', { name: /status/i }).focus();
    await user.keyboard(' ');

    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('announces the sort direction on the column, not as glyphs', () => {
    const { unmount } = render(<span />);
    unmount();
    const onSort = vi.fn();
    const { rerender } = render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable onSortChange={onSort} sortDirection="desc">
              Status
            </TableHead>
            <TableHead>Run</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    // `aria-sort` is what tells a screen-reader user which column is sorted. The
    // ▲/▼ glyphs are decorative, and reading them out adds nothing.
    expect(screen.getByRole('columnheader', { name: /status/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByRole('columnheader', { name: 'Run' })).not.toHaveAttribute('aria-sort');
    rerender(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead sortable onSortChange={onSort} sortDirection={null}>
              Status
            </TableHead>
            <TableHead>Run</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: /status/i })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('leaves a plain column header out of the tab order', async () => {
    const user = userEvent.setup();
    renderSortableTable(vi.fn());

    await user.tab();
    expect(screen.getByRole('button', { name: /status/i })).toHaveFocus();
    // One stop for the one interactive header; the other column is not a stop.
    expect(screen.getByRole('columnheader', { name: 'Run' }).querySelector('button')).toBeNull();
  });
});

/**
 * A numeric cell, and the three things it has to be.
 *
 * `TableCell` cannot know which of its cells hold figures — a caller knows that and the
 * component does not — so `numeric` is the caller saying so, and it is a prop rather than
 * a heuristic because a heuristic that guessed "this looks like a number" would right-align
 * a run id and set a digest in tabular figures.
 *
 * Three properties, and each is a decision:
 *
 * 1. **`tabular-nums`** — a digit is proportional by default, so a column of scores shifts
 *    sideways every time one updates. This is the defect the documentation site has not had
 *    since it was written and the product has had throughout.
 * 2. **`text-right`** — figures are compared down a column, and a right edge is the only
 *    alignment where the *last* digit is in the same place on every row.
 * 3. **`font-mono`** — the design language says JetBrains Mono for anything a person
 *    compares character by character, and a column of scores is that.
 */
describe('a numeric cell', () => {
  function renderNumeric(extra?: { className?: string }): HTMLElement {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell numeric {...extra}>
              0.72
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    return screen.getByRole('cell');
  }

  it('aligns figures to the right, in tabular numerals, in the reading face', () => {
    const cell = renderNumeric();
    expect(cell).toHaveClass('tabular-nums', 'text-right', 'font-mono');
  });

  it('leaves a text cell alone', () => {
    render(
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>security</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const cell = screen.getByRole('cell');
    expect(cell.className).not.toContain('tabular-nums');
    expect(cell.className).not.toContain('font-mono');
  });

  it('lets a caller add a class without losing the three', () => {
    const cell = renderNumeric({ className: 'text-fg-muted' });
    expect(cell).toHaveClass('tabular-nums', 'text-right', 'font-mono', 'text-fg-muted');
  });
});
