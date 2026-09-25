import type { Meta, StoryObj } from '@storybook/react';
import { Toggle } from './Toggle.js';

const meta: Meta<typeof Toggle> = {
  title: 'Components/Toggle',
  component: Toggle,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Toggle>;

export const Default: Story = {
  args: {
    id: 'toggle-default',
    label: 'Enable feature',
  },
};

export const Checked: Story = {
  args: {
    id: 'toggle-checked',
    label: 'Feature enabled',
    checked: true,
    readOnly: true,
  },
};

export const Disabled: Story = {
  args: {
    id: 'toggle-disabled',
    label: 'Disabled toggle',
    disabled: true,
  },
};
