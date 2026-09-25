import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './Textarea.js';

const meta: Meta<typeof Textarea> = {
  title: 'Components/Textarea',
  component: Textarea,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    placeholder: 'Enter your message...',
  },
};

export const WithLabel: Story = {
  args: {
    label: 'Description',
    placeholder: 'Describe the issue...',
    id: 'description',
  },
};

export const WithHelperText: Story = {
  args: {
    label: 'Notes',
    placeholder: 'Add notes...',
    helperText: 'Max 500 characters.',
    id: 'notes',
  },
};

export const WithError: Story = {
  args: {
    label: 'Message',
    placeholder: 'Enter message...',
    error: 'Message is required.',
    id: 'message-error',
  },
};

export const Disabled: Story = {
  args: {
    placeholder: 'Disabled textarea',
    disabled: true,
  },
};
