import type { Meta, StoryObj } from '@storybook/react';
import { Select } from './Select.js';

const meta: Meta<typeof Select> = {
  title: 'Components/Select',
  component: Select,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Select>;

const options = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
];

export const Default: Story = {
  args: {
    options,
    placeholder: 'Select a fruit...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Favourite fruit',
    options,
    placeholder: 'Choose one...',
    id: 'fruit',
  },
};

export const WithError: Story = {
  args: {
    label: 'Fruit',
    options,
    error: 'Please select a fruit.',
    id: 'fruit-error',
  },
};

export const Disabled: Story = {
  args: {
    options,
    disabled: true,
    placeholder: 'Disabled',
  },
};
