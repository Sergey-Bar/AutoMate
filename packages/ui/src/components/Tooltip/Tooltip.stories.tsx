import type { Meta, StoryObj } from '@storybook/react';
import { Tooltip } from './Tooltip.js';
import { Button } from '../Button/Button.js';

const meta: Meta<typeof Tooltip> = {
  title: 'Components/Tooltip',
  component: Tooltip,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  render: () => (
    <div style={{ padding: '4rem', display: 'flex', justifyContent: 'center' }}>
      <Tooltip content="This is a tooltip">
        <Button variant="outline">Hover me</Button>
      </Tooltip>
    </div>
  ),
};

export const WithText: Story = {
  render: () => (
    <div style={{ padding: '4rem', display: 'flex', justifyContent: 'center' }}>
      <Tooltip content="Keyboard shortcut: Ctrl+K">
        <span style={{ cursor: 'help', textDecoration: 'underline dotted' }}>Command palette</span>
      </Tooltip>
    </div>
  ),
};
