import { render, screen, fireEvent } from '@testing-library/react';
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

  const th = screen.getByTestId('sort-head');
  fireEvent.click(th);
  expect(onSort).toHaveBeenCalledTimes(1);
});
