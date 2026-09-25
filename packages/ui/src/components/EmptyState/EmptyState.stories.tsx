import type { Meta, StoryObj } from '@storybook/react';
import { Search } from 'lucide-react';
import { EmptyState } from './EmptyState.js';
import { Button } from '../Button/Button.js';

const meta: Meta<typeof EmptyState> = {
  title: 'Components/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    title: 'No results found',
    description: 'Try adjusting your search or filter to find what you are looking for.',
  },
};

export const WithIcon: Story = {
  args: {
    icon: <Search size={24} />,
    title: 'No results found',
    description: 'Try adjusting your search or filter to find what you are looking for.',
  },
};

export const WithAction: Story = {
  args: {
    icon: <Search size={24} />,
    title: 'No tests yet',
    description: 'Connect your Playwright project to start seeing test results.',
    action: <Button size="sm">Connect project</Button>,
  },
};

export const Card: Story = {
  args: {
    variant: 'card',
    title: 'Nothing here',
    description: 'Add some items to get started.',
  },
};
