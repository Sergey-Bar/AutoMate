import type { Meta, StoryObj } from '@storybook/react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './Table.js';

const meta: Meta<typeof Table> = {
  title: 'Components/Table',
  component: Table,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Table>;

export const Default: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>login.spec.ts</TableCell>
          <TableCell>Passed</TableCell>
          <TableCell>1.2s</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>checkout.spec.ts</TableCell>
          <TableCell>Failed</TableCell>
          <TableCell>3.4s</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>profile.spec.ts</TableCell>
          <TableCell>Passed</TableCell>
          <TableCell>0.8s</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

export const WithSortableHeaders: Story = {
  render: () => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead sortable sortDirection="asc">Name</TableHead>
          <TableHead sortable sortDirection={null}>Status</TableHead>
          <TableHead>Duration</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>login.spec.ts</TableCell>
          <TableCell>Passed</TableCell>
          <TableCell>1.2s</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};
