import type { Meta, StoryObj } from '@storybook/react';
import { Splitter } from './Splitter.js';

const meta: Meta<typeof Splitter> = {
  title: 'Components/Splitter',
  component: Splitter,
  tags: ['autodocs'],
  argTypes: {
    orientation: { control: 'select', options: ['horizontal', 'vertical'] },
  },
};

export default meta;
type Story = StoryObj<typeof Splitter>;

export const Default: Story = {
  args: {
    orientation: 'horizontal',
  },
};

export const Vertical: Story = {
  render: () => (
    <div style={{ display: 'flex', height: 100, alignItems: 'stretch' }}>
      <div style={{ padding: '0.5rem' }}>Left</div>
      <Splitter orientation="vertical" />
      <div style={{ padding: '0.5rem' }}>Right</div>
    </div>
  ),
};
