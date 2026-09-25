import type { Meta, StoryObj } from '@storybook/react';
import { Skeleton } from './Skeleton.js';

const meta: Meta<typeof Skeleton> = {
  title: 'Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['block', 'text', 'avatar'] },
  },
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  args: {
    style: { width: 200, height: 20 },
  },
};

export const Text: Story = {
  args: {
    variant: 'text',
    style: { width: 300 },
  },
};

export const Avatar: Story = {
  args: {
    variant: 'avatar',
  },
};

export const CardSkeleton: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: 300 }}>
      <Skeleton variant="avatar" />
      <Skeleton variant="text" />
      <Skeleton variant="text" style={{ width: '80%' }} />
      <Skeleton variant="text" style={{ width: '60%' }} />
    </div>
  ),
};
