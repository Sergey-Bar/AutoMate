import type { Meta, StoryObj } from '@storybook/react';
import { AppShell } from './AppShell.js';

const meta: Meta<typeof AppShell> = {
  title: 'Components/AppShell',
  component: AppShell,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof AppShell>;

export const Default: Story = {
  render: () => (
    <AppShell
      header={<div style={{ padding: '1rem', fontWeight: 600 }}>Header</div>}
      sidebar={<div style={{ padding: '1rem' }}>Sidebar</div>}
      footer={<div style={{ padding: '0.5rem 1rem', fontSize: '0.75rem' }}>Footer</div>}
    >
      <div style={{ padding: '1rem' }}>Main content area</div>
    </AppShell>
  ),
};

export const NoSidebar: Story = {
  render: () => (
    <AppShell header={<div style={{ padding: '1rem', fontWeight: 600 }}>Header</div>}>
      <div style={{ padding: '1rem' }}>Main content without sidebar</div>
    </AppShell>
  ),
};
