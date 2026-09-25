import type { Meta, StoryObj } from '@storybook/react';
import { Breadcrumbs } from './Breadcrumbs.js';

const meta: Meta<typeof Breadcrumbs> = {
  title: 'Components/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Breadcrumbs>;

export const Default: Story = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Projects', href: '/projects' },
      { label: 'My Project' },
    ],
  },
};

export const SingleItem: Story = {
  args: {
    items: [{ label: 'Dashboard' }],
  },
};

export const Deep: Story = {
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Projects', href: '/projects' },
      { label: 'My Project', href: '/projects/1' },
      { label: 'Runs', href: '/projects/1/runs' },
      { label: 'Run #42' },
    ],
  },
};
