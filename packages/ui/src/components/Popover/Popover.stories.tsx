import type { Meta, StoryObj } from '@storybook/react';
import { Popover, PopoverTrigger, PopoverContent } from './Popover.js';
import { Button } from '../Button/Button.js';

const meta: Meta<typeof Popover> = {
  title: 'Components/Popover',
  component: Popover,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Popover>;

export const Default: Story = {
  render: () => (
    <div style={{ padding: '4rem', display: 'flex', justifyContent: 'center' }}>
      <Popover>
        <PopoverTrigger>
          <Button variant="outline">Open Popover</Button>
        </PopoverTrigger>
        <PopoverContent>
          <p style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Popover Title</p>
          <p style={{ fontSize: '0.875rem' }}>This is the popover content area.</p>
        </PopoverContent>
      </Popover>
    </div>
  ),
};
