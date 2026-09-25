import type { Meta, StoryObj } from '@storybook/react';
import { StatCard } from './StatCard.js';

const meta: Meta<typeof StatCard> = {
  title: 'Components/StatCard',
  component: StatCard,
  tags: ['autodocs'],
  argTypes: {
    trend: { control: 'select', options: ['up', 'down', 'neutral', undefined] },
  },
};

export default meta;
type Story = StoryObj<typeof StatCard>;

export const Default: Story = {
  args: {
    title: 'Total Tests',
    value: '1,234',
  },
};

export const WithTrendUp: Story = {
  args: {
    title: 'Pass Rate',
    value: '98.2%',
    trend: 'up',
    description: '+2.1% from last run',
  },
};

export const WithTrendDown: Story = {
  args: {
    title: 'Failures',
    value: '23',
    trend: 'down',
    description: '5 more than last run',
  },
};

export const Neutral: Story = {
  args: {
    title: 'Duration',
    value: '4m 32s',
    trend: 'neutral',
    description: 'No change',
  },
};
