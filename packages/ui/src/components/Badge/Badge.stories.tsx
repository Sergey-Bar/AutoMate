import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from './Badge.js';

const meta: Meta<typeof Badge> = {
  title: 'Components/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'secondary', 'danger', 'success', 'warning', 'outline'],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = {
  args: { children: 'Badge' },
};

export const Secondary: Story = {
  args: { variant: 'secondary', children: 'Secondary' },
};

export const Danger: Story = {
  args: { variant: 'danger', children: 'Failed' },
};

export const Success: Story = {
  args: { variant: 'success', children: 'Passed' },
};

export const Warning: Story = {
  args: { variant: 'warning', children: 'Flaky' },
};

export const Outline: Story = {
  args: { variant: 'outline', children: 'Outline' },
};
