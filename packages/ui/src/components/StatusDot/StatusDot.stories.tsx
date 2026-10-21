import type { Meta, StoryObj } from '@storybook/react';
import { StatusDot } from './StatusDot.js';

const meta: Meta<typeof StatusDot> = {
  title: 'Components/StatusDot',
  component: StatusDot,
  tags: ['autodocs'],
  argTypes: {
    status: { control: 'select', options: ['good', 'warn', 'bad', 'info', 'unknown'] },
  },
};

export default meta;
type Story = StoryObj<typeof StatusDot>;

export const Standalone: Story = { args: { status: 'bad', label: 'Failing' } };

export const BesideAWord: Story = {
  render: () => (
    <div className="flex flex-col gap-2 text-sm text-fg">
      {(['good', 'warn', 'bad', 'info', 'unknown'] as const).map((status) => (
        <span key={status} className="inline-flex items-center gap-2">
          <StatusDot status={status} />
          {status}
        </span>
      ))}
    </div>
  ),
};

export const Live: Story = { args: { status: 'info', label: 'Running', live: true } };
